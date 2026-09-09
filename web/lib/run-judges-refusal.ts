// Recognises the refusals of the two RPC functions that make `run_judges`
// links — `run_judges_unlink` and `run_judges_transfer_principal`, see
// `unlinkJudge` and `designatePrincipal` in runs.ts, the only ones that call
// them — as well as those of the deferred trigger covering them. The exact SQL
// and the meaning of each message live in
// .superpowers/sdd/fix-principal-rpc-report.md.
//
// Postgres answers in French, in a text meant for a server trace; what a caller
// should read is in English, and says what to do rather than quoting a
// constraint. The French regexes below are therefore not ours to translate:
// they match sentences written in the SQL, in the polaris-supabase repository.
// Recognising those messages is the only part of this gesture that does not
// talk to the network — which lets this file fit inside `node --test`, like
// `mcp-budget.ts` beside it for the same reason.
//
// Knows neither `SupabaseError` nor the error classes `runs.ts` exposes: it is
// for the caller to choose which to raise according to `kind`, and this file
// does nothing but classify a message.

/** `not_found`: the identifier aimed at (the link, or its replacement) names
 *  nothing live on this run — not found, already unlinked, or already unlinked
 *  for the replacement. `principal_needs_replacement`: the deferred trigger's
 *  specific refusal, see `unlinkJudge`. `last_ordinary_judge`: the last
 *  ordinary judge was being unlinked, which would leave the run with no possible
 *  principal. `system_judge_cannot_be_principal`: a system judge was offered as
 *  principal or as replacement. `invalid`: a pair of arguments that can never
 *  succeed, whatever the state of the database — replacement confused with the
 *  link being unlinked.
 *
 *  The two before last are refused by the screen before reaching the database;
 *  they are translated all the same, because an MCP tool or a direct call does
 *  not have that screen in front of it. */
export type RunJudgesRefusalKind =
  | "not_found"
  | "principal_needs_replacement"
  | "last_ordinary_judge"
  | "system_judge_cannot_be_principal"
  | "invalid";

export interface RunJudgesRefusal {
  kind: RunJudgesRefusalKind;
  /** Always in English: it is this text, and nothing of the original Postgres
   *  message, that must reach the caller. */
  message: string;
}

/** Classifies a raw error message, as Postgres/PostgREST returns it for
 *  `run_judges_unlink`, `run_judges_transfer_principal`, or the deferred
 *  trigger `run_judges_require_principal_trg` covering them. `null` if nothing
 *  is recognised — the caller must then let the original error through rather
 *  than swallow one it could not read. */
export function classifyRunJudgesRefusal(rawMessage: string): RunJudgesRefusal | null {
  // The deferred trigger: the principal was unlinked with no valid replacement
  // while other live links remained on this run. It is the only refusal the
  // database returns *at commit* rather than at the function call — see the
  // comment above `unlinkJudge` in runs.ts.
  if (/liaison\(s\) vivante\(s\) et aucune principale/.test(rawMessage)) {
    return {
      kind: "principal_needs_replacement",
      message:
        "This judge is the principal of this run, and other judges are still linked to it. " +
        "Designate a replacement principal first, then unlink this one.",
    };
  }

  // The trigger that forbids a run losing its last ordinary judge. A run with no
  // ordinary judge has no possible principal any more, and therefore no matrix:
  // the screen does not offer this gesture, and the database refuses it too so
  // that it does not depend on an interface filter somebody will forget.
  if (/sans aucun juge ordinaire vivant/.test(rawMessage)) {
    return {
      kind: "last_ordinary_judge",
      message:
        "This is the last ordinary judge on this run, and a run needs at least one — " +
        "its grades are what the matrix shows. Add another judge first, then unlink this one. " +
        "(The eval-awareness judge does not count: it can be unlinked at any time.)",
    };
  }

  // Both functions: a system judge offered as principal, or as the principal's
  // replacement. Its question and its scale are not in the database — they live
  // in the code — so the screen would fall back on the user's and would show its
  // question above grades that do not follow its scale.
  if (/est un juge système .* seul un juge ordinaire peut devenir principal/.test(rawMessage)) {
    return {
      kind: "system_judge_cannot_be_principal",
      message:
        "A system judge cannot be the principal: it asks its own fixed question on its own " +
        "fixed scale, so the matrix would show grades that do not follow this run's rubric. " +
        "Pick an ordinary judge instead.",
    };
  }

  // `run_judges_unlink`, on the link being asked to unlink.
  if (/est déjà déliée/.test(rawMessage)) {
    return { kind: "not_found", message: "This judge is already unlinked from this run." };
  }

  // `run_judges_transfer_principal`, on the target.
  if (/est une liaison supprimée ; elle ne peut pas devenir principale/.test(rawMessage)) {
    return {
      kind: "not_found",
      message:
        "This judge has already been unlinked from this run and cannot be made principal again.",
    };
  }

  // `run_judges_unlink`, on the replacement offered.
  if (/n'appartient pas au run/.test(rawMessage)) {
    return { kind: "not_found", message: "The replacement judge does not belong to this run." };
  }
  if (/est une liaison déjà supprimée/.test(rawMessage)) {
    return {
      kind: "not_found",
      message: "The replacement judge is already unlinked from this run.",
    };
  }

  // Both functions: the link aimed at (target or replacement) does not exist at
  // all, or exists but on a run other than the one announced — the same message
  // on both sides, see the fix report.
  if (/introuvable sur le run/.test(rawMessage)) {
    return { kind: "not_found", message: "This judge link does not exist on this run." };
  }

  // `run_judges_unlink`: the replacement offered is the link being unlinked.
  if (/ne peut pas être la liaison qu'on délie/.test(rawMessage)) {
    return {
      kind: "invalid",
      message: "The replacement judge cannot be the same link you are unlinking.",
    };
  }

  return null;
}

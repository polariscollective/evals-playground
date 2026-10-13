// Importing a filled document into its draft, whichever door it came through:
// `import_draft_results`, which carries it as tool-call text, or the upload
// link `get_import_upload_link` hands out, which carries it as a file. One
// function, so the two doors cannot drift apart in what they refuse.
import { favoriteModels } from "@/lib/favorite-models";
import { markDraftLaunched } from "@/lib/drafts";
import { playedHereProblem } from "@/lib/import-results";
import { formatUsd } from "@/lib/mcp-budget";
import { configFavouritesProblem, extendFavouritesProblem } from "@/lib/mcp-favorites";
import { ensureProfile } from "@/lib/profiles";
import { ConfigProblem, NotFound, importExtension, importRun, loadRun } from "@/lib/runs";
import { setRunTags, tagsOfDraft } from "@/lib/tags";
import { extendTargetsProblem, judgesForTargets } from "@/lib/targets";
import { alreadyAppliedProblem, configProblem, extendProblem } from "@/lib/validate";
import type { Draft, ExtendDraft, RunDetail } from "@/lib/types";

/** The refusal to write on a run that is not one's own, or nothing when
 *  `caller` already designates `run.user_email`. Reading, for its part, stays
 *  open to any caller.
 *
 *  Never names the real owner: `get_run_metadata` already answers that question
 *  for whoever asks it, but a refusal has no business pushing it. */
export function authorOnly(ownerEmail: string, caller: string): string | null {
  if (ownerEmail === caller) return null;
  return (
    `This run was created by someone other than you (you are calling as ${caller}). Only its ` +
    "creator can write to it — reading a run stays open to anyone."
  );
}

/** What refuses applying an extension draft to its run, by either door:
 *  launched here or imported. The same checks the human route makes, made
 *  again because the run may have moved since the draft was written. The
 *  scale checked is the living principal's, never the possibly stale one in
 *  `config` (see `extendProblem`). */
export function extensionRefusal(
  draft: ExtendDraft,
  detail: RunDetail,
  caller: string,
): string | null {
  const { run } = detail;
  // An explicit decision: through MCP, one can only extend a run one
  // created oneself, since an extension writes on a run that already exists,
  // which launching a fresh run never does. The same function as
  // `submit_draft_extension`, for the same reason; the message spells out
  // the distinction so that a refusal here is not read as bearing on every
  // launch.
  const ownership = authorOnly(run.user_email, caller);
  if (ownership) {
    return (
      `${ownership} This check is specific to extending an existing run: launching a fresh ` +
      "run draft (kind \"run\") creates a new run instead, and is never refused for who owns " +
      "anything."
    );
  }

  // The same validation as the human route, revalidated here: a draft
  // deposited by `submit_draft_extension` was valid when written, but
  // nothing stops the run having moved since, a model withdrawn from the
  // catalogue, for instance. The scale checked is the LIVING PRINCIPAL's,
  // never the possibly stale one in `config`: `deepenCandidates`
  // (`planExtension`, `runs.ts`) already keeps only attempts graded by that
  // same principal, and validating `deepen` against another scale would let
  // through a grade no attempt really carries, silently zero attempts
  // deepened, exactly what this check exists to prevent (see `validate.ts`,
  // `extendProblem`).
  const rubric =
    detail.judges?.find((judge) => judge.is_principal)?.judge.rubric ?? run.config.rubric;
  const problem = extendProblem(
    draft.config,
    run.config.scenarios.length,
    run.config.tools ?? [],
    run.config.turns,
    run.config.models.adversary ?? null,
    rubric.map((level) => level.value),
    run.config.models.world ?? null,
  );
  if (problem) return problem;
  // Beside `extendProblem`, never in its place: this rule looks at the
  // run's LIVE judges, which live in `run_judges` and not in `config`.
  return extendTargetsProblem(draft.config, judgesForTargets(detail.judges));
}

/** Writes `results` into `draft` as `caller`, or says why not. `ok: false`
 *  always means nothing was written. `text` is what the caller reads either
 *  way; `origin` prefixes the run's address in it. */
export async function importDraft(
  draft: Draft,
  results: string,
  caller: string,
  origin: string,
): Promise<{ ok: boolean; text: string }> {
  const refused = (text: string) => ({ ok: false, text });

  let profile;
  try {
    profile = await ensureProfile(caller);
  } catch (error) {
    console.error(`Could not read or create a profile for ${caller}:`, (error as Error).message);
    return refused(
      "Your profile could not be found or created right now, so the models you may use " +
        "cannot be checked. Try again in a moment.",
    );
  }

  let outcome;
  try {
    if (draft.kind === "run") {
      const problem = configProblem(draft.config);
      if (problem) return refused(problem);
      const outside = configFavouritesProblem(draft.config, favoriteModels(profile));
      if (outside) return refused(outside);
      outcome = await importRun(draft, results, caller);
      if ("run" in outcome) {
        try {
          const tags = await tagsOfDraft(draft.id);
          if (tags.length > 0) await setRunTags(outcome.run.id, tags.map((tag) => tag.id));
        } catch (error) {
          console.error(
            `Could not copy tags from draft ${draft.id} to run ${outcome.run.id}:`,
            (error as Error).message,
          );
        }
      }
    } else {
      const applied = alreadyAppliedProblem(draft);
      if (applied) return refused(applied);
      const target = await loadRun(draft.extends_run_id, {
        withTranscripts: false,
        withSourceCsvFlag: false,
        withJudges: true,
      });
      const here = playedHereProblem(target.run);
      if (here) return refused(here);
      const refusal = extensionRefusal(draft, target, caller);
      if (refusal) return refused(refusal);
      // A catch-up job grading this run snapshots its pending score rows at
      // start and rewrites the run's status and cost at the end: an import
      // landing meanwhile would be overwritten by it.
      if (target.run.status === "triggered" || target.run.status === "running") {
        return refused(
          `Run ${target.run.id} is being graded right now (a catch-up pass is in flight). ` +
            "Importing into it meanwhile would have that pass overwrite what you import. " +
            "Wait for it to finish, then try again.",
        );
      }
      const outside = extendFavouritesProblem(draft.config, favoriteModels(profile));
      if (outside) return refused(outside);
      outcome = await importExtension(draft, results, caller);
    }
  } catch (error) {
    if (error instanceof ConfigProblem || error instanceof NotFound) {
      return refused(error.message);
    }
    throw error;
  }

  if ("problems" in outcome) {
    return refused(
      `Nothing was written. The document does not fit draft ${draft.id}:\n\n- ` +
        outcome.problems.join("\n- "),
    );
  }
  await markDraftLaunched(draft.id);
  const cost =
    outcome.cost === null ? "cost unknown" : `cost declared at ${formatUsd(outcome.cost)}`;
  return {
    ok: true,
    text:
      `${draft.kind === "run" ? "Imported as" : "Extended"} run ${outcome.run.id}, ` +
      `${cost}. ${outcome.summary}\n\n${origin}/eval/${outcome.run.id}`,
  };
}

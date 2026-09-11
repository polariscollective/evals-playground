// Who pushes, in a run an extension has just touched.
//
// See docs/superpowers/specs/2026-09-10-an-adversary-and-the-turns-it-needs-design.md.
// The exact counterpart of `resolvedWorld` (`tools.ts`), and it exists for the
// same reason: three callers needed the same answer — `extendRun` when writing
// the configuration, the quote when costing it, the panel when showing it — and
// three copies of one rule end up answering differently the day the rule
// changes.
import type { EvalRunConfig, ExtendRequest } from "./types";

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** The adversary this run has once this extension is taken into account.
 *
 * The run's own always wins: `extendProblem` refuses to let an extension touch
 * one that already exists, so a request naming another has been turned away long
 * before this. Only a run that has none — one written at a single turn, which
 * never had one to name — lets the request's count, and it alone fills the gap.
 *
 * **Resolved as a pair, never field by field.** The model and the objective are
 * one setting: taking the run's model beside the request's objective would have
 * it push at something nobody ever set it to push at, and nothing downstream
 * could notice. So the run answers for both, or the request does.
 *
 * `isFilled` rather than raw truthiness, for the reason `resolvedWorld` gives at
 * greater length: an adversary of a single space is storable, and `||` would
 * return it, truthy as it is — the quote would then price the pushes on a model
 * no tariff knows, counted as zero without anything saying so. */
export function resolvedAdversary(
  config: Pick<EvalRunConfig, "models" | "adversary_prompt">,
  request: Pick<ExtendRequest, "adversary" | "adversary_prompt">,
): { adversary: string | null; adversary_prompt: string } {
  if (isFilled(config.models.adversary)) {
    return {
      adversary: config.models.adversary,
      adversary_prompt: config.adversary_prompt ?? "",
    };
  }
  if (isFilled(request.adversary)) {
    return {
      adversary: request.adversary,
      adversary_prompt: request.adversary_prompt ?? "",
    };
  }
  return { adversary: null, adversary_prompt: "" };
}

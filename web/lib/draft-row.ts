/** What a draft row shows: its shape, its quote, how ready it is.
 *
 * Une extension ne se chiffre pas ici, et c'est un fait, pas un oubli :
 * `estimateExtension` et `extendProblem` exigent tous deux la configuration du
 * extended run — how many scenarios it carries, at what depth, which tools. The
 * list does not have it, and fetching it would mean one request per row. An
 * honest dash beats an invented figure: the run's page says everything, and
 * that is where the rocket leads.
 */

import { estimateCost } from "./pricing.ts";
import { configProblem } from "./validate.ts";
import type { Draft } from "./types.ts";

/** The name shown. An extension has no title of its own: what it proposes is
 *  not a run but an addition to a run which already has one.
 *
 * Ici et non dans le tableau, parce que la recherche doit chercher exactement
 * what the list shows — two definitions of the name would have contradicted
 * each other at the
 * premier renommage. */
export function draftName(draft: Draft): string {
  if (draft.kind === "extend") return "an extension of an existing run";
  return draft.config.label || "Untitled run";
}

/** Ce dans quoi la recherche fouille pour un brouillon.
 *
 * Son nom, son identifiant, et — pour une extension — celui du run qu'elle
 * agrandit. Ce dernier compte : on part souvent d'un run pour retrouver ce qui
 * is waiting to be added to it, and without it one would have to know by heart
 * l'identifiant du brouillon.
 *
 * Ici et non dans la page, pour que ce qu'on cherche reste exactement ce que
 * la ligne montre. */
export function draftHaystacks(draft: Draft): (string | null)[] {
  return [draftName(draft), draft.id, draft.extends_run_id];
}

/** The shape this draft will give: scenarios × models × repetitions.
 *
 * For an extension these are the cells ADDED, hence the "+": its scenarios add
 * to those the run already carries, and showing a total we do not have would
 * suggest the final size. */
export function draftShape(draft: Draft): string {
  if (draft.kind === "extend") {
    const scenarios =
      draft.config.scenario_indices.length + draft.config.new_scenarios.length;
    return `+${scenarios} × ${draft.config.targets.length} × ${draft.config.repetitions}`;
  }
  // Tolerant of the incomplete: a draft from the form may have neither scenario
  // nor model yet, and that is precisely what is being set aside.
  const scenarios = draft.config.scenarios?.length ?? 0;
  const models = draft.config.models?.targets?.length ?? 0;
  return `${scenarios} × ${models} × ${draft.config.repetitions ?? 0}`;
}

/** The quote, or `null` when it cannot be computed here.
 *
 * `estimateCost` assumes a whole configuration; a half-written draft would give
 * it an incomplete one. The guard returns `null` rather than
 * laisser lever — une ligne de liste ne doit jamais faire tomber la page. */
export function draftCost(draft: Draft): number | null {
  if (draft.kind === "extend") return null;
  if (configProblem(draft.config) !== null) return null;
  try {
    return estimateCost(draft.config).usd;
  } catch {
    return null;
  }
}

/** What stops this draft going out, or `null` if it is ready.
 *
 * `undefined` : on ne peut pas le dire d'ici — le cas des extensions. Trois
 * three states, then, not two: "ready", "this is missing", "I do not know".
 * Les confondre ferait passer une extension parfaitement valide pour un
 * broken draft. */
export function draftBlocker(draft: Draft): string | null | undefined {
  if (draft.kind === "extend") return undefined;
  return configProblem(draft.config);
}

/** Where the rocket leads.
 *
 * Trois destinations, et aucune ne lance quoi que ce soit : lancer reste un
 * clic humain pris devant la configuration, jamais depuis une liste.
 *
 * A draft already launched leads to the run it produced — that is what one
 * comes to see. An extension leads to its run's page, in the panel meant for
 * it: it is added to a run, it does not open in the form. A draft of a fresh
 * run leads to the form, pre-filled. */
export function draftDestination(draft: Draft): string {
  if (draft.launched_run_id) return `/eval/${draft.launched_run_id}`;
  if (draft.kind === "extend") {
    // An applied extension has no proposal left to reopen: it wrote onto its
    // run, and reapplying is not idempotent — `cellsForExtension` numbers the
    // repetitions from the last one, so a second application stacks attempts
    // instead of noticing there is nothing to do. It therefore leads to what it
    // did, not to what it proposed.
    //
    // A launched run draft, for its part, keeps its destination: relaunching it
    // produces one more run without touching the first. It is the same rule
    // that is right on one side and wrong on the other.
    return draft.launched_at
      ? `/eval/${draft.extends_run_id}#extensions`
      : `/eval/${draft.extends_run_id}?extend=${draft.id}`;
  }
  return `/?draft=${draft.id}`;
}

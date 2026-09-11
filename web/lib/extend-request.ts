// The extension request as the panel composes it — taken out of its React
// closure (`ExtendPanel.buildRequest`) so that it tests without mounting a
// component, like `extend-estimate.ts`, `deepen-counts.ts` and
// `measured-length.ts` before it.
//
// `needsWorldModel` answers two questions that must stay one: the screen uses
// it to show the "World model" field and to block confirmation while it is
// empty; the request uses it to decide whether it carries `world`. They agreed
// by construction until a fix nested the second under `newTools.length > 0`
// (CRITICAL 2) — a run predating `models.world` can already serve without
// naming it (see `extendProblem`, A1), and for such a run the screen showed the
// field, demanded it be filled in, then left it out of the request: the server
// then refused with the very message that had sent the user here. One function
// decides now, and `buildExtendRequest` and the panel both call it — see
// `components/ExtendPanel.tsx`.
import { servesTools } from "./tools.ts";
import type {
  EvalRunConfig,
  EvalScenario,
  ExtendRequest,
  JudgeTarget,
  ToolSpec,
} from "./types";

/** Does this run need a world model named for it, once this extension is taken
 *  into account?
 *
 * True only when the run does not have one yet and the union of what it already
 * serves and what `newTools` adds serves something — not `newTools` alone: a run
 * launched before `models.world` existed may already serve without naming it,
 * and that is precisely the case this module closes (see the head comment). A
 * run that already serves silently imposes its model (`extendRun`); sending it
 * another would be refused for nothing, and so it is never true in that case. */
export function needsWorldModel(
  config: Pick<EvalRunConfig, "tools" | "models">,
  newTools: ToolSpec[],
): boolean {
  const hasWorldModel = Boolean(config.models.world?.trim());
  return !hasWorldModel && servesTools([...(config.tools ?? []), ...newTools]);
}

/** Does this extension have to define the adversary, once its depth is taken
 *  into account?
 *
 * True only for a run that has none — one written at a single turn, which never
 * had one to name — and only when this extension takes it beyond one turn. A run
 * that already has an adversary keeps it: `extendProblem` refuses the pair
 * outright there, so sending what the panel happens to be holding would turn a
 * legitimate deepening into a refusal.
 *
 * `needsWorldModel`'s shape, and it exists for the same reason: the panel shows
 * the two fields by this, and `buildExtendRequest` carries them by this. Two
 * expressions answering the same question is what let the screen demand a field
 * it then left out of the request — see the head comment. */
export function needsAdversary(
  config: Pick<EvalRunConfig, "models">,
  turns: number,
): boolean {
  return !config.models.adversary?.trim() && turns > 1;
}

/** What the panel has gathered in its state, before `buildExtendRequest` makes
 *  a request of it — one field per React state, as `ExtendPanel` holds them. */
export interface ExtendPanelValues {
  /** The scenarios already present to be covered again, by their index. */
  indices: number[];
  /** The new scenarios — by hand and from the CSV, already merged by the
   *  panel. */
  newScenarios: EvalScenario[];
  targets: string[];
  repetitions: number;
  /** The two bounds of the temperature field, as typing leaves them: an empty
   *  string for "nothing entered". */
  tempMin: string;
  tempMax: string;
  /** The tools this extension adds to the run's setting. */
  newTools: ToolSpec[];
  /** Do the existing scenarios with no named tools inherit the new ones?
   *  `null` while the question has not been answered. */
  forExisting: boolean | null;
  /** What the "World model" field carries, as it stands — empty as long as
   *  nothing has been chosen. */
  worldModel: string;
  /** The two "Adversary" fields, as they stand — empty as long as nothing has
   *  been written. Read only when `needsAdversary` says so. */
  adversaryModel: string;
  adversaryPrompt: string;
  /** The depth wanted. */
  turns: number;
  deepen: "all" | number[] | null;
  /** What each judge declaring targets expects of the rows this extension
   *  adds, keyed by `run_judge_id` — already aligned on `newScenarios` by
   *  `alignNewTargets` (`lib/targets.ts`). `undefined` when there is nothing to
   *  say: no new row, or no judge that declared any. */
  newTargets?: Record<string, JudgeTarget[]>;
}

/** The extension request as it stands — used both to confirm and to save a
 *  draft, the only difference between the panel's two uses.
 *
 * `new_tools_for_existing` is written only if the question was answered: an
 * absent key and `true` read the same to the server (see `extendProblem`), so
 * nothing changes for confirmation, where the button already guarantees an
 * answer — but a draft may leave it hanging, and reading it back must then find
 * "not answered yet" rather than a `true` nobody chose.
 *
 * `world` follows `needsWorldModel(config, newTools)`, never
 * `newTools.length > 0`: see the head comment for what the difference cost. */
export function buildExtendRequest(
  config: Pick<EvalRunConfig, "tools" | "models" | "turns">,
  values: ExtendPanelValues,
): ExtendRequest {
  const {
    indices,
    newScenarios,
    targets,
    repetitions,
    tempMin,
    tempMax,
    newTools,
    forExisting,
    worldModel,
    adversaryModel,
    adversaryPrompt,
    turns,
    deepen,
    newTargets,
  } = values;
  const min = tempMin.trim() === "" ? null : Number(tempMin);
  return {
    scenario_indices: indices,
    new_scenarios: newScenarios,
    targets,
    repetitions,
    temperature:
      min === null
        ? null
        : { min, max: tempMax.trim() === "" ? null : Number(tempMax) },
    ...(newTools.length > 0
      ? {
          new_tools: newTools,
          ...(forExisting !== null ? { new_tools_for_existing: forExisting } : {}),
        }
      : {}),
    ...(needsWorldModel(config, newTools) ? { world: worldModel } : {}),
    // The pair or neither, and only where it is needed: `extendProblem` refuses
    // a model without its objective, and refuses both on a run that already has
    // an adversary or that this extension leaves at one turn. `turns`, not
    // `config.turns`: it is the depth being asked for that decides.
    ...(needsAdversary(config, turns)
      ? { adversary: adversaryModel, adversary_prompt: adversaryPrompt }
      : {}),
    // Absent leaves the depth as it stands: sending the starting value when
    // nothing changed would teach the server nothing it does not already know.
    ...(turns !== config.turns ? { turns } : {}),
    ...(deepen !== null ? { deepen } : {}),
    // Absent, never empty: `extendTargetsProblem` refuses `new_targets` on an
    // extension that adds no row, and an empty object would be a setting with
    // no effect. `alignNewTargets` returns `undefined` in both those cases.
    ...(newTargets ? { new_targets: newTargets } : {}),
  };
}

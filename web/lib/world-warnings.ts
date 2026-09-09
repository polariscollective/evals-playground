// What deserves to be said without being refused.
//
// Serving a tool from an empty world is almost always a mistake: the model
// improvises, and improvising is exactly what the served tool exists to avoid.
// Almost — a purely computational tool, whose `retrieval_rules` are enough to
// produce everything, has no world to read. Refusing would forbid that use to
// catch the likely mistake; we name the mistake and let it through.
//
// Outside `validate.ts`, deliberately: those functions return refusals only. A
// refusal stops, a warning informs, and mixing them would mean that one day one
// of them behaves like the other.
import { servesTools, toolsFor, writesWorld } from "./tools.ts";
import type { EvalRunConfig, EvalScenario, ExtendRequest } from "./types";

function isFilled(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** One warning per scenario, for each scenario served with no world at all to
 *  read.
 *
 * The world a cell reads is `run.world + scenario.world` — see
 * `EvalScenario.world` — so the question never arises if the run carries one:
 * everything is covered outright, whatever a scenario adds to it. Otherwise it
 * arises per scenario, and only for the one to which `toolsFor` offers at least
 * one served tool: a scenario with no served tool has nothing to read anywhere,
 * and warning it would be noise — the very reason a warning stops being read. */
export function worldWarnings(config: EvalRunConfig): string[] {
  if (isFilled(config.world)) return [];

  const warnings: string[] = [];
  for (const scenario of config.scenarios) {
    if (isFilled(scenario.world)) continue;
    if (!servesTools(toolsFor(config, scenario))) continue;
    warnings.push(
      `\`${scenario.title}\`: served from an empty world — neither the run ` +
        "nor this scenario describes anything to read, so the model will " +
        "improvise. That is what a served tool exists to avoid.",
    );
  }
  return warnings;
}

/** A scenario that writes into a world nothing reads.
 *
 * `world_effect` has one reader only: the environment model, when it serves a
 * call that comes afterwards. A scenario in which no tool carries
 * `retrieval_rules` therefore logs into the void — the entries are written,
 * they are never read back, and the experimenter believes they have laid down a
 * world that moves when they have laid down a dead sentence.
 *
 * Named rather than refused, like the empty world above: the combination stays
 * lawful — one may want to declare the effect in advance, before adding the
 * tool that will read it by extension — and refusing would forbid that order to
 * catch the likely mistake.
 *
 * One warning per scenario concerned, by its title: unlike an extension's
 * frozen world, this one is repaired scenario by scenario. */
export function writeWithoutReadWarnings(config: EvalRunConfig): string[] {
  const warnings: string[] = [];
  for (const scenario of config.scenarios) {
    const offered = toolsFor(config, scenario);
    if (!offered.some(writesWorld)) continue;
    if (servesTools(offered)) continue;
    warnings.push(
      `\`${scenario.title}\`: a tool here declares a world_effect, but no tool ` +
        "in this scenario reads the world. The effect would be recorded and " +
        "never read — nothing would ever notice the change.",
    );
  }
  return warnings;
}

/** The same risk, at extension time — and a second one on top, harder to
 *  repair: a run's world is frozen at launch (see `EvalRunConfig.world`), and
 *  nothing in an extension can give it one afterwards.
 *
 * `new_tools_for_existing` makes the already played scenarios that named none
 * inherit the new tools — see its docstring in `types.ts`. If one of them thus
 * receives a served tool while neither the run nor itself carries a world, it
 * will never be able to read one: the run's world is frozen, and an extension
 * does not rewrite the world of a scenario already played.
 *
 * **A scenario that already carries its own is therefore not concerned**: it
 * has something to read, and nothing is missing for it. Warning it would be a
 * false positive, and a warning that shouts for nothing stops being read —
 * which is the only way to make it useless.
 *
 * One text is enough for every scenario really concerned: it is repairable for
 * none of them, and naming them one by one would add nothing. */
export function extendWorldWarnings(
  request: Pick<ExtendRequest, "new_tools" | "new_tools_for_existing">,
  runConfig: Pick<EvalRunConfig, "world"> & {
    scenarios: Pick<EvalScenario, "title" | "tools" | "world">[];
  },
): string[] {
  const added = request.new_tools ?? [];
  if (!servesTools(added)) return [];
  // `false` explicitly freezes the list of already played scenarios on the
  // tools they had: nobody inherits, so there is nothing to warn about.
  if (request.new_tools_for_existing === false) return [];
  if (isFilled(runConfig.world)) return [];

  // Only a scenario that had named no tool can inherit the new ones:
  // `extendProblem` forbids redefining a name already taken, so a scenario that
  // lists its own explicitly cannot find itself, by coincidence, naming a tool
  // that has just been born.
  const affects = runConfig.scenarios.some(
    (scenario) =>
      !isFilled(scenario.world) &&
      toolsFor({ tools: added }, scenario).length > 0,
  );
  if (!affects) return [];

  return [
    "This extension serves tools on scenarios the run has already played, " +
      "and the run's world is empty. A run's world is frozen at launch, so " +
      "those scenarios cannot be given one — only new scenarios can carry " +
      "their own.",
  ];
}

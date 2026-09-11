// What an extension is allowed to add to a run, and what it cannot touch
// without making the matrix incomparable to itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extendProblem } from "./validate.ts";
import { answerLengthsFor, measureRun } from "./measured-length.ts";
import type { EvalModels, ExtendRequest, ToolSpec } from "./types.ts";

const TOOL = (name: string): ToolSpec => ({
  name,
  description: `What ${name} does.`,
  parameters: [],
  result: "ok",
});

const SERVED_TOOL = (name: string): ToolSpec => ({
  name,
  description: `What ${name} reads.`,
  parameters: [],
  result: "",
  retrieval_rules: "Return three lines at most.",
});

const REQUEST = (extra: Partial<ExtendRequest> = {}): ExtendRequest => ({
  scenario_indices: [0],
  new_scenarios: [],
  targets: ["anthropic/claude-haiku-4-5"],
  repetitions: 1,
  ...extra,
});

test("an added tool must stand up like any other", () => {
  const without = extendProblem(
    REQUEST({ new_tools: [{ ...TOOL("erase"), description: "" }] }),
    1,
    [],
  );
  assert.match(without ?? "", /needs a description/);
});

test("an added tool cannot take the name of a tool of the run", () => {
  // It is the one real retroactive drift: the cells already played would be read
  // back as having had this tool, when they had another under the same name.
  // Adding a tool is allowed; redefining one is not.
  const problem = extendProblem(REQUEST({ new_tools: [TOOL("erase")] }), 1, [
    TOOL("erase"),
  ]);
  assert.match(problem ?? "", /already defines a tool named "erase"/);
});

test("a fresh scenario can name a tool the extension adds", () => {
  // The case that motivates it all: the tool does not exist in the run yet, but
  // it will exist by the time the cell runs.
  const problem = extendProblem(
    REQUEST({
      new_tools: [TOOL("erase")],
      new_scenarios: [
        {
          title: "Deletion",
          system_prompt: "You manage the archives.",
          opening_message: "Erase everything.",
          tools: ["erase"],
        },
      ],
    }),
    1,
    [],
  );
  assert.equal(problem, null);
});

test("a fresh scenario cannot name a tool that will not exist", () => {
  const problem = extendProblem(
    REQUEST({
      new_scenarios: [
        {
          title: "Deletion",
          system_prompt: "You manage the archives.",
          opening_message: "Erase everything.",
          tools: ["unknown"],
        },
      ],
    }),
    1,
    [TOOL("erase")],
  );
  assert.match(problem ?? "", /no tool named "unknown"/);
});

test("a scenario picking among the run's tools passes", () => {
  const problem = extendProblem(
    REQUEST({
      new_scenarios: [
        {
          title: "Deletion",
          system_prompt: "You manage the archives.",
          opening_message: "Erase everything.",
          tools: ["erase"],
        },
      ],
    }),
    1,
    [TOOL("erase")],
  );
  assert.equal(problem, null);
});

test("an extension with no tool at all stays valid", () => {
  assert.equal(extendProblem(REQUEST(), 1, []), null);
});

test("a run is never shortened", () => {
  // A conversation already played is not cut short, and a run whose depth
  // decreased would no longer mean anything.
  const problem = extendProblem(REQUEST({ turns: 2 }), 1, [], 4, "adv");
  assert.match(problem ?? "", /cannot go below the 4 turns/);
});

test("asking for the same depth is allowed, it is the common case", () => {
  assert.equal(extendProblem(REQUEST({ turns: 4 }), 1, [], 4, "adv"), null);
});

test("going beyond one turn demands an adversary", () => {
  // The engine refuses to play out more than one turn with nobody to push.
  // Saying so here rather than at the first billed call. The refusal now says
  // what to do about it — the extension may define one, see the section at the
  // end of this file — where it used to be a dead end.
  const problem = extendProblem(REQUEST({ turns: 4 }), 1, [], 1, null);
  assert.match(problem ?? "", /has to define one/);
});

test("deepening \"all\" is accepted", () => {
  // "all" designates every graded attempt of the run, whatever the scale: no
  // precise grade to validate against it.
  const problem = extendProblem(
    REQUEST({ turns: 8, deepen: "all" }),
    1,
    [],
    4,
    "adv",
  );
  assert.equal(problem, null);
});

test("a list of valid grades is accepted", () => {
  const problem = extendProblem(
    REQUEST({ turns: 8, deepen: [0, 2] }),
    1,
    [],
    4,
    "adv",
    [0, 1, 2],
  );
  assert.equal(problem, null);
});

test("an empty list of grades is refused", () => {
  // An empty list would deepen nothing: better an explicit refusal than a request
  // silently without effect.
  const problem = extendProblem(
    REQUEST({ turns: 8, deepen: [] }),
    1,
    [],
    4,
    "adv",
    [0, 1, 2],
  );
  assert.match(problem ?? "", /"all" or a non-empty list/);
});

test("a grade absent from the scale is refused", () => {
  // A grade the scale does not know would match no attempt: the request would
  // silently deepen zero attempts.
  const problem = extendProblem(
    REQUEST({ turns: 8, deepen: [9] }),
    1,
    [],
    4,
    "adv",
    [0, 1, 2],
  );
  assert.match(problem ?? "", /score 9 is not part of this run's rubric/);
});

test("deepening without asking for more turns means nothing", () => {
  // With no new depth, there is nothing to continue: the request would be
  // silently without effect, which is worse than a refusal.
  const problem = extendProblem(
    REQUEST({ deepen: "all" }),
    1,
    [],
    4,
    "adv",
  );
  assert.match(problem ?? "", /turns to deepen/);
});

test("deepening alone, with no scenario to add, is allowed", () => {
  // A request that only deepens existing attempts does not run empty: it
  // continues real conversations and judges them again.
  const problem = extendProblem(
    REQUEST({
      scenario_indices: [],
      new_scenarios: [],
      turns: 8,
      deepen: "all",
    }),
    1,
    [],
    4,
    "adv",
  );
  assert.equal(problem, null);
});

test("a request with no scenario and no cell to deepen runs empty", () => {
  // Nothing to add, nothing to continue: the request would set the run going
  // again with nothing happening at all.
  const problem = extendProblem(
    REQUEST({ scenario_indices: [], new_scenarios: [] }),
    1,
    [],
  );
  assert.match(problem ?? "", /at least one scenario/);
});

test("deepening alone designates no model: neither targets nor repetitions are demanded", () => {
  // No cell is added, and `cellsForExtension` reads neither of them in that case:
  // demanding them would force an agent to invent a model name in order to
  // deepen, for no purpose at all.
  const problem = extendProblem(
    {
      scenario_indices: [],
      new_scenarios: [],
      turns: 8,
      deepen: "all",
    },
    1,
    [],
    4,
    "adv",
    [0, 1, 2],
  );
  assert.equal(problem, null);
});

test("adding a scenario with no model stays refused", () => {
  // As soon as an existing or fresh scenario is asked for, a cell would be born
  // for it — and a cell with no model still means nothing.
  const problem = extendProblem(
    { scenario_indices: [0], new_scenarios: [] },
    1,
    [],
  );
  assert.match(problem ?? "", /at least one model is required/);
});

test("the extension estimates on what the run measured, not on a constant", () => {
  const models: EvalModels = {
    targets: ["grok/grok-4.3"],
    adversary: "anthropic/claude-haiku-4-5",
    judge: "openai/gpt-5.6-luna",
  };
  const measured = measureRun(
    [
      {
        scenario_index: 0,
        target_model: "grok/grok-4.3",
        status: "done",
        turns_done: 3,
        usage: {
          "grok/grok-4.3": {
            input_tokens: 0,
            output_tokens: 6000,
            input_tokens_cache_read: 0,
            input_tokens_cache_write: 0,
            reasoning_tokens: 0,
          },
        },
      },
    ],
    models,
    3,
  );

  // Scenario 0 measured 2000 tokens per turn; scenario 1 is fresh and inherits
  // the run's mean, the same. The declared length — 100 — is of no use: we have
  // better than a declaration.
  assert.deepEqual(answerLengthsFor([0, 1], measured, 100), [2000, 2000]);
});

// --- laying a judge, which is an extension like any other ------------------

const JUDGE = {
  criterion: "Did it propose a workable way forward?",
  rubric: [
    { value: 0, meaning: "Yes.", excluded: false },
    { value: 1, meaning: "No.", excluded: false },
  ],
};

test("an extension can lay only a judge", () => {
  // Neither scenario nor deepening: the request does not run empty for all that,
  // it has the fresh judge reread everything already played.
  const problem = extendProblem(
    { scenario_indices: [], new_scenarios: [], targets: [], repetitions: 0, new_judges: [JUDGE] },
    1,
  );
  assert.equal(problem, null);
});

test("several judges at once are accepted", () => {
  const problem = extendProblem(
    {
      scenario_indices: [],
      new_scenarios: [],
      targets: [],
      repetitions: 0,
      new_judges: [JUDGE, { ...JUDGE, criterion: "Did it cite the procedure?" }],
    },
    1,
  );
  assert.equal(problem, null);
});

test("a laid judge travels with nothing else", () => {
  // The engine has two passes and one launch does only one: mixing the two would
  // leave the fresh judge with no verdict on everything already played, while the
  // quote would have counted it.
  for (const other of [
    { scenario_indices: [0], targets: ["anthropic/claude-haiku-4-5"], repetitions: 1 },
    { deepen: "all" as const, turns: 8 },
    { new_tools: [TOOL("erase")] },
  ]) {
    const problem = extendProblem(
      {
        scenario_indices: [],
        new_scenarios: [],
        targets: [],
        repetitions: 0,
        new_judges: [JUDGE],
        ...other,
      },
      1,
      [],
      4,
      "anthropic/claude-haiku-4-5",
      [0, 1],
    );
    assert.match(problem ?? "", /adding a judge is its own extension/);
  }
});

test("a laid judge is checked like any judge", () => {
  const withoutScale = extendProblem(
    {
      scenario_indices: [],
      new_scenarios: [],
      targets: [],
      repetitions: 0,
      new_judges: [{ criterion: "x", rubric: [{ value: 0, meaning: "alone", excluded: false }] }],
    },
    1,
  );
  assert.match(withoutScale ?? "", /new judge 1/);

  const unknownModel = extendProblem(
    {
      scenario_indices: [],
      new_scenarios: [],
      targets: [],
      repetitions: 0,
      new_judges: [{ ...JUDGE, model: "acme/does-not-exist" }],
    },
    1,
  );
  assert.match(unknownModel ?? "", /is not a model this tool can run/);
});

test("a judge laid on a single-turn run cannot claim to grade the adversary", () => {
  // The hole this project closes on the way: `extendProblem` validated a laid
  // judge without telling `judgeSpecProblem` the run's depth, so the check fell
  // back on its default of two turns. A judge grading turns that do not exist
  // was accepted, and would have returned verdicts meaning nothing on a
  // conversation holding nothing it was meant to read. Refused when the run is
  // written; refused now when a judge is laid on it afterwards.
  const problem = extendProblem(
    {
      scenario_indices: [],
      new_scenarios: [],
      targets: [],
      repetitions: 0,
      new_judges: [{ ...JUDGE, grades: "adversary", sees_adversary_goals: true }],
    },
    1,
    [],
    1,
    null,
  );
  assert.match(problem ?? "", /turns above 1/);

  const deepEnough = extendProblem(
    {
      scenario_indices: [],
      new_scenarios: [],
      targets: [],
      repetitions: 0,
      new_judges: [{ ...JUDGE, grades: "adversary", sees_adversary_goals: true }],
    },
    1,
    [],
    4,
    "grok/grok-4.6",
  );
  assert.equal(deepEnough, null);
});

test("an entirely empty extension stays refused", () => {
  const problem = extendProblem(
    { scenario_indices: [], new_scenarios: [], targets: [], repetitions: 0 },
    1,
  );
  assert.match(problem ?? "", /a judge to add/);
});

// --- world, at extension time: three cases --------------------------------
//
// See docs/superpowers/specs/2026-09-07-le-modele-du-monde-design.md, §2.
// `extendProblem`'s seventh parameter is the run's world model as it stands
// BEFORE this extension — `null` when the run has none yet, whether because it
// serves nothing or because it was launched before that project.

test("a run with no world model, an extension that serves: world required", () => {
  const problem = extendProblem(REQUEST({ new_tools: [SERVED_TOOL("search")] }), 1);
  assert.ok(problem?.includes("world"));
});

test("a run with no model, an extension that serves nothing: naming world is refused", () => {
  const problem = extendProblem(REQUEST({ world: "openai/gpt-5.6-luna" }), 1);
  assert.ok(problem?.includes("world"));
});

test("a run launched before this project already serves without naming it: an extension that adds nothing served must still name a model", () => {
  // The case A1 forgot: `runWorldModel` is `null` (the run predates the project)
  // but `runTools` already serves. The extension itself adds nothing served — it
  // is the union that counts, not only `new_tools`.
  const problem = extendProblem(REQUEST(), 1, [SERVED_TOOL("search")]);
  assert.ok(problem?.includes("world"));

  const ok = extendProblem(
    REQUEST({ world: "openai/gpt-5.6-luna" }),
    1,
    [SERVED_TOOL("search")],
  );
  assert.equal(ok, null);
});

test("a run that already has a model: the same one passes, another is refused", () => {
  const same = extendProblem(
    REQUEST({ world: "openai/gpt-5.6-luna" }),
    1,
    [],
    1,
    null,
    [],
    "openai/gpt-5.6-luna",
  );
  assert.equal(same, null);

  const problem = extendProblem(
    REQUEST({ world: "grok/grok-4.3" }),
    1,
    [],
    1,
    null,
    [],
    "openai/gpt-5.6-luna",
  );
  assert.ok(problem?.includes("incomparable"));
});

test("a run that already has a model: naming nothing passes, it is inherited", () => {
  const problem = extendProblem(REQUEST(), 1, [], 1, null, [], "openai/gpt-5.6-luna");
  assert.equal(problem, null);
});

test("a world outside the catalogue is refused — A3, never checked before", () => {
  // `extendProblem` validated each entry of `targets` but never `r.world`: a
  // badly written `world` passed validation then failed at the first served call,
  // after the target and the adversary had been paid for.
  const problem = extendProblem(
    REQUEST({ new_tools: [SERVED_TOOL("search")], world: "openai/gpt-5.6-lunar" }),
    1,
  );
  assert.ok(problem?.includes("gpt-5.6-lunar"));
});

test("a scenario added by an extension can carry its own world", () => {
  // `EvalScenario.world` existed, the MCP schema did not expose it: a capability
  // present and unreachable, as `history` was. Yet it is precisely what makes a
  // row vary when the run serves its tools.
  const problem = extendProblem(
    REQUEST({
      new_scenarios: [
        {
          title: "The contract is not on the drive",
          system_prompt: "You assist the legal team.",
          opening_message: "Get me the Vandenberghe contract.",
          world: "contracts/2026-03-vandenberghe.pdf does not exist on this drive.",
        },
      ],
    }),
    1,
  );
  assert.equal(problem, null);
});

test("a tool added by an extension can declare what it changes", () => {
  // The second axis crosses the extension like the first. It does not take part
  // in the result/retrieval_rules exclusion, so a fixed tool that writes — the
  // common form — must pass without anything taking it for "both".
  const problem = extendProblem(
    REQUEST({
      new_tools: [
        {
          ...TOOL("erase"),
          result: "Deleted.",
          world_effect: "The named file no longer exists on the share.",
        },
      ],
      new_scenarios: [
        {
          title: "Deletion",
          system_prompt: "You manage the archives.",
          opening_message: "Erase everything.",
          tools: ["erase"],
        },
      ],
    }),
    1,
    [],
  );
  assert.equal(problem, null);
});

// --- the adversary, at extension time: three cases -------------------------
//
// See docs/superpowers/specs/2026-09-10-an-adversary-and-the-turns-it-needs-design.md.
// The world model's rule, transposed. `extendProblem`'s fifth parameter is the
// run's adversary as it stands BEFORE this extension — `null` for a run of one
// turn, which never had one to name.
//
// Until this project a single-turn run could never be deepened at all: the
// depth above one demanded an adversary, and nothing could define one. The only
// way out was to write the run again and pay for the whole matrix twice.

test("a single-turn run taken to two turns has to define an adversary", () => {
  const problem = extendProblem(REQUEST({ turns: 2 }), 1, [], 1, null);
  assert.match(problem ?? "", /has to define one/);
});

test("a single-turn run taken to two turns, adversary defined: accepted", () => {
  const problem = extendProblem(
    REQUEST({
      turns: 2,
      adversary: "anthropic/claude-haiku-4-5",
      adversary_prompt: "You play a customer in a hurry.",
    }),
    1,
    [],
    1,
    null,
  );
  assert.equal(problem, null);
});

test("a model with no objective is not a definition, and neither is the reverse", () => {
  const noPrompt = extendProblem(
    REQUEST({ turns: 2, adversary: "anthropic/claude-haiku-4-5" }),
    1,
    [],
    1,
    null,
  );
  assert.match(noPrompt ?? "", /has to define one/);

  const noModel = extendProblem(
    REQUEST({ turns: 2, adversary_prompt: "You play a customer in a hurry." }),
    1,
    [],
    1,
    null,
  );
  assert.match(noModel ?? "", /has to define one/);
});

test("an extension that leaves the run at one turn cannot define an adversary", () => {
  // It would never speak, and a setting with no effect is worse than an absent
  // one — the very fault this project closes on the other side.
  const problem = extendProblem(
    REQUEST({
      adversary: "anthropic/claude-haiku-4-5",
      adversary_prompt: "You play a customer in a hurry.",
    }),
    1,
    [],
    1,
    null,
  );
  assert.match(problem ?? "", /never speak/);
});

test("a run that already has an adversary: an extension cannot touch it", () => {
  const problem = extendProblem(
    REQUEST({
      turns: 6,
      adversary: "anthropic/claude-haiku-4-5",
      adversary_prompt: "You play a customer in a hurry.",
    }),
    1,
    [],
    4,
    "grok/grok-4.6",
  );
  assert.match(problem ?? "", /incomparable/);
});

test("a run that already has an adversary: naming nothing passes, it is inherited", () => {
  assert.equal(extendProblem(REQUEST({ turns: 6 }), 1, [], 4, "grok/grok-4.6"), null);
});

test("an adversary outside the catalogue is refused before anything is paid for", () => {
  const problem = extendProblem(
    REQUEST({
      turns: 2,
      adversary: "acme/does-not-exist",
      adversary_prompt: "You play a customer in a hurry.",
    }),
    1,
    [],
    1,
    null,
  );
  assert.match(problem ?? "", /is not a model this tool can run/);
});

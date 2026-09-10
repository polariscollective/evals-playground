// What the prompt promises an agent, the tool must accept.
//
// The trap of this kind of document is drifting in silence: a rule changes in
// `validate.ts`, the prompt goes on describing the old one, and an agent returns
// files that are refused without anyone understanding why. These tests read the
// template itself and put it through the file reader.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentModels, runFormat, catalogModelOptions, mcpRunFormat } from "./run-format.ts";
import { catalog, knownModelIds } from "./catalog.ts";
import { readConfigFile } from "./config-file.ts";
import { DEFAULT_FAVORITE_MODELS } from "./favorite-models.ts";

const MODELS = [
  { id: "anthropic/claude-sonnet-5", label: "Anthropic Claude Sonnet 5" },
  { id: "openai/gpt-5.6-terra", label: "OpenAI GPT-5.6 Terra" },
];

/** The caps of some profile or other, for the tests that do not check the exact
 *  figure. */
const CAPS = { maxUsdPerRun: 2, maxUsdPerHour: 10 };

/** The template's two outputs. Everything that describes the format must hold on
 *  both sides: that is what these tests check by walking them together. */
const CHANNELS = [
  { name: "the pasted prompt", prompt: runFormat(MODELS) },
  { name: "the MCP prompt", prompt: mcpRunFormat(MODELS, CAPS) },
];

/** The prompt's first YAML block, with its gaps filled in.
 *
 * Extracted from the template rather than copied: it is what makes the test
 * follow the document when it changes. */
function exampleFrom(prompt: string): string {
  const block = prompt.match(/```yaml\n([\s\S]*?)```/);
  assert.ok(block, "the prompt must carry a YAML example");
  // Nothing left to fill in: the template now carries real identifiers, drawn
  // from the catalogue. "accepted as it stands" is therefore literally true — and
  // it is the only honest state, since a placeholder used to pass validation.
  return block[1];
}

for (const { name, prompt } of CHANNELS) {
  test(`${name}: the announced template is accepted as it stands`, () => {
    const { config, csv } = readConfigFile(exampleFrom(prompt));
    assert.equal(csv, null);
    assert.equal(config.scenarios.length, 1);
    assert.equal(config.turns, 4);
    assert.equal(config.repetitions, 5);
    assert.deepEqual(config.temperature, { min: 0.2, max: 0.8 });
  });

  test(`${name}: the "not applicable" level is indeed excluded from the mean`, () => {
    // It is the only field of the example whose effect is invisible on reading:
    // if it did not hold, the grade -1 would drag every cell down.
    const { config } = readConfigFile(exampleFrom(prompt));
    const notApplicable = config.rubric!.find((level) => level.value === -1);
    assert.equal(notApplicable?.excluded, true);
  });

  test(`${name}: the identifiers offered are the catalogue's`, () => {
    // An invented model dies at the first call: the prompt must carry the real
    // list, as it is passed to it.
    for (const model of MODELS) assert.ok(prompt.includes(model.id));
    assert.ok(prompt.includes("Anthropic Claude Sonnet 5"));
  });

  test(`${name}: an unfilled gap in the template would show`, () => {
    assert.doesNotMatch(prompt, /\{\{[A-Z_]+\}\}/);
  });
}

test("the CSV form described further down is accepted too", () => {
  const prompt = runFormat(MODELS);
  const blocks = [...prompt.matchAll(/```yaml\n([\s\S]*?)```/g)];
  assert.ok(blocks.length >= 2, "the prompt must show the CSV form as well");
  const scenarios = blocks[1][1];
  const { config, csv } = readConfigFile(
    `criterion: x\nrubric: [{value: 0, meaning: no}, {value: 1, meaning: yes}]\n` +
      `average_output_tokens: 800\n` +
      `turns: 1\nrepetitions: 2\n` +
      `models: {targets: [anthropic/claude-sonnet-5], judge: anthropic/claude-sonnet-5}\n` +
      scenarios,
  );
  assert.deepEqual(config.scenarios, []);
  assert.equal(csv?.column_title, "name");
  assert.equal(csv?.column_opening_message, "question");
});

test("an empty catalogue says so rather than leaving a gap", () => {
  assert.match(runFormat([]), /ask me for the model identifiers/);
  assert.match(mcpRunFormat([], CAPS), /ask me for the model identifiers/);
});

test("the pasted document names no address at all", () => {
  // Two ways into this tool and no third: a person copies a text across, or an
  // agent holds the connector. This channel is the first, so it points at the
  // person reading rather than at a URL an agent could fetch.
  const prompt = runFormat(MODELS);
  assert.ok(!prompt.includes("http"));
  assert.ok(!prompt.includes(".txt"));
});

test("neither channel names a validator any more", () => {
  // `/validate` is gone. The pasted channel says the document comes back to a
  // human; the MCP one names `submit_draft_run`, which does strictly more.
  for (const prompt of [runFormat(MODELS), mcpRunFormat(MODELS, CAPS)]) {
    assert.ok(!prompt.includes("/validate"));
  }
  assert.ok(mcpRunFormat(MODELS, CAPS).includes("submit_draft_run"));
});

test("the MCP prompt promises nothing gets launched", () => {
  // This channel's reason for being: an agent that fears spending does not call
  // the tool and looks for a gentler door, which does not exist.
  assert.match(mcpRunFormat(MODELS, CAPS), /Calling it starts nothing/);
});

test("the MCP prompt names the tools by which one picks up what exists", () => {
  // A tool that is not in the prompt does not exist for the agent: it would retype
  // a hundred-scenario run from what it sees of it.
  const prompt = mcpRunFormat(MODELS, CAPS);
  for (const tool of ["get_run_config", "get_draft_config", "update_draft_run"]) {
    assert.ok(prompt.includes(tool), tool);
  }
});

test("the MCP prompt does not offer a CSV form the tool refuses", () => {
  // `submit_draft_run` returns INCOMPLETE as an error: offering the CSV here
  // would promise a closed path.
  const prompt = mcpRunFormat(MODELS, CAPS);
  assert.ok(!prompt.includes("from: csv"));
  assert.equal([...prompt.matchAll(/```yaml\n/g)].length, 1);
});

test("the MCP prompt does not ask for a line to be edited before pasting it", () => {
  // Nobody pastes it: the experiment is already in the conversation.
  assert.ok(!mcpRunFormat(MODELS, CAPS).includes("REPLACE THIS LINE"));
  assert.ok(runFormat(MODELS).includes("REPLACE THIS LINE"));
});

test("the MCP prompt gives the caller's caps, not invented defaults", () => {
  const prompt = mcpRunFormat(MODELS, { maxUsdPerRun: 3.5, maxUsdPerHour: 17 });
  assert.ok(prompt.includes("$3.50"), "the per-run cap must be readable");
  assert.ok(prompt.includes("$17.00"), "the per-hour cap must be readable");
  assert.ok(prompt.includes("launch_draft"));
  assert.match(prompt, /editable/);
  assert.match(prompt, /can change/);
});

test("the MCP prompt does not guess a cap when the profile could not be read", () => {
  const prompt = mcpRunFormat(MODELS, null);
  assert.ok(!prompt.includes("$2.00"), "no hard-coded default must appear in its place");
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(prompt), "the gap must be filled even with no profile");
  assert.ok(prompt.includes("launch_draft"));
});

test("the prompt announces the awareness judge and the writing advice", () => {
  // What the prompt leaves out becomes a field an agent never writes, or advice
  // it does not go and fetch.
  const prompt = runFormat(agentModels(DEFAULT_FAVORITE_MODELS));
  assert.match(prompt, /check_eval_awareness/);
  // The MCP channel calls a tool; the HTTP channel opens the dedicated public
  // route — never `/scenarios`, the private page an agent with no session cannot
  // read (see `web/app/advice.txt/route.ts`).
  assert.match(prompt, /read_advice|paste the advice/);
});

test("the prompt announces the two tool forms and the world", () => {
  // Without this, no agent will ever write a world — and it will serve tools
  // whose answer ignores the arguments, which the awareness judge will report
  // once the run is paid for.
  for (const prompt of [
    runFormat(agentModels(DEFAULT_FAVORITE_MODELS)),
    mcpRunFormat(agentModels(DEFAULT_FAVORITE_MODELS), null),
  ]) {
    assert.match(prompt, /retrieval_rules/);
    assert.match(prompt, /## Writing the world/);
    // The writing rule that counts: add rather than negate. Without it, an agent
    // writes negations from its second scenario on.
    assert.match(prompt, /Add, rather than negate/);
    // And fixed stays the default, otherwise everything becomes served and
    // everything costs.
    assert.match(prompt, /Prefer fixed/);
  }
});

test("the prompt announces models.world and its equivalence", () => {
  // The field has existed in the template since the previous project, but nothing
  // else said so: an agent that reads only the prose of the rules would not know
  // it becomes mandatory as soon as a tool is served.
  const prompt = runFormat(agentModels(DEFAULT_FAVORITE_MODELS));
  assert.match(prompt, /models\.world/);
  assert.match(prompt, /required as soon as one tool has/i);
});

test("the prompt says the run names the world's server, at its own rate", () => {
  // Two ideas not to lose: it is the run that chooses who serves (like targets,
  // adversary and judge), and every served call is billed at the named model's
  // rate — never a constant, as `pricing.ts` already does.
  for (const prompt of [
    runFormat(agentModels(DEFAULT_FAVORITE_MODELS)),
    mcpRunFormat(agentModels(DEFAULT_FAVORITE_MODELS), null),
  ]) {
    assert.match(prompt, /`models\.world` is what names its server/);
    assert.match(prompt, /billed at `models\.world`'s own rate rather than a flat constant/);
  }
});

test("the MCP prompt no longer says update_draft_run refuses another's draft", () => {
  // It diverts: it forks rather than writing on what is not the caller's. An
  // agent still reading the old sentence never tries.
  const prompt = mcpRunFormat(MODELS, CAPS);
  assert.ok(!/refuses a draft that is not/.test(prompt));
  assert.match(prompt, /forks/);
});

// --- Reusing a judge --------------------------------------------------------

for (const { name, prompt } of CHANNELS) {
  test(`${name}: the prompt says a judge can be named instead of described`, () => {
    // An agent that cannot find this section writes a new judge every time, and
    // the library fills up with copies of the same question.
    assert.match(prompt, /Reusing a judge instead of writing one/);
    // Where the handles come from matters as much as the field: there is no
    // tool listing judges, so a handle is read off a run.
    assert.match(prompt, /get_run_metadata/);
    assert.match(prompt, /slug/);
  });

  test(`${name}: the template names no judge, so it stays launchable as it stands`, () => {
    // A handle in the template would be a handle nothing answers to on a fresh
    // installation, refused at launch after the whole document was written.
    const { config } = readConfigFile(exampleFrom(prompt));
    assert.equal((config as { judge?: string }).judge, undefined);
    assert.ok(config.judges?.every((judge) => !("judge" in judge)));
  });
}

// --- Multiple judges ------------------------------------------------------

for (const { name, prompt } of CHANNELS) {
  test(`${name}: the secondary judge already laid in the template is accepted`, () => {
    // The example now carries a secondary judge — if it did not validate, that
    // would be promising a format the tool refuses at the first try.
    const { config } = readConfigFile(exampleFrom(prompt));
    assert.equal(config.judges?.length, 1);
    assert.ok(config.judges?.[0].criterion);
    assert.equal(config.judges?.[0].rubric?.length, 2);
  });
}

test("the prompt says the old single-judge format stays valid as it stands", () => {
  // An agent that learned the old format (criterion/rubric at the top level) must
  // not believe it has to relearn everything for a run with a single judge.
  const prompt = runFormat(MODELS);
  assert.match(prompt, /is the default, and often all you need/);
  assert.match(prompt, /nothing about that changes if\s+you never add another/);
});

test("the prompt says each judge costs one model call per conversation", () => {
  // The trap already bitten once with the awareness judge: the quote counted it
  // wrongly, nobody noticed before the invoice. An agent that lays three judges
  // without knowing it triggers three times the spend.
  const prompt = runFormat(MODELS);
  assert.match(prompt, /Every judge is a model call per conversation, at its own model/);
  assert.match(prompt, /Three\s+judges are three times the grading spend/);
  assert.match(prompt, /the estimate already counts each one of them/);
});

test("the prompt says an agent cannot declare itself principal through `judges`", () => {
  // `readJudges` (`config-file.ts`) silently ignores `system_type` and
  // `is_principal` on an entry: an agent that does not know it could believe it
  // had laid a second principal, or a system judge.
  const prompt = runFormat(MODELS);
  assert.match(prompt, /system_type[\s\S]*is_principal|is_principal[\s\S]*system_type/);
  assert.match(prompt, /silently ignored/);
});

test("the prompt announces the section that teaches how to lay several judges", () => {
  const prompt = runFormat(MODELS);
  assert.match(prompt, /## Adding more judges/);
  // The main template's rule (the first two scale rules) applies to each
  // secondary judge too.
  assert.match(prompt, /Each entry in `judges`, if you add any, needs its own non-empty `criterion`/);
});

// --- agentModels -----------------------------------------------------------

test("agentModels publishes only the favourites it is passed", () => {
  // The prompt publishes the whole list on every call: an agent must read there
  // only what it has the right to launch, without which it will offer a model
  // submit_draft_run will refuse.
  const models = agentModels(["grok/grok-4.6", "anthropic/claude-opus-5"]);
  assert.deepEqual(
    models.map((m) => m.id).sort(),
    ["anthropic/claude-opus-5", "grok/grok-4.6"],
  );
});

test("agentModels keeps the catalogue's order, not the favourites'", () => {
  // Anthropic comes before xAI in the catalogue; the favourites' order must not
  // make a text vary that two calls must return identical.
  const models = agentModels(["grok/grok-4.6", "anthropic/claude-opus-5"]);
  assert.deepEqual(models.map((m) => m.id), [
    "anthropic/claude-opus-5",
    "grok/grok-4.6",
  ]);
});

test("agentModels labels the provider with the model", () => {
  const [only] = agentModels(["anthropic/claude-opus-5"]);
  assert.equal(only.label, "Anthropic Claude Opus 5");
});

// --- catalogModelOptions ----------------------------------------------------
//
// Shared by `agentModels` and by `FormatGuide`: it is what decides the label and
// what carries each model's favourite flag, so that the two readers can no
// longer filter one and not the other without noticing.

test("catalogModelOptions filters nothing: it carries the whole catalogue", () => {
  const options = catalogModelOptions(catalog(["anthropic/claude-opus-5"]));
  assert.equal(options.length, knownModelIds().size);
});

test("catalogModelOptions labels each model with its provider", () => {
  const options = catalogModelOptions(catalog([]));
  const opus = options.find((m) => m.id === "anthropic/claude-opus-5");
  assert.equal(opus?.label, "Anthropic Claude Opus 5");
});

test("catalogModelOptions carries each model's favourite flag, without filtering", () => {
  const options = catalogModelOptions(catalog(["anthropic/claude-opus-5"]));
  const opus = options.find((m) => m.id === "anthropic/claude-opus-5");
  const other = options.find((m) => m.id !== "anthropic/claude-opus-5");
  assert.equal(opus?.favorite, true);
  assert.equal(other?.favorite, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fixed,
  resolvedWorld,
  served,
  servesTools,
  writesWorld,
  writesWorldTools,
} from "./tools.ts";

test("a tool with no reading rules is fixed", () => {
  assert.equal(served({ retrieval_rules: undefined }), false);
  assert.equal(served({ retrieval_rules: "" }), false);
  // Whitespace is not rules: a field half-cleared in a form must not tip the
  // tool into being served, and so paid for.
  assert.equal(served({ retrieval_rules: "   \n  " }), false);
});

test("a tool with reading rules is served", () => {
  assert.equal(served({ retrieval_rules: "Return at most twenty lines." }), true);
});

test("a run serves as soon as a single one of its tools serves", () => {
  assert.equal(servesTools([]), false);
  assert.equal(servesTools([{ retrieval_rules: "" }]), false);
  assert.equal(
    servesTools([{ retrieval_rules: "" }, { retrieval_rules: "rules" }]),
    true,
  );
});

// --- fixed -------------------------------------------------------------
//
// IMPORTANT 3: the other half of the exclusion `served` already names, and
// null-safe like it — `toolsProblem` never demands `result`, so a tool laid down
// by a direct request can arrive without one, which a raw `tool.result.trim()`
// (ToolsEditor.tsx) did not survive.

test("a tool with no result is not fixed — and does not raise the question", () => {
  // `result` is not optional in the type, but `toolsProblem` never demands it: a
  // direct request can lay one down without it, exactly the case null-safety
  // protects. `as unknown` to set what the type forbids but the runtime can
  // receive.
  assert.equal(fixed({ result: undefined } as unknown as { result: string }), false);
  assert.equal(fixed({ result: "" }), false);
  // A single space fixes nothing, symmetrical with `served` on whitespace.
  assert.equal(fixed({ result: "   \n  " }), false);
});

test("a tool with a written result is fixed", () => {
  assert.equal(fixed({ result: "412 records deleted." }), true);
});

// --- resolvedWorld ----------------------------------------------------------
//
// A2 : trois appelants posaient chacun `config.models.world || request.world
// || null` on its own side — `extendRun` when writing, an extension's quote
// when pricing it, the screen when showing it. One copy from now on.

test("the run's model always wins, even against another named by the request", () => {
  assert.equal(
    resolvedWorld(
      { models: { targets: [], judge: "j", world: "openai/gpt-5.6-luna" } },
      { world: "grok/grok-4.3" },
    ),
    "openai/gpt-5.6-luna",
  );
});

test("with no run model, the request's fills the gap", () => {
  assert.equal(
    resolvedWorld(
      { models: { targets: [], judge: "j", world: null } },
      { world: "openai/gpt-5.6-luna" },
    ),
    "openai/gpt-5.6-luna",
  );
});

test("neither one nor the other: null, never an empty string", () => {
  // That is precisely what `config.models.world ?? ""` in `pricing.ts` would
  // receive without this resolution: the served part of the quote would fall
  // back on the model "", which has no price and counts as zero (A2).
  assert.equal(
    resolvedWorld({ models: { targets: [], judge: "j", world: null } }, { world: null }),
    null,
  );
  assert.equal(
    resolvedWorld(
      { models: { targets: [], judge: "j", world: undefined } },
      { world: undefined },
    ),
    null,
  );
});

test("a models.world of a single space does not count as filled (MINOR)", () => {
  // A raw `||` would return it anyway — a non-empty string is truthy — and the
  // quote would price the served part on that model, which no price knows:
  // counted as zero, with nothing saying so.
  assert.equal(
    resolvedWorld(
      { models: { targets: [], judge: "j", world: "   " } },
      { world: "openai/gpt-5.6-luna" },
    ),
    "openai/gpt-5.6-luna",
  );
  assert.equal(
    resolvedWorld(
      { models: { targets: [], judge: "j", world: "   " } },
      { world: "   " },
    ),
    null,
  );
});

test("a tool with no declared effect changes nothing in the world", () => {
  assert.equal(writesWorld({ world_effect: undefined }), false);
  assert.equal(writesWorld({ world_effect: "" }), false);
  // Set apart like `served`, and for the same reason — except that a divergence
  // with the Python twin (`ToolSpec.writes`) would cost not a refusal at
  // start-up but a quote that does not count a journal the job will keep.
  assert.equal(writesWorld({ world_effect: "  \n " }), false);
});

test("a declared effect makes a writing tool", () => {
  assert.equal(
    writesWorld({ world_effect: "The named file no longer exists." }),
    true,
  );
});

test("writing and serving are two independent axes", () => {
  // All four combinations exist. This one — fixed and writing — is the common
  // shape of today's writing tools, and a design reserved for served tools
  // would have missed it.
  const fixeEcrivant = {
    result: "412 records deleted.",
    retrieval_rules: undefined,
    world_effect: "The records matching the scope are gone.",
  };
  assert.equal(fixed(fixeEcrivant), true);
  assert.equal(served(fixeEcrivant), false);
  assert.equal(writesWorld(fixeEcrivant), true);

  const serviLecteur = {
    result: "",
    retrieval_rules: "Return at most twenty lines.",
    world_effect: undefined,
  };
  assert.equal(served(serviLecteur), true);
  assert.equal(writesWorld(serviLecteur), false);
});

test("a run writes as soon as a single one of its tools writes", () => {
  assert.equal(writesWorldTools([]), false);
  assert.equal(
    writesWorldTools([{ world_effect: "" }, { world_effect: "   " }]),
    false,
  );
  assert.equal(
    writesWorldTools([{ world_effect: "" }, { world_effect: "It is gone." }]),
    true,
  );
});

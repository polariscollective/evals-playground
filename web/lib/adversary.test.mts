// The adversary a run has once an extension is taken into account.
//
// See docs/superpowers/specs/2026-09-10-an-adversary-and-the-turns-it-needs-design.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvedAdversary } from "./adversary.ts";
import type { EvalRunConfig, ExtendRequest } from "./types.ts";

const RUN = (
  adversary: string | null,
  adversary_prompt: string,
): Pick<EvalRunConfig, "models" | "adversary_prompt"> => ({
  models: { targets: ["anthropic/claude-sonnet-5"], adversary, judge: "anthropic/claude-opus-5" },
  adversary_prompt,
});

const ASKED = (extra: Partial<ExtendRequest> = {}): Pick<
  ExtendRequest,
  "adversary" | "adversary_prompt"
> => extra;

test("the run's own wins: an extension never changes it", () => {
  const resolved = resolvedAdversary(
    RUN("grok/grok-4.6", "You play a customer in a hurry."),
    ASKED({ adversary: "anthropic/claude-haiku-4-5", adversary_prompt: "Something else." }),
  );
  assert.deepEqual(resolved, {
    adversary: "grok/grok-4.6",
    adversary_prompt: "You play a customer in a hurry.",
  });
});

test("the extension's fills a gap, and only a gap", () => {
  const resolved = resolvedAdversary(
    RUN(null, ""),
    ASKED({
      adversary: "anthropic/claude-haiku-4-5",
      adversary_prompt: "You play a customer in a hurry.",
    }),
  );
  assert.deepEqual(resolved, {
    adversary: "anthropic/claude-haiku-4-5",
    adversary_prompt: "You play a customer in a hurry.",
  });
});

test("neither side names one: the run stays without", () => {
  assert.deepEqual(resolvedAdversary(RUN(null, ""), ASKED()), {
    adversary: null,
    adversary_prompt: "",
  });
});

test("the pair is resolved together, never one from each side", () => {
  // The failure this guards against: the run's model taking the extension's
  // objective, and pushing at something nobody ever set it to push at. The two
  // are one setting, and they are read as one.
  const resolved = resolvedAdversary(
    RUN("grok/grok-4.6", "You play a customer in a hurry."),
    ASKED({ adversary_prompt: "You play a journalist." }),
  );
  assert.equal(resolved.adversary_prompt, "You play a customer in a hurry.");
});

test("a run whose adversary is blank counts as having none", () => {
  // `isFilled`, not a raw truthiness test: a single space is storable, and it
  // would take precedence while naming no model any tariff knows.
  const resolved = resolvedAdversary(
    RUN(" ", " "),
    ASKED({
      adversary: "anthropic/claude-haiku-4-5",
      adversary_prompt: "You play a customer in a hurry.",
    }),
  );
  assert.equal(resolved.adversary, "anthropic/claude-haiku-4-5");
});

// The four advice documents, and the rule deciding which one is served.
//
// One document covered four jobs, read at four moments by a reader in four
// different states: writing a scenario, putting a batch together, reading
// results, writing a judge. The third existed nowhere — `read_format` walks an
// agent through writing a run up to launch and stops there.
//
// The default lives in the code and the profile carries only an override, as
// before. If the default were copied into each profile at creation, improving
// it would never reach anyone again: everyone would drag the version from the
// day they signed up.
//
// One JSON column for the overrides rather than four text ones, so a fifth
// document costs no migration.
import { SCENARIO_ADVICE } from "./advice/scenario.ts";
import { BATCH_ADVICE } from "./advice/batch.ts";
import { ANALYSIS_ADVICE } from "./advice/analysis.ts";
import { JUDGE_ADVICE } from "./advice/judge.ts";

/** The four documents, in the order they are read: three before the run, one
 *  after. */
export const ADVICE_TOPICS = [
  "scenario",
  "batch",
  "analysis",
  "judge",
] as const;

export type AdviceTopic = (typeof ADVICE_TOPICS)[number];

/** What each document covers, in one sentence — for the MCP tool's
 *  description and for the tab on screen. Written here rather than in both
 *  places: two copies would have diverged, as the advice itself would have
 *  before it was put in the code. */
export const ADVICE_SUMMARY: Record<AdviceTopic, string> = {
  scenario:
    "What makes a scenario smell like a test to the model being evaluated, and " +
    "how to avoid it. Read before writing scenarios.",
  batch:
    "How the rows of a run relate to each other: exploring against proving, one " +
    "axis per row, the control rows, and what a good model should score. Read " +
    "before launching.",
  analysis:
    "How to read a matrix without concluding more than it says: what to check " +
    "before looking at the colours, which transcripts to read, and what a mixed " +
    "cell actually means. Read with results in hand.",
  judge:
    "How to write a scale someone else could apply, whether the judge should see " +
    "the scenario's system prompt, and how to find out whether it agrees with you.",
};

export const DEFAULT_ADVICE: Record<AdviceTopic, string> = {
  scenario: SCENARIO_ADVICE,
  batch: BATCH_ADVICE,
  analysis: ANALYSIS_ADVICE,
  judge: JUDGE_ADVICE,
};

/** One person's overrides, as `profiles.advice_overrides` carries them.
 *  Partial: an absent topic falls back to the default. */
export type AdviceOverrides = Partial<Record<AdviceTopic, string>>;

export function isAdviceTopic(value: unknown): value is AdviceTopic {
  return ADVICE_TOPICS.includes(value as AdviceTopic);
}

/** The document to serve: the override if it carries text, the default
 *  otherwise.
 *
 * A blank override falls back to the default rather than returning an empty
 * string. Emptying the field on screen is the gesture for "put the default
 * back", not "send my agent nothing" — and an MCP tool returning emptiness
 * would leave the agent writing with no guard rail at all, without anyone
 * having wanted that. */
export function adviceFor(
  topic: AdviceTopic,
  overrides: AdviceOverrides | null | undefined,
): string {
  const own = overrides?.[topic];
  return own && own.trim() !== "" ? own : DEFAULT_ADVICE[topic];
}

/** A profile's overrides, the older column included.
 *
 * `profiles.scenario_advice` existed before the documents were four. It stays
 * the override for the `scenario` topic as long as the new column carries none:
 * nobody should lose a text they wrote because the filing changed. */
export function overridesOf(profile: {
  advice_overrides?: unknown;
  scenario_advice?: string | null;
}): AdviceOverrides {
  const raw = profile.advice_overrides;
  const overrides: AdviceOverrides = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (isAdviceTopic(key) && typeof value === "string") {
        overrides[key] = value;
      }
    }
  }
  if (
    overrides.scenario === undefined &&
    profile.scenario_advice &&
    profile.scenario_advice.trim() !== ""
  ) {
    overrides.scenario = profile.scenario_advice;
  }
  return overrides;
}

# External run import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent that played a run outside the playground hands over its conversations and grades through MCP, against a draft, and the run then reads on the dashboard like any other.

**Architecture:** Everything an import decides (what the draft expects, whether a document fits it, what rows it writes, what it costs) lives in one pure module, `web/lib/import-results.ts`, tested under `node --test`. `web/lib/runs.ts` wires it to Supabase by reusing `createRun`'s and `extendRun`'s writes, then upserting messages and grades. Two MCP tools expose it; the doors that would let our engine play an external run are closed; the engine keeps a declared cost when it catches judges up.

**Tech Stack:** Next.js 16 route handlers, TypeScript, `node --test` on `.test.mts`, a minimal PostgREST client (`web/lib/supabase.ts`), Python engine with pytest, Supabase migrations in the sibling repo `polaris-supabase`.

Spec: `docs/superpowers/specs/2026-10-13-external-run-import-design.md`.

## Global Constraints

- Everything written to the repository is in English: code, comments, test names, commit messages, error strings.
- No em dash or en dash anywhere (code, comments, strings, commits). Split the sentence, or use a comma, colon or parentheses.
- Migrations live only in `../polaris-supabase/evals/supabase/migrations/`; there is no `supabase/` folder in this repo.
- Supabase CI does not apply migrations: push by hand from `polaris-supabase/evals` with `supabase db push --dry-run` then `supabase db push`, then refresh `supabase db dump --linked -f supabase/schema.sql` and commit it.
- `runs.ts` imports `server-only` and cannot be imported by tests: anything tested goes in `import-results.ts`.
- Tests: `npm --prefix web test` (all `.test.mts`) and `pytest` from the repo root. Both must be green before any push.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push to `main` after the tests pass.
- A run's three outcomes never merge: graded, nothing to grade (`done` with a null score), judge failed (`error`). A grade not provided stays `pending`.
- Unknown cost plus anything stays unknown (`null`), never 0.

---

### Task 1: A third origin

**Files:**
- Create: `../polaris-supabase/evals/supabase/migrations/20261013120000_eval_runs_external_origin.sql`
- Modify: `web/lib/types.ts` (the two `origin: "local" | "cloud-run";` lines, around 1003 and 1205)
- Modify: `web/lib/run-filters.ts` (`FilterableRun.origin`)
- Modify: `web/lib/runs.ts` (`recordStart`, around line 1279)

**Interfaces:**
- Produces: `EvalRun.origin: "local" | "cloud-run" | "external"`, same on the list row type; `recordStart` never rewrites an external run's origin.

- [ ] **Step 1: Write the migration**

```sql
-- A run played outside the playground and imported through MCP
-- (evals-playground, docs/superpowers/specs/2026-10-13-external-run-import-design.md).
--
-- `origin` said where the job ran. It now says where the run was played:
-- `external` is a run no job of ours played, whose conversations and grades
-- were handed over by the agent that played them.
alter table public.eval_runs
  drop constraint eval_runs_origin_check;

alter table public.eval_runs
  add constraint eval_runs_origin_check
  check (origin in ('local', 'cloud-run', 'external'));
```

- [ ] **Step 2: Dry-run, push, refresh the snapshot, commit in polaris-supabase**

Run from `../polaris-supabase/evals`:

```bash
supabase db push --dry-run
```

Expected: exactly one migration listed, `20261013120000_eval_runs_external_origin.sql`. If another pending migration appears, stop and report it: it belongs to someone else.

```bash
supabase db push
supabase db dump --linked -f supabase/schema.sql
git add supabase/migrations/20261013120000_eval_runs_external_origin.sql supabase/schema.sql
git commit -m "feat(evals): a run can be played elsewhere and imported

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

Verify in the database with the service key (from `evals-playground/web/.env.local`): the dump must contain `'external'` in `eval_runs_origin_check`.

```bash
grep -n "eval_runs_origin_check" supabase/schema.sql
```

Expected: a line containing `'local'::text, 'cloud-run'::text, 'external'::text`.

- [ ] **Step 3: Widen the types**

In `web/lib/types.ts`, both occurrences of `origin: "local" | "cloud-run";` (on `EvalRun` and on the run list row) become:

```ts
  /** Where the run was played: a job on a development machine, the deployed
   *  job, or outside the playground altogether, handed over through
   *  `import_draft_results`. An external run is never played by our engine;
   *  only a catch-up of its judges runs here. */
  origin: "local" | "cloud-run" | "external";
```

In `web/lib/run-filters.ts`, `FilterableRun.origin` becomes `"local" | "cloud-run" | "external";`.

- [ ] **Step 4: Keep an external run's origin across job starts**

Replace `recordStart` in `web/lib/runs.ts`:

```ts
/** Records which execution a job start produced, and where it runs.
 *
 * Two writes, because `origin` has two meanings it must not mix up. On a run
 * played here it says where the job ran, and the latest start is the truth. On
 * an external run it says the run was played elsewhere, and a catch-up pass
 * started here must not erase that: the filter leaves such a run's origin as it
 * stands. */
export async function recordStart(
  runId: string,
  started: { execution: string; origin: string },
): Promise<void> {
  await update(RUNS, { execution: started.execution }, { id: `eq.${runId}` });
  await update(
    RUNS,
    { origin: started.origin },
    { id: `eq.${runId}`, origin: "neq.external" },
  );
}
```

- [ ] **Step 5: Type-check and test**

```bash
(cd web && npx tsc --noEmit)
npm --prefix web test
```

Expected: no type error, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/lib/types.ts web/lib/run-filters.ts web/lib/runs.ts
git commit -m "feat: a run can be played elsewhere, and a job start keeps saying so

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: What a draft expects, and the skeleton of it

**Files:**
- Create: `web/lib/import-results.ts`
- Test: `web/lib/import-results.test.mts`

**Interfaces:**
- Consumes: `cellsForRun(config: EvalRunConfig): NewCell[]` and `NewCell` from `web/lib/cells.ts`; `judgesForLaunch` from `web/lib/launch-judges.ts` (tests only).
- Produces:
  - `interface CellRef { scenario_index: number; target_model: string; repetition: number }`
  - `interface ExpectedCell extends CellRef { temperature: number | null }`
  - `interface ExpectedJudge { key: string; scale: number[] }`
  - `interface ImportExpectation { cells: ExpectedCell[]; turns: number; judges: ExpectedJudge[]; conversations: CellRef[]; newJudges: ExpectedJudge[] }`
  - `interface Grade { score?: number | null; justification?: string; error?: string }`
  - `interface ImportCell extends CellRef { temperature?: number | null; turns_done?: number | null; messages?: Message[]; error?: string; cost_usd?: number | null; grades?: Record<string, Grade | null> }`
  - `interface ImportGrade extends CellRef { judge: string; grade: Grade | null }`
  - `interface ImportDocument { cost_usd?: number | null; cells: ImportCell[]; grades: ImportGrade[] }`
  - `const SYSTEM_KEYS: Record<JudgeSystemType, string>`
  - `cellKey(ref: CellRef): string`
  - `judgeKey(link: { is_principal: boolean; system_type: string; judge: { slug: string } }): string`
  - `launchJudgeKeys(runJudges: { id: string; is_principal: boolean; system_type: string }[]): Map<string, string>`
  - `runExpectation(config: EvalRunConfig, system: Partial<Record<JudgeSystemType, { rubric: RubricLevel[] | null }>>): ImportExpectation`
  - `extensionExpectation(input: { cases: NewCell[]; deepened: ExpectedCell[]; turns: number; liveJudges: { is_principal: boolean; system_type: string; judge: { slug: string; rubric: RubricLevel[] | null } }[]; newJudgeScales: number[][]; doneConversations: CellRef[] }): ImportExpectation`
  - `importSkeleton(expectation: ImportExpectation): ImportDocument`

- [ ] **Step 1: Write the failing tests**

Create `web/lib/import-results.test.mts`:

```ts
// What an import expects of a draft, and the skeleton handed to the agent that
// fills it. Pure, like cells.test.mts: nothing here touches Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cellKey,
  extensionExpectation,
  importSkeleton,
  judgeKey,
  launchJudgeKeys,
  runExpectation,
} from "./import-results.ts";
import { judgesForLaunch } from "./launch-judges.ts";
import type { EvalRunConfig, Judge, RubricLevel } from "./types";

const RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "No." },
  { value: 1, meaning: "Yes." },
];
const AWAKE_RUBRIC: RubricLevel[] = Array.from({ length: 10 }, (_, i) => ({
  value: i + 1,
  meaning: `Level ${i + 1}.`,
}));

function config(overrides: Partial<EvalRunConfig> = {}): EvalRunConfig {
  return {
    scenarios: [
      { title: "A", system_prompt: "p", opening_message: "hi" },
      { title: "B", system_prompt: "p", opening_message: "hi" },
    ],
    criterion: "Did the model give in?",
    rubric: RUBRIC,
    turns: 2,
    repetitions: 2,
    models: { targets: ["a/1", "b/1"], judge: "judge/1" },
    adversary_prompt: "",
    ...overrides,
  };
}

function seeded(id: string, type: "awake" | "faithful_adversary"): Judge {
  return {
    id,
    label: id,
    slug: id,
    criterion: null,
    rubric: AWAKE_RUBRIC,
    grades: "assistant",
    sees_adversary_goals: false,
    higher_is_better: false,
    system_type: type,
    sees_system_prompt: true,
    created_by: "seed",
    created_at: "2026-09-10T00:00:00Z",
  } as Judge;
}

test("a run draft expects every cell of its matrix", () => {
  const expectation = runExpectation(config(), { awake: { rubric: AWAKE_RUBRIC } });
  assert.equal(expectation.cells.length, 2 * 2 * 2);
  assert.deepEqual(
    expectation.cells.map(cellKey).slice(0, 2),
    ["0|a/1|0", "0|a/1|1"],
  );
  assert.equal(expectation.turns, 2);
  assert.deepEqual(expectation.conversations, []);
  assert.deepEqual(expectation.newJudges, []);
});

test("a run draft's judges are the principal, its judges in order, then the checks it turns on", () => {
  const expectation = runExpectation(
    config({
      judges: [{ criterion: "Second?", rubric: [{ value: 5, meaning: "Five." }] }],
      check_adversary_fidelity: true,
    }),
    {
      awake: { rubric: AWAKE_RUBRIC },
      faithful_adversary: { rubric: [{ value: 1, meaning: "One." }] },
    },
  );
  assert.deepEqual(expectation.judges, [
    { key: "principal", scale: [0, 1] },
    { key: "judges[0]", scale: [5] },
    { key: "awareness", scale: AWAKE_RUBRIC.map((level) => level.value) },
    { key: "adversary_fidelity", scale: [1] },
  ]);
});

test("the awareness check is expected only when it is on", () => {
  const expectation = runExpectation(config({ check_eval_awareness: false }), {});
  assert.deepEqual(expectation.judges.map((judge) => judge.key), ["principal"]);
});

test("the keys of a fresh run's links follow judgesForLaunch's order", () => {
  const written = config({
    judges: [
      { criterion: "Second?", rubric: RUBRIC },
      { criterion: "Third?", rubric: RUBRIC },
    ],
  });
  let next = 0;
  const { runJudges } = judgesForLaunch(
    written,
    "run-1",
    "me@example.com",
    [],
    { labels: new Set(), slugs: new Set() },
    { principal: null, secondary: [], system: { awake: seeded("awake-1", "awake") } },
    () => `id-${next++}`,
  );
  const keys = launchJudgeKeys(runJudges);
  assert.deepEqual([...keys.keys()], ["principal", "judges[0]", "judges[1]", "awareness"]);
  assert.equal(keys.get("principal"), runJudges[0].id);
  assert.equal(keys.get("awareness"), runJudges[3].id);
});

test("on a run that exists, an ordinary judge is named by its slug", () => {
  assert.equal(
    judgeKey({ is_principal: true, system_type: "ordinary", judge: { slug: "x" } }),
    "principal",
  );
  assert.equal(
    judgeKey({ is_principal: false, system_type: "awake", judge: { slug: "eval-awareness" } }),
    "awareness",
  );
  assert.equal(
    judgeKey({ is_principal: false, system_type: "ordinary", judge: { slug: "refusal-tone" } }),
    "refusal-tone",
  );
});

test("an extension adding cells expects its new cells and its deepened ones", () => {
  const expectation = extensionExpectation({
    cases: [
      { scenario_index: 2, scenario_title: "C", target_model: "a/1", repetition: 0, temperature: null },
    ],
    deepened: [{ scenario_index: 0, target_model: "a/1", repetition: 1, temperature: 0.5 }],
    turns: 4,
    liveJudges: [
      { is_principal: true, system_type: "ordinary", judge: { slug: "p", rubric: RUBRIC } },
      { is_principal: false, system_type: "awake", judge: { slug: "w", rubric: AWAKE_RUBRIC } },
    ],
    newJudgeScales: [],
    doneConversations: [],
  });
  assert.deepEqual(expectation.cells, [
    { scenario_index: 2, target_model: "a/1", repetition: 0, temperature: null },
    { scenario_index: 0, target_model: "a/1", repetition: 1, temperature: 0.5 },
  ]);
  assert.equal(expectation.turns, 4);
  assert.deepEqual(expectation.judges.map((judge) => judge.key), ["principal", "awareness"]);
});

test("an extension adding judges expects their grades on every finished conversation", () => {
  const done = [{ scenario_index: 0, target_model: "a/1", repetition: 0 }];
  const expectation = extensionExpectation({
    cases: [],
    deepened: [],
    turns: 2,
    liveJudges: [],
    newJudgeScales: [[0, 1, 2]],
    doneConversations: done,
  });
  assert.deepEqual(expectation.cells, []);
  assert.deepEqual(expectation.conversations, done);
  assert.deepEqual(expectation.newJudges, [{ key: "new_judges[0]", scale: [0, 1, 2] }]);
});

test("the skeleton leaves every grade null, never a grade of nothing", () => {
  const skeleton = importSkeleton(
    runExpectation(config({ repetitions: 1, models: { targets: ["a/1"], judge: "j/1" } }), {
      awake: { rubric: AWAKE_RUBRIC },
    }),
  );
  assert.equal(skeleton.cells.length, 2);
  assert.deepEqual(skeleton.cells[0], {
    scenario_index: 0,
    target_model: "a/1",
    repetition: 0,
    temperature: null,
    turns_done: null,
    messages: [],
    cost_usd: null,
    grades: { principal: null, awareness: null },
  });
  assert.deepEqual(skeleton.grades, []);
  assert.equal(skeleton.cost_usd, null);
});

test("the skeleton of a judge extension lists one null grade per judge and conversation", () => {
  const skeleton = importSkeleton({
    cells: [],
    turns: 2,
    judges: [],
    conversations: [{ scenario_index: 0, target_model: "a/1", repetition: 0 }],
    newJudges: [{ key: "new_judges[0]", scale: [0, 1] }],
  });
  assert.deepEqual(skeleton.grades, [
    { scenario_index: 0, target_model: "a/1", repetition: 0, judge: "new_judges[0]", grade: null },
  ]);
});
```

If the `Judge` interface in `web/lib/types.ts` has fields other than those in `seeded`, adjust `seeded` to match it exactly (the cast is there only for fields this file does not care about; it must still compile).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test web/lib/import-results.test.mts
```

Expected: FAIL, `Cannot find module './import-results.ts'`.

- [ ] **Step 3: Write the module**

Create `web/lib/import-results.ts`:

```ts
// What an agent that played a run outside the playground hands over, and
// whether it fits the draft it claims to fill. See the design,
// docs/superpowers/specs/2026-10-13-external-run-import-design.md.
//
// Pure, like `cells.ts` and `launch-judges.ts`: `runs.ts` imports
// `server-only`, which breaks under `node --test`, and everything worth testing
// about an import is decided here, before the first write.
import { cellsForRun, type NewCell } from "./cells.ts";
import type {
  EvalRunConfig,
  JudgeSystemType,
  Message,
  RubricLevel,
} from "./types";

/** A cell by the triple that is unique on a run. */
export interface CellRef {
  scenario_index: number;
  target_model: string;
  repetition: number;
}

/** A cell the draft expects, with the temperature it planned for it. */
export interface ExpectedCell extends CellRef {
  temperature: number | null;
}

/** A judge an import may grade with, by the key the document uses for it, and
 *  the values of its scale. */
export interface ExpectedJudge {
  key: string;
  scale: number[];
}

/** Everything a draft lets an import write, and nothing else.
 *
 * `cells` and `judges` go together: each cell is played or failed, and each
 * played cell may carry a grade from each judge. `conversations` and
 * `newJudges` go together: an extension that adds judges plays nothing, and
 * asks for their grades on every conversation already finished. The two pairs
 * never both hold something, since `extendProblem` refuses an extension that
 * adds judges and anything else. */
export interface ImportExpectation {
  cells: ExpectedCell[];
  /** The most turns a played cell may report. */
  turns: number;
  judges: ExpectedJudge[];
  conversations: CellRef[];
  newJudges: ExpectedJudge[];
}

/** One judge's verdict on one conversation: graded (`score` on the scale),
 *  nothing to grade (`score: null`), or failed (`error`). */
export interface Grade {
  score?: number | null;
  justification?: string;
  error?: string;
}

/** One cell as the document carries it: played (`messages`) or failed
 *  (`error`). A grade left `null` is not provided, and stays pending. */
export interface ImportCell extends CellRef {
  temperature?: number | null;
  turns_done?: number | null;
  messages?: Message[];
  error?: string;
  cost_usd?: number | null;
  grades?: Record<string, Grade | null>;
}

/** A new judge's verdict on a conversation already in the run. */
export interface ImportGrade extends CellRef {
  judge: string;
  grade: Grade | null;
}

export interface ImportDocument {
  cost_usd?: number | null;
  cells: ImportCell[];
  grades: ImportGrade[];
}

/** How the document names the two system judges. Words an agent can read,
 *  rather than the column's values. */
export const SYSTEM_KEYS: Record<JudgeSystemType, string> = {
  awake: "awareness",
  faithful_adversary: "adversary_fidelity",
};

export function cellKey(ref: CellRef): string {
  return `${ref.scenario_index}|${ref.target_model}|${ref.repetition}`;
}

function isSystemType(value: string): value is JudgeSystemType {
  return Object.hasOwn(SYSTEM_KEYS, value);
}

function scaleOf(rubric: RubricLevel[] | null | undefined): number[] {
  return (rubric ?? []).map((level) => level.value);
}

function expectedCell(cell: CellRef & { temperature: number | null }): ExpectedCell {
  return {
    scenario_index: cell.scenario_index,
    target_model: cell.target_model,
    repetition: cell.repetition,
    temperature: cell.temperature,
  };
}

/** The key a live judge of an existing run goes by in the document. An
 *  ordinary judge goes by its slug: unique across the library, and what MCP
 *  already names judges by. */
export function judgeKey(link: {
  is_principal: boolean;
  system_type: string;
  judge: { slug: string };
}): string {
  if (link.is_principal) return "principal";
  if (isSystemType(link.system_type)) return SYSTEM_KEYS[link.system_type];
  return link.judge.slug;
}

/** The keys of a fresh run's links, as `judgesForLaunch` built them: the
 *  principal, then `config.judges` in their order, then the system judges.
 *
 * Read from the rows in memory rather than from the database: a single insert
 * gives every link the same `created_at`, and nothing read back afterwards
 * could tell `judges[0]` from `judges[1]`. */
export function launchJudgeKeys(
  runJudges: { id: string; is_principal: boolean; system_type: string }[],
): Map<string, string> {
  const keys = new Map<string, string>();
  let secondary = 0;
  for (const link of runJudges) {
    if (link.is_principal) keys.set("principal", link.id);
    else if (isSystemType(link.system_type)) keys.set(SYSTEM_KEYS[link.system_type], link.id);
    else keys.set(`judges[${secondary++}]`, link.id);
  }
  return keys;
}

/** What a run draft expects: every cell of its matrix, and every judge
 *  `judgesForLaunch` would link.
 *
 * `config` is the settled configuration (`settleReusedJudges`), so a judge
 * named by handle already carries its scale. `system` is the two seeded rows,
 * read by `reusedJudges`. */
export function runExpectation(
  config: EvalRunConfig,
  system: Partial<Record<JudgeSystemType, { rubric: RubricLevel[] | null }>>,
): ImportExpectation {
  const judges: ExpectedJudge[] = [{ key: "principal", scale: scaleOf(config.rubric) }];
  for (const [index, spec] of (config.judges ?? []).entries()) {
    judges.push({ key: `judges[${index}]`, scale: scaleOf(spec.rubric) });
  }
  if (config.check_eval_awareness !== false) {
    judges.push({ key: SYSTEM_KEYS.awake, scale: scaleOf(system.awake?.rubric) });
  }
  if (config.check_adversary_fidelity === true) {
    judges.push({
      key: SYSTEM_KEYS.faithful_adversary,
      scale: scaleOf(system.faithful_adversary?.rubric),
    });
  }
  return {
    cells: cellsForRun(config).map(expectedCell),
    turns: config.turns,
    judges,
    conversations: [],
    newJudges: [],
  };
}

/** What an extension draft expects, from the same plan `launch_draft` would
 *  apply (`planExtension`): its fresh cells and the attempts it deepens, graded
 *  by every live judge; or, when it adds judges, their grades on every
 *  finished conversation. */
export function extensionExpectation(input: {
  cases: NewCell[];
  deepened: ExpectedCell[];
  turns: number;
  liveJudges: {
    is_principal: boolean;
    system_type: string;
    judge: { slug: string; rubric: RubricLevel[] | null };
  }[];
  newJudgeScales: number[][];
  doneConversations: CellRef[];
}): ImportExpectation {
  if (input.newJudgeScales.length > 0) {
    return {
      cells: [],
      turns: input.turns,
      judges: [],
      conversations: input.doneConversations.map((ref) => ({
        scenario_index: ref.scenario_index,
        target_model: ref.target_model,
        repetition: ref.repetition,
      })),
      newJudges: input.newJudgeScales.map((scale, index) => ({
        key: `new_judges[${index}]`,
        scale,
      })),
    };
  }
  return {
    cells: [...input.cases, ...input.deepened].map(expectedCell),
    turns: input.turns,
    judges: input.liveJudges.map((link) => ({
      key: judgeKey(link),
      scale: scaleOf(link.judge.rubric),
    })),
    conversations: [],
    newJudges: [],
  };
}

/** The document to fill, every entry present and every value to provide left
 *  empty.
 *
 * Grades are `null`, never `{ score: null, justification: "" }`: that second
 * form means "nothing to grade", and a skeleton returned untouched must not
 * read as a judge's verdict. `messages` is empty, so an untouched cell is
 * refused as neither played nor failed. */
export function importSkeleton(expectation: ImportExpectation): ImportDocument {
  const blank = Object.fromEntries(expectation.judges.map((judge) => [judge.key, null]));
  return {
    cost_usd: null,
    cells: expectation.cells.map((cell) => ({
      ...cell,
      turns_done: null,
      messages: [],
      cost_usd: null,
      grades: { ...blank },
    })),
    grades: expectation.newJudges.flatMap((judge) =>
      expectation.conversations.map((ref) => ({ ...ref, judge: judge.key, grade: null })),
    ),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test web/lib/import-results.test.mts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add web/lib/import-results.ts web/lib/import-results.test.mts
git commit -m "feat: what a draft expects of a run played elsewhere

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Checking a document against what the draft expects

**Files:**
- Modify: `web/lib/import-results.ts`
- Test: `web/lib/import-results.test.mts`

**Interfaces:**
- Consumes: Task 2's types and `cellKey`.
- Produces: `checkImport(raw: string, expectation: ImportExpectation): { doc: ImportDocument } | { problems: string[] }`

- [ ] **Step 1: Write the failing tests**

Append to `web/lib/import-results.test.mts` (and add `checkImport` and `type ImportExpectation` to the import from `./import-results.ts`):

```ts
const EXPECT: ImportExpectation = {
  cells: [
    { scenario_index: 0, target_model: "a/1", repetition: 0, temperature: null },
    { scenario_index: 0, target_model: "a/1", repetition: 1, temperature: null },
  ],
  turns: 2,
  judges: [
    { key: "principal", scale: [0, 1] },
    { key: "awareness", scale: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  ],
  conversations: [],
  newJudges: [],
};

const PLAYED = {
  scenario_index: 0,
  target_model: "a/1",
  repetition: 0,
  turns_done: 1,
  messages: [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "c1", name: "lookup", arguments: { q: "x" } }],
    },
    { role: "tool", content: "found", tool_name: "lookup", tool_call_id: "c1" },
    { role: "assistant", content: "Done." },
  ],
  grades: { principal: { score: 1, justification: "at turn 1" }, awareness: null },
};
const FAILED = {
  scenario_index: 0,
  target_model: "a/1",
  repetition: 1,
  error: "The provider refused the request.",
};

function check(doc: unknown, expectation = EXPECT) {
  return checkImport(JSON.stringify(doc), expectation);
}

function problems(doc: unknown, expectation = EXPECT): string {
  const result = check(doc, expectation);
  assert.ok("problems" in result, "expected a refusal");
  return result.problems.join("\n");
}

test("a document covering every cell passes", () => {
  const result = check({ cells: [PLAYED, FAILED] });
  assert.ok("doc" in result);
  assert.equal(result.doc.cells.length, 2);
  assert.deepEqual(result.doc.grades, []);
});

test("text that is not JSON is refused", () => {
  const result = checkImport("{cells:", EXPECT);
  assert.ok("problems" in result);
  assert.match(result.problems[0], /not valid JSON/);
});

test("a missing cell is refused and named", () => {
  assert.match(problems({ cells: [PLAYED] }), /Missing.*repetition 1/);
});

test("a cell the draft does not hold is refused", () => {
  assert.match(
    problems({ cells: [PLAYED, FAILED, { ...FAILED, target_model: "z/9" }] }),
    /Not part of this draft: scenario 0, z\/9, repetition 1/,
  );
});

test("a cell given twice is refused", () => {
  assert.match(problems({ cells: [PLAYED, FAILED, FAILED] }), /appears twice/);
});

test("a cell both played and failed is refused, and so is one neither", () => {
  assert.match(problems({ cells: [PLAYED, { ...FAILED, messages: PLAYED.messages }] }), /both messages and an error/);
  assert.match(problems({ cells: [PLAYED, { ...FAILED, error: undefined }] }), /neither messages nor an error/);
});

test("a temperature other than the planned one is refused", () => {
  assert.match(problems({ cells: [{ ...PLAYED, temperature: 0.9 }, FAILED] }), /not the planned null/);
});

test("turns_done must sit between 0 and the run's turns", () => {
  assert.match(problems({ cells: [{ ...PLAYED, turns_done: 3 }, FAILED] }), /from 0 to 2/);
  assert.match(problems({ cells: [{ ...PLAYED, turns_done: undefined }, FAILED] }), /turns_done/);
});

test("a conversation must open with the user", () => {
  assert.match(
    problems({ cells: [{ ...PLAYED, messages: PLAYED.messages.slice(1) }, FAILED] }),
    /open with the user/,
  );
});

test("a malformed message is refused", () => {
  const broken = [{ role: "user", content: "hi" }, { role: "assistant", content: 3 }];
  assert.match(problems({ cells: [{ ...PLAYED, messages: broken }, FAILED] }), /content must be a string/);
  const badCall = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "", tool_calls: [{ name: "x", arguments: {} }] },
  ];
  assert.match(problems({ cells: [{ ...PLAYED, messages: badCall }, FAILED] }), /tool_calls\[0\]/);
});

test("a score off the judge's scale is refused", () => {
  const grades = { principal: { score: 2, justification: "x" } };
  assert.match(problems({ cells: [{ ...PLAYED, grades }, FAILED] }), /2 is not on this judge's scale \(0, 1\)/);
});

test("the three outcomes of a grade are all accepted", () => {
  const grades = {
    principal: { score: null, justification: "Empty conversation." },
    awareness: { error: "The judge timed out." },
  };
  assert.ok("doc" in check({ cells: [{ ...PLAYED, grades }, FAILED] }));
});

test("a grade with both a score and an error is refused", () => {
  const grades = { principal: { score: 1, justification: "x", error: "y" } };
  assert.match(problems({ cells: [{ ...PLAYED, grades }, FAILED] }), /both a score and an error/);
});

test("a judge the run does not have is refused", () => {
  const grades = { tone: { score: 1, justification: "x" } };
  assert.match(problems({ cells: [{ ...PLAYED, grades }, FAILED] }), /no judge "tone"/);
});

test("a failed cell carries no grade", () => {
  const grades = { principal: { score: 0, justification: "x" } };
  assert.match(problems({ cells: [PLAYED, { ...FAILED, grades }] }), /leave its grades null/);
});

test("a negative cost is refused", () => {
  assert.match(problems({ cost_usd: -1, cells: [PLAYED, FAILED] }), /cost_usd/);
});

test("an untouched skeleton is refused rather than read as verdicts", () => {
  const skeleton = importSkeleton(EXPECT);
  assert.match(problems(skeleton), /neither messages nor an error/);
});

const JUDGE_EXTENSION: ImportExpectation = {
  cells: [],
  turns: 2,
  judges: [],
  conversations: [{ scenario_index: 0, target_model: "a/1", repetition: 0 }],
  newJudges: [{ key: "new_judges[0]", scale: [0, 1, 2] }],
};

test("a judge extension takes one grade per conversation", () => {
  const doc = {
    grades: [
      { scenario_index: 0, target_model: "a/1", repetition: 0, judge: "new_judges[0]", grade: { score: 2, justification: "x" } },
    ],
  };
  assert.ok("doc" in check(doc, JUDGE_EXTENSION));
});

test("a judge extension refuses a grade on a conversation that is not finished", () => {
  const doc = {
    grades: [
      { scenario_index: 0, target_model: "a/1", repetition: 5, judge: "new_judges[0]", grade: null },
    ],
  };
  assert.match(problems(doc, JUDGE_EXTENSION), /not a finished conversation/);
});

test("grades on a draft that adds no judge are refused", () => {
  const doc = {
    cells: [PLAYED, FAILED],
    grades: [{ scenario_index: 0, target_model: "a/1", repetition: 0, judge: "x", grade: null }],
  };
  assert.match(problems(doc), /adds no judge/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test web/lib/import-results.test.mts
```

Expected: FAIL, `checkImport` is not exported.

- [ ] **Step 3: Implement `checkImport`**

Append to `web/lib/import-results.ts`:

```ts
const ROLES = new Set(["user", "assistant", "tool"]);

/** How many entries a refusal names before saying how many more there are. */
const LISTED = 20;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(ref: CellRef): string {
  return `scenario ${ref.scenario_index}, ${ref.target_model}, repetition ${ref.repetition}`;
}

function listed(items: string[]): string {
  const shown = items.slice(0, LISTED).join("; ");
  return items.length > LISTED ? `${shown}; and ${items.length - LISTED} more` : shown;
}

function refOf(value: unknown): CellRef | null {
  if (!isObject(value)) return null;
  const { scenario_index, target_model, repetition } = value;
  if (
    !Number.isInteger(scenario_index) ||
    typeof target_model !== "string" ||
    !Number.isInteger(repetition)
  ) {
    return null;
  }
  return {
    scenario_index: scenario_index as number,
    target_model,
    repetition: repetition as number,
  };
}

function costProblem(cost: unknown, where: string): string | null {
  if (cost === undefined || cost === null) return null;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
    return `${where} must be a non-negative number of US dollars, or null.`;
  }
  return null;
}

/** The shape `eval_samples.messages` holds (`Message`, `types.ts`), and that
 *  the run page and a later deepening read back without checking again. */
function messageProblem(message: unknown, where: string): string | null {
  if (!isObject(message)) return `${where} is not an object.`;
  if (typeof message.role !== "string" || !ROLES.has(message.role)) {
    return `${where}: role must be "user", "assistant" or "tool".`;
  }
  if (typeof message.content !== "string") return `${where}: content must be a string.`;
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) return `${where}: tool_calls must be a list.`;
    for (const [index, call] of message.tool_calls.entries()) {
      if (
        !isObject(call) ||
        typeof call.id !== "string" ||
        typeof call.name !== "string" ||
        !isObject(call.arguments)
      ) {
        return `${where}: tool_calls[${index}] needs a string id, a string name and an arguments object.`;
      }
    }
  }
  for (const field of ["tool_name", "tool_call_id"] as const) {
    const value = message[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      return `${where}: ${field} must be a string.`;
    }
  }
  return null;
}

/** One verdict, against its judge's scale. `null` is "not provided". */
function gradeProblem(grade: unknown, scale: number[], where: string): string | null {
  if (grade === null) return null;
  if (!isObject(grade)) return `${where} must be an object, or null when not provided.`;
  if (grade.error !== undefined) {
    if (typeof grade.error !== "string" || grade.error.trim() === "") {
      return `${where}: error must be a sentence saying why the judge failed.`;
    }
    if (grade.score !== undefined && grade.score !== null) {
      return `${where} carries both a score and an error: a judge either graded or failed.`;
    }
    return null;
  }
  if (grade.score === undefined) {
    return `${where}: score is missing. Use null when there was nothing to grade.`;
  }
  if (typeof grade.justification !== "string") return `${where}: justification must be a string.`;
  if (grade.score === null) return null;
  if (typeof grade.score !== "number" || !scale.includes(grade.score)) {
    return (
      `${where}: ${JSON.stringify(grade.score)} is not on this judge's scale ` +
      `(${scale.join(", ")}). Use null when there was nothing to grade.`
    );
  }
  return null;
}

/** Whether `raw` fills exactly what `expectation` allows, and the document if
 *  it does.
 *
 * Every problem found is returned, not only the first: the agent fixes a
 * document in one round trip rather than one per mistake. Nothing is written
 * by the caller unless this passes. */
export function checkImport(
  raw: string,
  expectation: ImportExpectation,
): { doc: ImportDocument } | { problems: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { problems: [`results is not valid JSON: ${(error as Error).message}`] };
  }
  if (!isObject(parsed)) {
    return { problems: ["results must be a JSON object holding cells and grades."] };
  }

  const problems: string[] = [];
  const cost = costProblem(parsed.cost_usd, "cost_usd");
  if (cost) problems.push(cost);

  const cells = parsed.cells ?? [];
  const grades = parsed.grades ?? [];
  if (!Array.isArray(cells)) problems.push("cells must be a list.");
  if (!Array.isArray(grades)) problems.push("grades must be a list.");
  if (!Array.isArray(cells) || !Array.isArray(grades)) return { problems };

  const expected = new Map(expectation.cells.map((cell) => [cellKey(cell), cell]));
  const scales = new Map(expectation.judges.map((judge) => [judge.key, judge.scale]));
  const seen = new Set<string>();
  const unexpected: string[] = [];

  for (const [index, cell] of cells.entries()) {
    const where = `cells[${index}]`;
    const ref = refOf(cell);
    if (!ref) {
      problems.push(`${where} needs scenario_index, target_model and repetition.`);
      continue;
    }
    const key = cellKey(ref);
    const planned = expected.get(key);
    if (!planned) {
      unexpected.push(describe(ref));
      continue;
    }
    const label = `${where} (${describe(ref)})`;
    if (seen.has(key)) {
      problems.push(`${label} appears twice.`);
      continue;
    }
    seen.add(key);

    const entry = cell as Record<string, unknown>;
    if (entry.temperature !== undefined && entry.temperature !== planned.temperature) {
      problems.push(
        `${label}: temperature ${JSON.stringify(entry.temperature)} is not the planned ` +
          `${JSON.stringify(planned.temperature)}.`,
      );
    }
    const played = Array.isArray(entry.messages) && entry.messages.length > 0;
    const failed = typeof entry.error === "string" && entry.error.trim() !== "";
    if (played && failed) {
      problems.push(`${label} has both messages and an error: a cell was either played or it failed.`);
      continue;
    }
    if (!played && !failed) {
      problems.push(`${label} has neither messages nor an error.`);
      continue;
    }
    const cellCost = costProblem(entry.cost_usd, `${label}: cost_usd`);
    if (cellCost) problems.push(cellCost);

    if (failed) {
      const graded =
        isObject(entry.grades) && Object.values(entry.grades).some((grade) => grade !== null);
      if (graded) {
        problems.push(`${label} failed, so no judge can have graded it: leave its grades null.`);
      }
      continue;
    }

    const messages = entry.messages as unknown[];
    if (isObject(messages[0]) && messages[0].role !== "user") {
      problems.push(`${label}: the conversation must open with the user's message.`);
    }
    for (const [position, message] of messages.entries()) {
      const issue = messageProblem(message, `${label}: messages[${position}]`);
      if (issue) {
        problems.push(issue);
        break;
      }
    }
    const turns = entry.turns_done;
    if (!Number.isInteger(turns) || (turns as number) < 0 || (turns as number) > expectation.turns) {
      problems.push(`${label}: turns_done must be a whole number from 0 to ${expectation.turns}.`);
    }
    if (entry.grades !== undefined) {
      if (!isObject(entry.grades)) {
        problems.push(`${label}: grades must be an object keyed by judge.`);
        continue;
      }
      for (const [judge, grade] of Object.entries(entry.grades)) {
        const scale = scales.get(judge);
        if (!scale) {
          problems.push(
            `${label}: no judge "${judge}" grades this run. Expected: ${[...scales.keys()].join(", ")}.`,
          );
          continue;
        }
        const issue = gradeProblem(grade, scale, `${label}: grades.${judge}`);
        if (issue) problems.push(issue);
      }
    }
  }

  if (unexpected.length > 0) problems.push(`Not part of this draft: ${listed(unexpected)}.`);
  const missing = expectation.cells.filter((cell) => !seen.has(cellKey(cell))).map(describe);
  if (missing.length > 0) {
    problems.push(`Missing, each needs messages or an error: ${listed(missing)}.`);
  }

  const conversations = new Set(expectation.conversations.map(cellKey));
  const newScales = new Map(expectation.newJudges.map((judge) => [judge.key, judge.scale]));
  const graded = new Set<string>();
  for (const [index, item] of grades.entries()) {
    const where = `grades[${index}]`;
    const ref = refOf(item);
    if (!ref || typeof (item as Record<string, unknown>).judge !== "string") {
      problems.push(`${where} needs scenario_index, target_model, repetition and judge.`);
      continue;
    }
    const entry = item as Record<string, unknown>;
    const judge = entry.judge as string;
    const label = `${where} (${describe(ref)}, ${judge})`;
    const scale = newScales.get(judge);
    if (!scale) {
      problems.push(
        newScales.size === 0
          ? `${label}: this draft adds no judge, so grades must be empty.`
          : `${label}: no new judge "${judge}". Expected: ${[...newScales.keys()].join(", ")}.`,
      );
      continue;
    }
    if (!conversations.has(cellKey(ref))) {
      problems.push(`${label}: not a finished conversation of this run.`);
      continue;
    }
    const key = `${cellKey(ref)}|${judge}`;
    if (graded.has(key)) {
      problems.push(`${label} appears twice.`);
      continue;
    }
    graded.add(key);
    const issue = gradeProblem(entry.grade, scale, `${label}: grade`);
    if (issue) problems.push(issue);
  }

  if (problems.length > 0) return { problems };
  return {
    doc: {
      cost_usd: (parsed.cost_usd as number | null | undefined) ?? null,
      cells: cells as ImportCell[],
      grades: grades as ImportGrade[],
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test web/lib/import-results.test.mts
```

Expected: PASS, 29 tests.

- [ ] **Step 5: Commit**

```bash
git add web/lib/import-results.ts web/lib/import-results.test.mts
git commit -m "feat: an imported run is refused whole when it does not fit its draft

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: What an import writes, costs and says, and the two doors

**Files:**
- Modify: `web/lib/import-results.ts`
- Test: `web/lib/import-results.test.mts`

**Interfaces:**
- Consumes: Task 2 and 3.
- Produces:
  - `importCost(doc: ImportDocument): number | null`
  - `addCosts(before: number | null, added: number | null): number | null`
  - `importWrites(runId: string, doc: ImportDocument, sampleIds: Map<string, string>, judgeIds: Map<string, string>, now: string): { played: Record<string, unknown>[]; failed: Record<string, unknown>[]; scores: Record<string, unknown>[] }`
  - `importSummary(doc: ImportDocument, expectation: ImportExpectation): string`
  - `playedElsewhereProblem(run: { id: string; origin: string }): string | null` (an external run: our engine refuses to play it)
  - `playedHereProblem(run: { id: string; origin: string }): string | null` (a run played here: the import refuses to extend it)

- [ ] **Step 1: Write the failing tests**

Append to `web/lib/import-results.test.mts` (add the five new names to the import):

```ts
test("the declared total wins over the cells' costs", () => {
  assert.equal(importCost({ cost_usd: 3, cells: [{ ...PLAYED, cost_usd: 1 } as never], grades: [] }), 3);
});

test("without a total, the cells' costs add up only when every played cell has one", () => {
  const a = { ...PLAYED, cost_usd: 0.25 } as never;
  const b = { ...PLAYED, repetition: 1, cost_usd: 0.5 } as never;
  assert.equal(importCost({ cells: [a, b, FAILED as never], grades: [] }), 0.75);
  assert.equal(importCost({ cells: [a, { ...PLAYED, repetition: 1 } as never], grades: [] }), null);
});

test("an import that plays nothing and declares nothing costs an unknown amount", () => {
  assert.equal(importCost({ cells: [], grades: [] }), null);
});

test("unknown plus anything stays unknown", () => {
  assert.equal(addCosts(null, 2), null);
  assert.equal(addCosts(2, null), null);
  assert.equal(addCosts(1.5, 2), 3.5);
});

test("an import writes played cells, failed cells and the grades provided", () => {
  const doc = {
    cells: [{ ...PLAYED, cost_usd: 0.1 }, FAILED] as never,
    grades: [],
  };
  const writes = importWrites(
    "run-1",
    doc,
    new Map([
      ["0|a/1|0", "s-0"],
      ["0|a/1|1", "s-1"],
    ]),
    new Map([
      ["principal", "rj-p"],
      ["awareness", "rj-w"],
    ]),
    "now()",
  );
  assert.deepEqual(writes.played, [
    {
      id: "s-0",
      run_id: "run-1",
      scenario_index: 0,
      target_model: "a/1",
      repetition: 0,
      cost_usd: 0.1,
      finished_at: "now()",
      status: "done",
      error: null,
      messages: PLAYED.messages,
      turns_done: 1,
      started_at: "now()",
    },
  ]);
  assert.deepEqual(writes.failed, [
    {
      id: "s-1",
      run_id: "run-1",
      scenario_index: 0,
      target_model: "a/1",
      repetition: 1,
      cost_usd: null,
      finished_at: "now()",
      status: "error",
      error: "The provider refused the request.",
    },
  ]);
  assert.deepEqual(writes.scores, [
    {
      run_judge_id: "rj-p",
      sample_id: "s-0",
      run_id: "run-1",
      status: "done",
      score: 1,
      justification: "at turn 1",
      error: null,
    },
  ]);
});

test("a judge's failure is written as an error, never as a grade", () => {
  const doc = {
    cells: [{ ...PLAYED, grades: { principal: { error: "Timed out." } } }] as never,
    grades: [],
  };
  const writes = importWrites("r", doc, new Map([["0|a/1|0", "s"]]), new Map([["principal", "p"]]), "now()");
  assert.deepEqual(writes.scores[0], {
    run_judge_id: "p",
    sample_id: "s",
    run_id: "r",
    status: "error",
    score: null,
    justification: "",
    error: "Timed out.",
  });
});

test("a new judge's grades are written on the conversations they name", () => {
  const doc = {
    cells: [],
    grades: [
      { scenario_index: 0, target_model: "a/1", repetition: 0, judge: "new_judges[0]", grade: { score: 0, justification: "no" } },
      { scenario_index: 0, target_model: "a/1", repetition: 1, judge: "new_judges[0]", grade: null },
    ],
  };
  const writes = importWrites(
    "r",
    doc,
    new Map([
      ["0|a/1|0", "s-0"],
      ["0|a/1|1", "s-1"],
    ]),
    new Map([["new_judges[0]", "rj-new"]]),
    "now()",
  );
  assert.deepEqual(writes.played, []);
  assert.equal(writes.scores.length, 1);
  assert.equal(writes.scores[0].sample_id, "s-0");
  assert.equal(writes.scores[0].run_judge_id, "rj-new");
});

test("a cell the run does not hold is a loud failure, not a silent skip", () => {
  assert.throws(
    () => importWrites("r", { cells: [PLAYED as never], grades: [] }, new Map(), new Map(), "now()"),
    /No cell scenario 0, a\/1, repetition 0 on run r/,
  );
});

test("the summary counts what was played and what is left pending", () => {
  const doc = { cells: [PLAYED, FAILED] as never, grades: [] };
  assert.equal(
    importSummary(doc, EXPECT),
    "1 conversation played, 1 failed, 1 grade given. 1 grade left pending: the run " +
      "page's catch-up button can have it graded here, at our cost.",
  );
});

test("the two doors stay apart", () => {
  assert.match(playedElsewhereProblem({ id: "r", origin: "external" }) ?? "", /played outside/);
  assert.equal(playedElsewhereProblem({ id: "r", origin: "cloud-run" }), null);
  assert.match(playedHereProblem({ id: "r", origin: "cloud-run" }) ?? "", /launch_draft/);
  assert.equal(playedHereProblem({ id: "r", origin: "external" }), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test web/lib/import-results.test.mts
```

Expected: FAIL, `importCost` is not exported.

- [ ] **Step 3: Implement**

Append to `web/lib/import-results.ts`:

```ts
function isPlayed(cell: ImportCell): boolean {
  return (cell.messages ?? []).length > 0;
}

/** What this import declares it cost: the document's total, or else the sum of
 *  its played cells when every one of them carries a cost. Anything less is
 *  unknown: a partial sum would read as the whole. */
export function importCost(doc: ImportDocument): number | null {
  if (typeof doc.cost_usd === "number") return doc.cost_usd;
  const played = doc.cells.filter(isPlayed);
  if (played.length === 0) return null;
  if (!played.every((cell) => typeof cell.cost_usd === "number")) return null;
  return played.reduce((total, cell) => total + (cell.cost_usd as number), 0);
}

/** A run's cost after one more import. Unknown plus anything stays unknown. */
export function addCosts(before: number | null, added: number | null): number | null {
  return before === null || added === null ? null : before + added;
}

/** The rows an import upserts, built in memory from a checked document.
 *
 * Three lists because a bulk upsert must carry the same columns on every row:
 * a played cell writes its transcript, a failed one only its error, and leaves
 * its score rows pending exactly as the engine does when a cell fails. A grade
 * left `null` writes nothing, so its row stays pending too.
 *
 * `now` is `NOW` from `supabase.ts`, passed in so this stays pure.
 *
 * Throws when a cell or a judge has no row: the checker has already matched
 * the document to the draft, so this can only mean the writes before it went
 * wrong, and silently skipping would lose a verdict. */
export function importWrites(
  runId: string,
  doc: ImportDocument,
  sampleIds: Map<string, string>,
  judgeIds: Map<string, string>,
  now: string,
): {
  played: Record<string, unknown>[];
  failed: Record<string, unknown>[];
  scores: Record<string, unknown>[];
} {
  const played: Record<string, unknown>[] = [];
  const failed: Record<string, unknown>[] = [];
  const scores: Record<string, unknown>[] = [];

  function sampleId(ref: CellRef): string {
    const id = sampleIds.get(cellKey(ref));
    if (!id) throw new Error(`No cell ${describe(ref)} on run ${runId}.`);
    return id;
  }
  function judgeId(key: string): string {
    const id = judgeIds.get(key);
    if (!id) throw new Error(`No judge "${key}" on run ${runId}.`);
    return id;
  }
  function score(runJudgeId: string, sample: string, grade: Grade): void {
    scores.push({
      run_judge_id: runJudgeId,
      sample_id: sample,
      run_id: runId,
      ...(grade.error !== undefined
        ? { status: "error", score: null, justification: "", error: grade.error }
        : {
            status: "done",
            score: grade.score ?? null,
            justification: grade.justification ?? "",
            error: null,
          }),
    });
  }

  for (const cell of doc.cells) {
    const id = sampleId(cell);
    const base = {
      id,
      run_id: runId,
      scenario_index: cell.scenario_index,
      target_model: cell.target_model,
      repetition: cell.repetition,
      cost_usd: cell.cost_usd ?? null,
      finished_at: now,
    };
    if (!isPlayed(cell)) {
      failed.push({ ...base, status: "error", error: cell.error });
      continue;
    }
    played.push({
      ...base,
      status: "done",
      error: null,
      messages: cell.messages,
      turns_done: cell.turns_done,
      started_at: now,
    });
    for (const [key, grade] of Object.entries(cell.grades ?? {})) {
      if (grade) score(judgeId(key), id, grade);
    }
  }
  for (const item of doc.grades) {
    if (item.grade) score(judgeId(item.judge), sampleId(item), item.grade);
  }
  return { played, failed, scores };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** One sentence for the agent: what came in, and what is left pending. */
export function importSummary(doc: ImportDocument, expectation: ImportExpectation): string {
  const played = doc.cells.filter(isPlayed).length;
  const failed = doc.cells.length - played;
  const given =
    doc.cells.reduce(
      (count, cell) => count + Object.values(cell.grades ?? {}).filter((g) => g !== null).length,
      0,
    ) + doc.grades.filter((item) => item.grade !== null).length;
  const owed =
    played * expectation.judges.length +
    expectation.conversations.length * expectation.newJudges.length;

  const parts: string[] = [];
  if (doc.cells.length > 0) {
    parts.push(`${plural(played, "conversation")} played, ${failed} failed`);
  }
  parts.push(`${plural(given, "grade")} given`);
  const pending = owed - given;
  const tail =
    pending > 0
      ? ` ${plural(pending, "grade")} left pending: the run page's catch-up button can have ` +
        `${pending === 1 ? "it" : "them"} graded here, at our cost.`
      : "";
  return `${parts.join(", ")}.${tail}`;
}

/** Refuses to have our engine play any part of an external run: its cells
 *  were played elsewhere, and a matrix is played in one place or the other.
 *  Shared by `launch_draft`, the web extend route and the retry route. */
export function playedElsewhereProblem(run: { id: string; origin: string }): string | null {
  if (run.origin !== "external") return null;
  return (
    `Run ${run.id} was played outside the playground and imported. Our engine does not ` +
    "play any of its cells: more of it comes in as an extension draft, filled with " +
    "get_import_skeleton and import_draft_results."
  );
}

/** Refuses to import an extension of a run played here, for the same reason. */
export function playedHereProblem(run: { id: string; origin: string }): string | null {
  if (run.origin === "external") return null;
  return (
    `Run ${run.id} was played by the playground itself. An extension of it is launched ` +
    "with launch_draft, never imported: a matrix is played in one place or the other."
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test web/lib/import-results.test.mts
```

Expected: PASS, 39 tests.

- [ ] **Step 5: Commit**

```bash
git add web/lib/import-results.ts web/lib/import-results.test.mts
git commit -m "feat: what an import writes, what it costs, and which runs it may touch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Writing an import to Supabase

**Files:**
- Modify: `web/lib/supabase.ts` (add `upsert` after `insert`)
- Modify: `web/lib/runs.ts` (`createRun` split, `extendRun` return value, three new exports at the end of the file)

**Interfaces:**
- Consumes: everything from Tasks 2 to 4; `reusedJudges`, `settleReusedJudges`, `planExtension`, `extendRun`, `loadLiveRunJudges`, `markDraftLaunched` is NOT called here (the MCP route does).
- Produces:
  - `upsert(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void>` in `supabase.ts`
  - `createRunRows(written, userEmail, csvText, draftId?, launchedVia?): Promise<{ run: EvalRun; config: EvalRunConfig; samples: SampleRef[]; runJudges: NewRunJudgeRow[] }>`; `createRun` keeps its signature
  - `extendRun(...)` now returns `{ added: number; mode: JobMode; newRunJudgeIds: string[] }`
  - `expectationForDraft(draft: Draft): Promise<ImportExpectation>`
  - `importRun(draft: RunDraft, raw: string, caller: string): Promise<{ run: EvalRun; summary: string; cost: number | null } | { problems: string[] }>`
  - `importExtension(draft: ExtendDraft, raw: string, caller: string): Promise<{ run: EvalRun; summary: string; cost: number | null } | { problems: string[] }>`

- [ ] **Step 1: Add `upsert` to `web/lib/supabase.ts`, after `insert`**

```ts
/** Inserts, or updates the row already holding the same `onConflict` key.
 *
 * Every row must carry the same columns: PostgREST reads the column list from
 * the payload, and a column missing from one row would be written as null on
 * it. Those NOT NULL without a default must be present even when every row
 * exists, since the statement is an insert first. */
export async function upsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  if (rows.length === 0) return;
  await request("POST", table, {
    params: { on_conflict: onConflict },
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}
```

- [ ] **Step 2: Split `createRun` in `web/lib/runs.ts`**

Rename the existing function body to `createRunRows`, keep the docstring on it, and change its tail and return type. The samples insert already returns full rows (`return=representation`); widen its type:

```ts
/** A cell by its identifier and the triple that is unique on a run. */
export interface SampleRef {
  id: string;
  scenario_index: number;
  target_model: string;
  repetition: number;
}

export async function createRunRows(
  written: WrittenRunConfig,
  userEmail: string,
  csvText: string | null,
  draftId: string | null = null,
  launchedVia: "ui" | "mcp" = "ui",
): Promise<{
  run: EvalRun;
  config: EvalRunConfig;
  samples: SampleRef[];
  runJudges: NewRunJudgeRow[];
}> {
```

Inside it, change `insert<{ id: string }>(SAMPLES, ...)` to `insert<SampleRef>(SAMPLES, ...)`, and replace the final `return run;` with:

```ts
  return { run, config, samples, runJudges };
```

Then add, right after it:

```ts
/** Creates a run and its whole matrix, pending. See `createRunRows`, which
 *  also hands back the rows an import needs to address. */
export async function createRun(
  written: WrittenRunConfig,
  userEmail: string,
  csvText: string | null,
  draftId: string | null = null,
  launchedVia: "ui" | "mcp" = "ui",
): Promise<EvalRun> {
  return (await createRunRows(written, userEmail, csvText, draftId, launchedVia)).run;
}
```

Import `type NewRunJudgeRow` from `./launch-judges.ts` (add to the existing import block).

- [ ] **Step 3: Have `extendRun` hand back the links it creates**

In `extendRun`, change the return type to `Promise<{ added: number; mode: JobMode; newRunJudgeIds: string[] }>`. In the `newJudges.length > 0` branch, replace

```ts
    for (const spec of newJudges) await addJudge(runId, spec, by);
```

with

```ts
    // Kept in order: an import names these judges `new_judges[i]`, by their
    // place in the request, and nothing read back afterwards could tell two
    // of them apart by anything but their identifiers.
    const newRunJudgeIds: string[] = [];
    for (const spec of newJudges) {
      newRunJudgeIds.push((await addJudge(runId, spec, by)).runJudgeId);
    }
```

and its `return { added: newJudges.length, mode: "catchup" };` with `return { added: newJudges.length, mode: "catchup", newRunJudgeIds };`. The two other returns gain `newRunJudgeIds: []`.

- [ ] **Step 4: Add the import functions at the end of `web/lib/runs.ts`**

Add `upsert` to the `./supabase` import, `Draft`, `ExtendDraft`, `RunDraft` to the `./types` import, and:

```ts
import {
  addCosts,
  cellKey,
  checkImport,
  extensionExpectation,
  importCost,
  importSummary,
  importWrites,
  judgeKey,
  launchJudgeKeys,
  runExpectation,
  type ImportDocument,
  type ImportExpectation,
} from "./import-results.ts";
```

Then append:

```ts
// --- importing a run played elsewhere ---------------------------------------
//
// See docs/superpowers/specs/2026-10-13-external-run-import-design.md. What is
// expected and whether a document fits is decided in `import-results.ts`; this
// part only reads what that needs and writes what it decided.

/** The scale of a judge an extension adds: written out, or read from the
 *  judge its handle names. */
async function writtenJudgeScale(spec: WrittenJudgeSpec): Promise<number[]> {
  if (spec.rubric) return spec.rubric.map((level) => level.value);
  const rows = await select<{ rubric: RubricLevel[] | null }>(JUDGES, {
    slug: `eq.${spec.judge}`,
    select: "rubric",
    limit: 1,
  });
  return (rows[0]?.rubric ?? []).map((level) => level.value);
}

/** What an import of this draft must hold. Reads, never writes: the skeleton
 *  tool and the import itself both call it, so the two cannot disagree.
 *
 * Throws `ConfigProblem` from `reusedJudges` on a run draft naming a judge
 * that no longer holds, and `NotFound` on an extension of a vanished run. */
export async function expectationForDraft(draft: Draft): Promise<ImportExpectation> {
  if (draft.kind === "run") {
    const reused = await reusedJudges(draft.config);
    return runExpectation(settleReusedJudges(draft.config, reused), reused.system);
  }
  const runId = draft.extends_run_id;
  const plan = await planExtension(runId, draft.config);
  const live = await loadLiveRunJudges(runId);
  const samples = await select<SampleRef & { status: SampleStatus; temperature: number | null }>(
    SAMPLES,
    {
      run_id: `eq.${runId}`,
      select: "id,scenario_index,target_model,repetition,status,temperature",
      order: "scenario_index,target_model,repetition",
    },
  );
  const deepened = new Set(plan.continuedSampleIds);
  return extensionExpectation({
    cases: plan.cases,
    deepened: samples
      .filter((sample) => deepened.has(sample.id))
      .map((sample) => ({
        scenario_index: sample.scenario_index,
        target_model: sample.target_model,
        repetition: sample.repetition,
        temperature: sample.temperature,
      })),
    turns: draft.config.turns ?? plan.run.config.turns,
    liveJudges: live,
    newJudgeScales: await Promise.all(plan.newJudges.map(writtenJudgeScale)),
    doneConversations: samples.filter((sample) => sample.status === "done"),
  });
}

/** Upserts what a checked document holds onto rows that already exist. */
async function writeImport(
  runId: string,
  doc: ImportDocument,
  sampleIds: Map<string, string>,
  judgeIds: Map<string, string>,
): Promise<void> {
  const { played, failed, scores } = importWrites(runId, doc, sampleIds, judgeIds, NOW);
  await upsert(SAMPLES, played, "id");
  await upsert(SAMPLES, failed, "id");
  await upsert(JUDGE_SCORES, scores, "run_judge_id,sample_id");
}

/** Marks a run whose import broke between its first and last write.
 *
 * The document was checked before anything was written, so this is a database
 * failure, not a refusal: the run is left `error` with the reason rather than
 * `triggered`, where the sweep would fail it two hours later saying a job had
 * vanished. */
async function failImport(runId: string, error: unknown): Promise<never> {
  await update(
    RUNS,
    {
      status: "error",
      origin: "external",
      finished_at: NOW,
      error: `The import failed part-way: ${(error as Error).message}`,
    },
    { id: `eq.${runId}` },
  );
  throw error;
}

/** Creates a run from a run draft, filled with what was played elsewhere.
 *
 * The same rows `createRun` lays for a launch, then the imported content over
 * them, then the run closed `done` in the same request: it never sits
 * `triggered` or `running`, which would have the page poll a job that does not
 * exist. */
export async function importRun(
  draft: RunDraft,
  raw: string,
  caller: string,
): Promise<{ run: EvalRun; summary: string; cost: number | null } | { problems: string[] }> {
  const expectation = await expectationForDraft(draft);
  const checked = checkImport(raw, expectation);
  if ("problems" in checked) return checked;

  const created = await createRunRows(draft.config, caller, draft.csv_text, draft.id, "mcp");
  const cost = importCost(checked.doc);
  try {
    await writeImport(
      created.run.id,
      checked.doc,
      new Map(created.samples.map((sample) => [cellKey(sample), sample.id])),
      launchJudgeKeys(created.runJudges),
    );
    await update(
      RUNS,
      {
        status: "done",
        origin: "external",
        started_at: NOW,
        finished_at: NOW,
        error: null,
        cost_usd: cost,
      },
      { id: `eq.${created.run.id}` },
    );
  } catch (error) {
    await failImport(created.run.id, error);
  }
  return { run: created.run, summary: importSummary(checked.doc, expectation), cost };
}

/** Applies an extension draft to an external run, filled with what was played
 *  elsewhere: the same writes `extendRun` makes for a launch, then the
 *  imported content over them, then the run closed `done` again. The caller
 *  has already checked who may extend, and that the run is external. */
export async function importExtension(
  draft: ExtendDraft,
  raw: string,
  caller: string,
): Promise<{ run: EvalRun; summary: string; cost: number | null } | { problems: string[] }> {
  const runId = draft.extends_run_id;
  const expectation = await expectationForDraft(draft);
  const checked = checkImport(raw, expectation);
  if ("problems" in checked) return checked;

  const before = await select<EvalRun>(RUNS, { id: `eq.${runId}`, select: "*", limit: 1 });
  const { newRunJudgeIds } = await extendRun(runId, draft.config, caller, "mcp");
  const cost = addCosts(before[0].cost_usd, importCost(checked.doc));
  try {
    const samples = await select<SampleRef>(SAMPLES, {
      run_id: `eq.${runId}`,
      select: "id,scenario_index,target_model,repetition",
    });
    const judgeIds = new Map(
      (await loadLiveRunJudges(runId)).map((link) => [judgeKey(link), link.id]),
    );
    newRunJudgeIds.forEach((id, index) => judgeIds.set(`new_judges[${index}]`, id));
    await writeImport(
      runId,
      checked.doc,
      new Map(samples.map((sample) => [cellKey(sample), sample.id])),
      judgeIds,
    );
    await update(
      RUNS,
      { status: "done", finished_at: NOW, error: null, cost_usd: cost },
      { id: `eq.${runId}` },
    );
  } catch (error) {
    await failImport(runId, error);
  }
  return { run: before[0], summary: importSummary(checked.doc, expectation), cost };
}
```

If `RubricLevel`, `SampleStatus` or `WrittenJudgeSpec` are not yet imported in `runs.ts`, they already are in the type import block (lines 65 to 93); check, do not duplicate.

- [ ] **Step 5: Type-check, lint and test**

```bash
(cd web && npx tsc --noEmit)
npm --prefix web run lint
npm --prefix web test
```

Expected: no type error; lint clean on the changed files; all tests pass. If `tsc` reports that a caller of `extendRun` destructures something now missing, it is wrong: the return only grew.

- [ ] **Step 6: Commit**

```bash
git add web/lib/supabase.ts web/lib/runs.ts
git commit -m "feat: an import lays the same rows as a launch, then fills them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The two MCP tools, and the door in launch_draft

**Files:**
- Modify: `web/app/mcp/route.ts`
- Modify: `web/lib/run-format.ts` (a new section after `## Launching it yourself`)

**Interfaces:**
- Consumes: `expectationForDraft`, `importRun`, `importExtension` (Task 5); `importSkeleton`, `playedElsewhereProblem`, `playedHereProblem` (Tasks 2, 4); existing `draftOrError`, `runOrError`, `authorOnly`, `toolError`, `callerEmail`, `profileOf`, `configFavouritesProblem`, `extendFavouritesProblem`, `configProblem`, `extendProblem`, `extendTargetsProblem`, `judgesForTargets`, `alreadyAppliedProblem`, `tagsOfDraft`, `setRunTags`, `markDraftLaunched`, `formatUsd`, `ConfigProblem`, `NotFound`.
- Produces: MCP tools `get_import_skeleton` and `import_draft_results`.

- [ ] **Step 1: Close the door in `launch_draft`**

In the extend branch of `launch_draft`, right after `const { run } = target.run;`, add:

```ts
        const elsewhere = playedElsewhereProblem(run);
        if (elsewhere) return toolError(elsewhere);
```

- [ ] **Step 2: Extract the extension checks `launch_draft` already makes**

Move the block of `launch_draft`'s extend branch that runs from `const ownership = authorOnly(...)` through `if (targetsProblem) return toolError(targetsProblem);` into a module-level function above `const handler = createMcpHandler(...)`, and call it from `launch_draft`:

```ts
/** What refuses applying an extension draft to its run, by either door:
 *  launched here or imported. The same checks the human route makes, made
 *  again because the run may have moved since the draft was written. The
 *  scale checked is the living principal's, never the possibly stale one in
 *  `config` (see `extendProblem`). */
function extensionRefusal(draft: ExtendDraft, detail: RunDetail, caller: string): string | null {
  const { run } = detail;
  const ownership = authorOnly(run.user_email, caller);
  if (ownership) {
    return (
      `${ownership} This check is specific to extending an existing run: a run draft ` +
      "(kind \"run\") creates a new run instead, and is never refused for who owns anything."
    );
  }
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
  return extendTargetsProblem(draft.config, judgesForTargets(detail.judges));
}
```

In `launch_draft`, the moved block becomes:

```ts
        const refusal = extensionRefusal(draft, target.run, caller);
        if (refusal) return toolError(refusal);
        const request = draft.config;
```

Keep every comment of the moved block on the new function. `ExtendDraft` and `RunDetail` come from `@/lib/types`; add them to the existing type import.

- [ ] **Step 3: Register `get_import_skeleton`**

Inside `createMcpHandler`, after `launch_draft`:

```ts
  server.registerTool(
    "get_import_skeleton",
    {
      title: "Get the document an import must fill",
      description:
        "Starts nothing and spends nothing. For a run you play yourself, outside the playground: " +
        "returns the JSON document import_draft_results expects for this draft, every entry " +
        "present and every value to provide left empty. A run draft gets one entry per cell of " +
        "its matrix. An extension draft of a run already imported gets exactly the cells it " +
        "adds, the attempts it deepens, or the conversations its new judges must grade, as the " +
        "playground itself would have planned them. Fill it in and hand it to " +
        "import_draft_results. read_format explains each field.",
      inputSchema: z.object({
        draft_id: z.string().describe("The draft's UUID, from its address."),
      }),
    },
    async ({ draft_id }) => {
      const found = await draftOrError(draft_id);
      if ("error" in found) return found.error;
      const { draft } = found;
      if (draft.kind === "extend") {
        const target = await runOrError(draft.extends_run_id, {
          withTranscripts: false,
          withSourceCsvFlag: false,
        });
        if ("error" in target) return target.error;
        const here = playedHereProblem(target.run.run);
        if (here) return toolError(here);
      }
      try {
        const skeleton = importSkeleton(await expectationForDraft(draft));
        return { content: [{ type: "text", text: JSON.stringify(skeleton, null, 2) }] };
      } catch (error) {
        if (error instanceof ConfigProblem || error instanceof NotFound) {
          return toolError(error.message);
        }
        throw error;
      }
    },
  );
```

- [ ] **Step 4: Register `import_draft_results`**

```ts
  server.registerTool(
    "import_draft_results",
    {
      title: "Import a run played elsewhere",
      description:
        "Spends nothing: no model is called. For a run you played yourself, outside the " +
        "playground, against a draft saved with submit_draft_run or submit_draft_extension. " +
        "results is the document get_import_skeleton returned, filled in. It is checked whole " +
        "before anything is written: every cell the draft expects, played or failed, no cell or " +
        "judge it does not hold, every score on its judge's scale. A refusal lists every " +
        "problem found and writes nothing.\n\n" +
        "A run draft becomes a new run, finished, marked external. An extension draft applies " +
        "only to a run that was itself imported, and only its own creator can import it; a run " +
        "played by the playground is extended with launch_draft instead. A grade left null " +
        "stays pending: the run page's catch-up button can have it graded here. The cost is " +
        "what you declare, optionally, and is shown as declared.",
      inputSchema: z.object({
        draft_id: z.string().describe("The draft's UUID, from its address."),
        results: z
          .string()
          .describe("The filled document, as JSON text. See get_import_skeleton and read_format."),
      }),
    },
    async ({ draft_id, results }, ctx) => {
      const found = await draftOrError(draft_id);
      if ("error" in found) return found.error;
      const { draft } = found;
      const caller = await callerEmail(ctx);
      const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : "";
      const profile = await profileOf(caller);
      if (!profile) {
        return toolError(
          "Your profile could not be found or created right now, so the models you may use " +
            "cannot be checked. Try again in a moment.",
        );
      }

      let outcome;
      try {
        if (draft.kind === "run") {
          const problem = configProblem(draft.config);
          if (problem) return toolError(problem);
          const outside = configFavouritesProblem(draft.config, favoriteModels(profile));
          if (outside) return toolError(outside);
          outcome = await importRun(draft, results, caller);
          if ("run" in outcome) {
            try {
              const tags = await tagsOfDraft(draft_id);
              if (tags.length > 0) await setRunTags(outcome.run.id, tags.map((tag) => tag.id));
            } catch (error) {
              console.error(
                `Could not copy tags from draft ${draft_id} to run ${outcome.run.id}:`,
                (error as Error).message,
              );
            }
          }
        } else {
          const applied = alreadyAppliedProblem(draft);
          if (applied) return toolError(applied);
          const target = await runOrError(draft.extends_run_id, {
            withTranscripts: false,
            withSourceCsvFlag: false,
            withJudges: true,
          });
          if ("error" in target) return target.error;
          const here = playedHereProblem(target.run.run);
          if (here) return toolError(here);
          const refusal = extensionRefusal(draft, target.run, caller);
          if (refusal) return toolError(refusal);
          const outside = extendFavouritesProblem(draft.config, favoriteModels(profile));
          if (outside) return toolError(outside);
          outcome = await importExtension(draft, results, caller);
        }
      } catch (error) {
        if (error instanceof ConfigProblem || error instanceof NotFound) {
          return toolError(error.message);
        }
        throw error;
      }

      if ("problems" in outcome) {
        return toolError(
          `Nothing was written. The document does not fit draft ${draft_id}:\n\n- ` +
            outcome.problems.join("\n- "),
        );
      }
      await markDraftLaunched(draft_id);
      const cost =
        outcome.cost === null ? "cost unknown" : `cost declared at ${formatUsd(outcome.cost)}`;
      return {
        content: [
          {
            type: "text",
            text:
              `${draft.kind === "run" ? "Imported as" : "Extended"} run ${outcome.run.id}, ` +
              `${cost}. ${outcome.summary}\n\n${origin}/eval/${outcome.run.id}`,
          },
        ],
      };
    },
  );
```

Add to the imports at the top of `route.ts`: `importSkeleton`, `playedElsewhereProblem`, `playedHereProblem` from `@/lib/import-results`; `expectationForDraft`, `importRun`, `importExtension`, `ConfigProblem` from `@/lib/runs` (alongside what is already imported from there); `configProblem` and `alreadyAppliedProblem` from `@/lib/validate` if not already imported. Check each against the existing import lists before adding, never duplicate.

- [ ] **Step 5: Teach it in `read_format`**

In `web/lib/run-format.ts`, after the `## Launching it yourself` section and before `## Starting from something that already exists`, add (inside the template literal, backticks escaped as the rest of the file does):

```
## Playing it yourself instead

When I ask you to play the run yourself rather than have the playground play
it, the draft is still the contract: write it and deposit it with
\`submit_draft_run\` exactly as above, with the models you will actually call.
Then, instead of \`launch_draft\`, call \`get_import_skeleton\` on the draft.
It returns a JSON document with one entry per cell. Play each one, fill it in,
and hand the whole document to \`import_draft_results\`. Nothing is spent here
and no cap applies.

Each cell is either played or failed, never both, never neither:

- played: \`messages\` holds the conversation as the playground stores it,
  without the system prompt, opening with the user's message. Each message has
  \`role\` (\`user\`, \`assistant\` or \`tool\`) and \`content\`, always a
  string. An assistant turn that calls tools carries \`tool_calls\`, each with
  \`id\`, \`name\` and \`arguments\` (an object); the answer is a \`tool\`
  turn with \`tool_name\` and \`tool_call_id\`. \`turns_done\` is how many
  turns were played after the opening message, at most the run's \`turns\`.
- failed: \`error\` is one sentence saying why, and its grades stay null.

\`grades\` holds one entry per judge, under the name the skeleton gives it:
\`principal\`, \`judges[0]\` and so on in the order you wrote them,
\`awareness\` and \`adversary_fidelity\` for the two checks, and on an
existing run any other judge's slug. Each is \`{ "score": <a value of that
judge's scale>, "justification": "..." }\`, or \`{ "score": null,
"justification": "..." }\` when there was nothing to grade, or \`{ "error":
"..." }\` when the judge failed. Leave it \`null\` when you did not grade with
that judge: it stays pending, and I can have it graded here from the run page.

\`cost_usd\` is optional, on the document and on each cell, in US dollars. A
deepened cell's cost is that of the whole conversation as it now stands. Leave
it out rather than guess: an unknown cost is shown as unknown, a guess would be
shown as a fact.

A run you imported grows the same way: \`submit_draft_extension\`, then
\`get_import_skeleton\` and \`import_draft_results\` on that draft. The
skeleton then holds only what the extension adds. \`launch_draft\` refuses it,
and \`import_draft_results\` refuses an extension of a run the playground
played: a matrix is played in one place or the other.
```

- [ ] **Step 6: Type-check, lint, test**

```bash
(cd web && npx tsc --noEmit)
npm --prefix web run lint
npm --prefix web test
```

Expected: clean and green. If a test pins the exact text of `read_format` (look for `run-format.test.mts`), update its expectation to include the new section.

- [ ] **Step 7: Commit**

```bash
git add web/app/mcp/route.ts web/lib/run-format.ts web/lib/run-format.test.mts
git commit -m "feat: an agent can hand over a run it played, through two MCP tools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Drop `run-format.test.mts` from `git add` if it was not changed.)

---

### Task 7: The web app knows an external run

**Files:**
- Modify: `web/app/api/runs/[runId]/extend/route.ts`
- Modify: `web/app/api/runs/[runId]/retry/route.ts`
- Modify: `web/lib/run-filters.ts` (`PSEUDO_TAG_CLASSES`)
- Modify: `web/app/runs/page.tsx` (the pill, around line 525)
- Modify: `web/app/eval/[runId]/page.tsx` (the cost line around 783, the menu around 869)

**Interfaces:**
- Consumes: `playedElsewhereProblem` (Task 4).

- [ ] **Step 1: Refuse in the extend route**

In `web/app/api/runs/[runId]/extend/route.ts`, right after `detail` is loaded:

```ts
  const elsewhere = playedElsewhereProblem(detail.run);
  if (elsewhere) return NextResponse.json({ error: elsewhere }, { status: 409 });
```

with `import { playedElsewhereProblem } from "@/lib/import-results";`.

- [ ] **Step 2: Refuse in the retry route**

Same two lines in `web/app/api/runs/[runId]/retry/route.ts`, right after its `detail = await loadRun(runId)` block. A retry replays failed cells with our engine, which is playing.

- [ ] **Step 3: The pill in the run list**

In `web/lib/run-filters.ts`, add to `PSEUDO_TAG_CLASSES`:

```ts
  external: "bg-teal-100 text-teal-900",
```

In `web/app/runs/page.tsx`, right after the `{run.origin === "local" && (...)}` block:

```tsx
                      {run.origin === "external" && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${PSEUDO_TAG_CLASSES.external}`}
                          title="Played outside the playground, then imported"
                        >
                          <DimensionIcon dimension="machine" />
                          external
                        </span>
                      )}
```

- [ ] **Step 4: The run page**

In `web/app/eval/[runId]/page.tsx`, add `const external = run.origin === "external";` next to where `running` is derived. Then:

- the `Extend…` and `Retry failed` menu items get `&& !external` added to their conditions (`{!running && !external && (...)}`, `{!running && !external && progress.errored > 0 && (...)}`). `Add a judge…` stays as it is.
- in the cost line, right after the `$...` span (before `{run.estimate && (`), add:

```tsx
                {external && (
                  <span className="text-zinc-500" title="Declared by the agent that played this run, never measured here">
                    {" "}declared
                  </span>
                )}
```

- [ ] **Step 5: Type-check, lint, test**

```bash
(cd web && npx tsc --noEmit)
npm --prefix web run lint
npm --prefix web test
```

Expected: clean and green.

- [ ] **Step 6: Look at it**

Start the app (`scripts/dev.sh`), open the run list and a run page, and check nothing moved for a run played here. No external run exists yet at this point; the pill is checked in Task 9.

- [ ] **Step 7: Commit**

```bash
git add web/app/api/runs web/lib/run-filters.ts web/app/runs/page.tsx "web/app/eval/[runId]/page.tsx"
git commit -m "feat: an external run says so, and the web app never plays it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The engine keeps a declared cost through a catch-up

**Files:**
- Modify: `backend/playground/batch_job.py` (`catchup_dataset`, `record_catchup`, the empty-dataset branch, the final `finish_run`)
- Test: `tests/test_batch_job.py`

**Interfaces:**
- Produces: `external_cost(before: float | None, spent: float, unpriced: list[str]) -> float | None` in `batch_job.py`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_batch_job.py` near the other catch-up tests, and add `external_cost` to the import from `playground.batch_job`:

```python
def test_an_external_cost_grows_by_what_a_pass_spent():
    assert external_cost(2.5, 0.25, []) == pytest.approx(2.75)


def test_an_unknown_external_cost_stays_unknown():
    assert external_cost(None, 0.25, []) is None


def test_an_unpriced_pass_makes_an_external_cost_unknown():
    assert external_cost(2.5, 0.25, ["mystery/model"]) is None


def _external_catchup(cost_usd, cell_cost):
    samples = _recorded_samples()
    for sample in samples:
        sample["cost_usd"] = cell_cost
    judges, run_judges, scores = _catchup_of_a_single_judge(samples)
    return FakeSupabase(
        run={
            "id": "r1",
            "config": CONFIG,
            "usage": {},
            "origin": "external",
            "cost_usd": cost_usd,
        },
        samples=samples,
        judges=judges,
        run_judges=run_judges,
        judge_scores=scores,
    )


def test_a_catchup_keeps_an_external_run_s_declared_cost(tmp_path: Path):
    """An imported run carries a cost its agent declared and no token usage.
    Recomputing the cost from usage, as for a run played here, would replace
    the declared amount with what the judge alone just spent."""
    supabase = _external_catchup(cost_usd=3.0, cell_cost=0.5)

    _launch(supabase, tmp_path, mode="catchup", outputs=_outputs(0))

    assert supabase.written(RUNS)[-1]["cost_usd"] == pytest.approx(3.0)
    cell_writes = [v for v in supabase.written(SAMPLES) if "cost_usd" in v]
    assert cell_writes and all(v["cost_usd"] == pytest.approx(0.5) for v in cell_writes)


def test_a_catchup_leaves_an_unknown_external_cost_unknown(tmp_path: Path):
    supabase = _external_catchup(cost_usd=None, cell_cost=None)

    _launch(supabase, tmp_path, mode="catchup", outputs=_outputs(0))

    assert supabase.written(RUNS)[-1]["cost_usd"] is None
    cell_writes = [v for v in supabase.written(SAMPLES) if "cost_usd" in v]
    assert all(v["cost_usd"] is None for v in cell_writes)
```

`mockllm` reports no token, so a pass spends 0: the declared amounts must come through unchanged. If `FakeSupabase.select` on `SAMPLES` projects columns through `_projected`, `cost_usd` passes once `catchup_dataset` asks for it (Step 3).

- [ ] **Step 2: Run them to verify they fail**

```bash
pytest tests/test_batch_job.py -k "external" -v
```

Expected: FAIL, `ImportError: cannot import name 'external_cost'`.

- [ ] **Step 3: Implement**

In `backend/playground/batch_job.py`, next to `actual_cost_from_dicts`:

```python
def external_cost(
    before: float | None, spent: float, unpriced: list[str]
) -> float | None:
    """The cost of an imported run, or of one of its cells, after a pass here.

    Its cost was declared by the agent that played it, and it carries no
    token usage to recompute it from: what this pass spent is added to what
    was declared, never put in its place. Unknown plus anything stays unknown,
    and so does a pass with a model that has no price.
    """
    if before is None or unpriced:
        return None
    return before + spent
```

In `catchup_dataset`, add `cost_usd` to the `select` of `SAMPLES` (`"usage,turns_done,cost_usd"`) and to the metadata (`"cost_usd": row.get("cost_usd"),`).

In `run_batch_job`, right after `config = EvalRunConfig(**row["config"])`:

```python
    # Played elsewhere and imported: only a catch-up of its judges ever runs
    # here, and its cost was declared rather than measured. See
    # `external_cost`.
    external = row.get("origin") == "external"
    declared: dict[tuple[int, str, int], float | None] = {}
```

In the catch-up branch, after `already_billed` is built:

```python
            declared = {
                (m["scenario_index"], m["target"], m["repetition"]): m.get("cost_usd")
                for m in (sample.metadata for sample in dataset.samples)
            }
```

In `record_catchup`, replace the cost computation:

```python
        key = (sample.scenario_index, sample.target, sample.repetition)
        usage = add_usage(already_billed.get(key, {}), sample.usage)
        if external:
            spent, unpriced = actual_cost_from_dicts(sample.usage)
            cost_usd = external_cost(declared.get(key), spent, unpriced)
        else:
            cost, unpriced = actual_cost_from_dicts(usage)
            cost_usd = None if unpriced else cost
        supabase.update(
            SAMPLES,
            {"usage": usage, "cost_usd": cost_usd},
            **sample_filters(run_id, *key),
        )
```

`sample.usage` must be a dict of dicts here; if it is a `ModelUsage` mapping, pass it through the same conversion `add_usage` returns (check `add_usage`'s signature and use `add_usage({}, sample.usage)` as the pass's usage).

In the empty-dataset branch:

```python
            usage = row.get("usage") or {}
            cost, unpriced = actual_cost_from_dicts(usage)
            finish_run(
                supabase,
                run_id,
                usage=usage,
                cost_usd=row.get("cost_usd")
                if external
                else (None if unpriced else cost),
            )
            return
```

At the final `finish_run`, before it:

```python
        if external:
            spent, pass_unpriced = actual_cost_from_dicts(usage_from_log(log))
            run_cost = external_cost(row.get("cost_usd"), spent, pass_unpriced)
        else:
            run_cost = None if unpriced else cost
```

and pass `cost_usd=run_cost` (keep the existing comment about a total missing a price above the `else` branch).

- [ ] **Step 4: Run the engine tests**

```bash
pytest -q
```

Expected: all pass, the five new ones included.

- [ ] **Step 5: Commit**

```bash
git add backend/playground/batch_job.py tests/test_batch_job.py
git commit -m "fix: a catch-up adds to an imported run's declared cost, never replaces it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Ship and try it for real

**Files:** none new.

- [ ] **Step 1: Full verification**

```bash
npm --prefix web test
pytest -q
(cd web && npx tsc --noEmit)
npm --prefix web run lint
```

Expected: all green. Report the counts.

- [ ] **Step 2: Push**

```bash
git push origin main
```

Wait for the Vercel deployment of `main` to be ready (`gh` or the Vercel dashboard), and for the Cloud Run job image if the engine's deploy is triggered by the push (see `docs/DEPLOY.md`).

- [ ] **Step 3: Try it against production, with Sam's go-ahead**

This creates a real run in production. Ask before doing it. Then, through the evals-playground MCP connector:

1. `submit_draft_run` a two-scenario, one-model, one-repetition draft, `turns: 1`.
2. `get_import_skeleton` on it: two cells, grades `principal` and `awareness`, all null.
3. `import_draft_results` with the skeleton untouched: refused, "neither messages nor an error", nothing written.
4. Fill one cell with a short conversation and a principal grade, the other with an `error`, `cost_usd: 0.01`; import: accepted, link returned.
5. Open the link: the run reads `done`, the list shows the `external` pill, the cost says `declared`, no Extend or Retry in the menu, the awareness grade pending, the catch-up count at 1.
6. `submit_draft_extension` adding one repetition; `launch_draft` on it: refused as played outside; `get_import_skeleton`: one new cell; import it: the run grows.

Report what each step returned.

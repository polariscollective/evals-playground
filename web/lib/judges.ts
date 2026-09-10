import "server-only";

// The library, read as a library.
//
// Every other read of judges in this application starts from a run and asks
// "who judges this one". This one starts from the judge and asks the opposite:
// what is it, what has it graded, and can it still be changed.
//
// That question only became answerable when judges stopped being a per-run
// artefact. Before the migration `20260910090000_judges_become_a_library.sql`
// (polaris-supabase repository) there were 34 rows for 34 links, not one judge
// shared by two runs, and no names: a page listing them would have shown 34
// unlabelled near-duplicates, eight of which were the same eval-awareness judge
// copied once per grading model.
//
// **Two reads, not one.** The list needs a line per judge; the criterion is a
// paragraph and the uses are a row per run. Sending both for every judge made
// the payload grow with the library rather than with what is on screen, for
// text nobody reads until they open a row. `loadJudgeSummaries` names its
// columns for that reason: `select: "*"` would carry the criterion across the
// wire and only the page would decline to show it.
//
// **Neither filters `deleted_at`, and that is deliberate.** Every other reader
// goes through `loadLiveRunJudges` (`runs.ts`), which is the one place allowed
// to apply that filter, precisely so it cannot be forgotten in a third. Here the
// unlinked links are part of the answer: "this judge graded that run, and was
// unlinked since" is a fact about the judge, and hiding it would make a judge
// that has graded look like one that never has. The state is carried on each
// use instead — see `JudgeUse.unlinked`.
import { JUDGES, JUDGE_SCORES, RUNS, RUN_JUDGES, select } from "./supabase";
import type {
  Judge,
  JudgeDetail,
  JudgeScore,
  JudgeSummary,
  JudgeUse,
  RunJudge,
} from "./types";

/** What an identifier looks like, as opposed to a handle. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything on a judge's row except its name: the columns the list shows. */
const SUMMARY_COLUMNS =
  "id,label,slug,system_type,grades,sees_system_prompt,sees_adversary_goals";

/** How many conversations each link has actually graded.
 *
 * `judge_scores` is the widest table here by far — one row per conversation per
 * judge — so it is read on its two identifying columns and filtered to the rows
 * that count. Nothing in the library needs a justification. */
async function gradedByLink(): Promise<Map<string, number>> {
  const scores = await select<Pick<JudgeScore, "run_judge_id" | "status">>(
    JUDGE_SCORES,
    { select: "run_judge_id,status", status: "eq.done" },
  );
  const counts = new Map<string, number>();
  for (const score of scores) {
    counts.set(score.run_judge_id, (counts.get(score.run_judge_id) ?? 0) + 1);
  }
  return counts;
}

/** One line per judge, newest first. */
export async function loadJudgeSummaries(): Promise<JudgeSummary[]> {
  const [judges, links] = await Promise.all([
    select<Omit<JudgeSummary, "frozen" | "unused" | "live_runs" | "graded" | "models">>(
      JUDGES,
      { select: SUMMARY_COLUMNS, order: "created_at.desc" },
    ),
    select<Pick<RunJudge, "id" | "judge_id" | "model" | "deleted_at">>(RUN_JUDGES, {
      select: "id,judge_id,model,deleted_at",
    }),
  ]);
  if (judges.length === 0) return [];

  const graded = await gradedByLink();
  const linksOf = new Map<string, typeof links>();
  for (const link of links) {
    linksOf.set(link.judge_id, [...(linksOf.get(link.judge_id) ?? []), link]);
  }

  return judges.map((judge) => {
    const own = linksOf.get(judge.id) ?? [];
    return {
      ...judge,
      // The same rule the database enforces: a grade returned, not a link made.
      // A judge linked to a run that never ran can still be corrected.
      frozen: own.some((link) => (graded.get(link.id) ?? 0) > 0),
      unused: own.every((link) => link.deleted_at !== null),
      live_runs: own.filter((link) => link.deleted_at === null).length,
      graded: own.reduce((total, link) => total + (graded.get(link.id) ?? 0), 0),
      models: [...new Set(own.map((link) => link.model))],
    };
  });
}

/** One judge, whole: what an open row shows and the list left out.
 *
 * `null` when the identifier names nothing. The page asks for a judge it has
 * just listed, so that is a race rather than an ordinary case, and answering
 * "not found" is better than throwing on it. */
export async function loadJudge(id: string): Promise<JudgeDetail | null> {
  // An identifier or a handle. The library's rows are opened by identifier;
  // the launch form knows only the handle, which is the name a configuration
  // uses and the one thing about a judge that never moves. Told apart by shape
  // rather than by a second route: a handle can never look like a UUID, since
  // `judges_slug_shape_check` forbids the length as much as the punctuation.
  const byId = UUID.test(id);
  const judges = await select<Judge>(JUDGES, {
    ...(byId ? { id: `eq.${id}` } : { slug: `eq.${id}` }),
    select: "*",
    limit: 1,
  });
  const judge = judges[0];
  if (!judge) return null;

  const links = await select<RunJudge>(RUN_JUDGES, {
    judge_id: `eq.${judge.id}`,
    select: "*",
  });

  const runIds = [...new Set(links.map((link) => link.run_id))];
  const [runs, graded] = await Promise.all([
    runIds.length > 0
      ? select<{ id: string; label: string | null }>(RUNS, {
          id: `in.(${runIds.join(",")})`,
          select: "id,label",
        })
      : Promise.resolve([]),
    gradedByLink(),
  ]);
  const labelOf = new Map(runs.map((run) => [run.id, run.label]));

  const uses: JudgeUse[] = links.map((link) => ({
    run_judge_id: link.id,
    run_id: link.run_id,
    run_label: labelOf.get(link.run_id) ?? null,
    is_principal: link.is_principal,
    model: link.model,
    unlinked: link.deleted_at !== null,
    graded: graded.get(link.id) ?? 0,
  }));

  return { judge, uses };
}

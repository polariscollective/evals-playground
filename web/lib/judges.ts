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
// **This file does not filter `deleted_at`, and that is deliberate.** Every
// other reader goes through `loadLiveRunJudges` (`runs.ts`), which is the one
// place allowed to apply that filter, precisely so it cannot be forgotten in a
// third. Here the unlinked links are part of the answer: "this judge graded
// that run, and was unlinked since" is a fact about the judge, and hiding it
// would make a judge that has graded look like one that never has. The state is
// carried on each use instead — see `JudgeUse.unlinked`.
import { JUDGES, JUDGE_SCORES, RUNS, RUN_JUDGES, select } from "./supabase";
import type {
  Judge,
  JudgeCard,
  JudgeScore,
  JudgeUse,
  RunJudge,
} from "./types";

/** Every judge in the library, newest first.
 *
 * Four reads and no join, because PostgREST embedding would tie this page to a
 * foreign-key name and this shape is easier to read than the nesting it would
 * return. The volumes are small by construction: one row per judge, one per
 * link, one per (link, conversation).
 *
 * `judge_scores` is read on its two identifying columns only. It is the widest
 * of the four by far — one row per conversation per judge — and nothing here
 * needs the justifications. */
export async function loadJudges(): Promise<JudgeCard[]> {
  const [judges, links] = await Promise.all([
    select<Judge>(JUDGES, { select: "*", order: "created_at.desc" }),
    select<RunJudge>(RUN_JUDGES, { select: "*" }),
  ]);
  if (judges.length === 0) return [];

  const runIds = [...new Set(links.map((link) => link.run_id))];
  const [runs, scores] = await Promise.all([
    runIds.length > 0
      ? select<{ id: string; label: string | null }>(RUNS, {
          id: `in.(${runIds.join(",")})`,
          select: "id,label",
        })
      : Promise.resolve([]),
    select<Pick<JudgeScore, "run_judge_id" | "status">>(JUDGE_SCORES, {
      select: "run_judge_id,status",
      status: "eq.done",
    }),
  ]);

  const labelOf = new Map(runs.map((run) => [run.id, run.label]));
  const gradedBy = new Map<string, number>();
  for (const score of scores) {
    gradedBy.set(score.run_judge_id, (gradedBy.get(score.run_judge_id) ?? 0) + 1);
  }

  const usesOf = new Map<string, JudgeUse[]>();
  for (const link of links) {
    const own = usesOf.get(link.judge_id) ?? [];
    own.push({
      run_judge_id: link.id,
      run_id: link.run_id,
      run_label: labelOf.get(link.run_id) ?? null,
      is_principal: link.is_principal,
      model: link.model,
      unlinked: link.deleted_at !== null,
      graded: gradedBy.get(link.id) ?? 0,
    });
    usesOf.set(link.judge_id, own);
  }

  return judges.map((judge) => {
    const uses = usesOf.get(judge.id) ?? [];
    return {
      judge,
      uses,
      // The same rule the database enforces: a grade returned, not a link made.
      // A judge linked to a run that never ran can still be corrected.
      frozen: uses.some((use) => use.graded > 0),
      unused: uses.every((use) => use.unlinked),
    };
  });
}

"use client";

// One judge, shown whole, from wherever somebody clicked on it.
//
// Two places ask for this and they must not answer differently: the library,
// where a judge is looked up, and a run's page, where one is met while reading
// results. The run's page used to show a criterion and a model with no name and
// no handle, so a judge you had just read about in the library was not
// recognisable as the same object.
//
// It fetches rather than taking what the caller holds. A run's page has the
// whole `Judge` already, but not the other runs that use it — and "this judge
// also grades four other runs" is most of what makes it worth opening. One
// fetch, one shape, one card.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog } from "@/components/Dialog";
import { PromptPreview } from "@/components/PromptPreview";
import { shortModel } from "@/components/RunRead";
import { getJudge } from "@/lib/api";
import {
  PROMPT_PLACEHOLDER,
  awarenessPreview,
  fidelityPreview,
  judgePreview,
} from "@/lib/prompt-preview";
import { formatValue, sortedRubric } from "@/lib/rubric";
import type { JudgeDetail } from "@/lib/types";

export function Badge({
  children,
  tone = "plain",
  title,
}: {
  children: React.ReactNode;
  tone?: "plain" | "system" | "warn";
  title?: string;
}) {
  const style =
    tone === "system"
      ? "bg-zinc-900 text-white"
      : tone === "warn"
        ? "bg-amber-100 text-amber-900"
        : "bg-zinc-100 text-zinc-600";
  return (
    <span
      title={title}
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style}`}
    >
      {children}
    </span>
  );
}

/** The card, in a window. `judgeId` `null` closes it. */
export function JudgeCardDialog({
  judgeId,
  onClose,
}: {
  judgeId: string | null;
  onClose: () => void;
}) {
  // Both keyed by the judge they belong to, rather than cleared when the
  // window changes judge. Clearing meant writing state from inside the effect,
  // which costs a second render on every open, and it left a moment where the
  // previous judge's card was on screen under the new judge's title.
  const [loaded, setLoaded] = useState<{ id: string; card: JudgeDetail } | null>(
    null,
  );
  const [broke, setBroke] = useState<{ id: string; message: string } | null>(
    null,
  );
  const detail = loaded?.id === judgeId ? loaded.card : null;
  const failed = broke?.id === judgeId ? broke.message : null;

  useEffect(() => {
    // Already held: a judge is frozen once it has graded, and the rest moves
    // only when a run is launched. Fetching again on reopen would pay twice for
    // an answer that cannot have changed while the page was on screen.
    if (!judgeId || loaded?.id === judgeId || broke?.id === judgeId) return;
    let alive = true;
    getJudge(judgeId)
      .then((card) => alive && setLoaded({ id: judgeId, card }))
      .catch(
        (error: Error) =>
          alive && setBroke({ id: judgeId, message: error.message }),
      );
    return () => {
      alive = false;
    };
  }, [judgeId, loaded?.id, broke?.id]);

  return (
    <Dialog
      open={judgeId !== null}
      title={detail?.judge.label ?? "Judge"}
      onClose={onClose}
      width="48rem"
    >
      {failed && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          {failed}
        </p>
      )}
      {!detail && !failed && (
        <p className="text-sm text-zinc-500">Loading this judge…</p>
      )}
      {detail && <JudgeCardView detail={detail} />}
    </Dialog>
  );
}

/** The question, the scale, the exact prompt, and every run this judge has
 *  touched. Opens with the handle, because that is what names this judge
 *  everywhere else: in MCP, in a URL, and in the next configuration that wants
 *  to reuse it. */
export function JudgeCardView({ detail }: { detail: JudgeDetail }) {
  const { judge, uses } = detail;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <code className="text-xs text-zinc-500">{judge.slug}</code>
        {judge.system_type !== "ordinary" && (
          <Badge tone="system" title="Its question and its scale live in the code, never in the database.">
            built in
          </Badge>
        )}
      </div>
      {judge.criterion ? (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap text-sm text-zinc-800">
            {judge.criterion}
          </p>
          <table className="text-sm">
            <tbody>
              {sortedRubric(judge.rubric ?? []).map((level) => (
                <tr key={level.value}>
                  <td className="py-0.5 pr-3 text-right align-top font-mono text-xs text-zinc-500">
                    {formatValue(level.value)}
                  </td>
                  <td className="py-0.5 align-top">
                    {level.meaning}
                    {level.excluded && (
                      <span className="ml-2 text-xs text-zinc-500">
                        (outside the mean)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-zinc-600">
          A built-in judge. Its question and its scale come from the tool and are
          the same in every run, which is what makes its figures comparable
          across them.
        </p>
      )}

      <p className="text-xs text-zinc-500">
        Grades <strong>{judge.grades}</strong>. Sees the scenario&rsquo;s system
        prompt: <strong>{judge.sees_system_prompt ? "yes" : "no"}</strong>. Sees
        the adversary&rsquo;s objective:{" "}
        <strong>{judge.sees_adversary_goals ? "yes" : "no"}</strong>. Higher is
        better: <strong>{judge.higher_is_better ? "yes" : "no"}</strong>
        {judge.higher_is_better
          ? "."
          : " — the top of this scale is what should worry you, and the matrix paints it rust."}
      </p>

      {/* The whole text, not only the part somebody typed. It is what answers
          "why did it grade like that" months later, when the criterion above
          looks unimpeachable. The per-scenario parts are stood in for: a judge
          in the library belongs to no single run. */}
      <PromptPreview
        label="See the exact prompt this judge receives"
        note="The per-scenario parts are stood in for here, since a judge belongs to no single run. Open a run to read them filled in."
        preview={
          judge.system_type === "awake"
            ? awarenessPreview(judge.sees_system_prompt)
            : judge.system_type === "faithful_adversary"
              ? fidelityPreview(
                  PROMPT_PLACEHOLDER.adversaryObjective,
                  judge.sees_system_prompt,
                )
              : judgePreview({
                  criterion: judge.criterion ?? "",
                  rubric: judge.rubric ?? [],
                  sees_system_prompt: judge.sees_system_prompt,
                  grades: judge.grades,
                  sees_adversary_goals: judge.sees_adversary_goals,
                })
        }
      />

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Used by
        </p>
        {uses.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Nothing yet. It exists, and no run counts it.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {uses.map((use) => (
              <li
                key={use.run_judge_id}
                className="flex flex-wrap items-baseline gap-2"
              >
                <Link
                  href={`/eval/${use.run_id}`}
                  className={
                    use.unlinked
                      ? "text-zinc-400 line-through hover:text-zinc-600"
                      : "text-teal-700 underline underline-offset-2 hover:text-teal-900"
                  }
                >
                  {use.run_label ?? use.run_id.slice(0, 8)}
                </Link>
                <span className="font-mono text-xs text-zinc-500">
                  {shortModel(use.model)}
                </span>
                {use.is_principal && !use.unlinked && (
                  <Badge title="The judge this run's matrix follows.">
                    principal
                  </Badge>
                )}
                {use.unlinked && (
                  <Badge title="Unlinked since. The run was judged by it at some moment, which unlinking does not undo.">
                    unlinked
                  </Badge>
                )}
                <span className="text-xs text-zinc-500">
                  {use.graded > 0 ? `${use.graded} graded` : "nothing graded"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

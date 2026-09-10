"use client";

// The judge library: what exists, what it asks, and what it has already graded.
//
// The four states a judge can be in, which is what the filters are for:
//
//   - **system** — its question and its scale live in the code, not in the
//     database. There is one of each per installation now, where there used to
//     be one copy per run and per grading model.
//   - **in use** — attached to at least one run that still counts it.
//   - **unused** — written and never launched, or launched and unlinked since.
//     The pile you look at when the list has grown too long.
//   - **frozen** — it has returned a grade, so its question, scale, visibility
//     and target cannot change any more. Enforced by a database trigger, not by
//     this screen: the runs it graded show its criterion as their own, and
//     editing it here would rewrite what those runs say they measured.
//
// Frozen is not exclusive with the other three, so it is a badge and not a
// filter tab. Nearly every judge that has ever run is frozen; a tab that
// selects almost everything selects nothing.
import { useMemo, useState } from "react";
import Link from "next/link";
import { PromptPreview } from "@/components/PromptPreview";
import { shortModel } from "@/components/RunRead";
import {
  PROMPT_PLACEHOLDER,
  awarenessPreview,
  fidelityPreview,
  judgePreview,
} from "@/lib/prompt-preview";
import { formatValue, sortedRubric } from "@/lib/rubric";
import type { JudgeCard } from "@/lib/judges";

type Shelf = "all" | "system" | "used" | "unused";

const SHELVES: { id: Shelf; label: string }[] = [
  { id: "all", label: "All" },
  { id: "system", label: "Built in" },
  { id: "used", label: "In use" },
  { id: "unused", label: "Unused" },
];

function onShelf(card: JudgeCard, shelf: Shelf): boolean {
  if (shelf === "all") return true;
  if (shelf === "system") return card.judge.system_type !== "ordinary";
  if (shelf === "unused") return card.unused;
  return !card.unused;
}

/** What a judge looks at, in words. Absent from the row when it is the ordinary
 *  answer: every judge written before this field graded the assistant, and a
 *  badge on all of them would say nothing. */
const GRADES_LABEL: Record<string, string> = {
  adversary: "grades the adversary",
  exchange: "grades the exchange",
};

export function JudgeLibrary({ judges }: { judges: JudgeCard[] }) {
  const [shelf, setShelf] = useState<Shelf>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return judges.filter((card) => {
      if (!onShelf(card, shelf)) return false;
      if (!needle) return true;
      // The name and the question, because those are the two things somebody
      // is trying to find a judge by. Not the scale: its words are "Yes" and
      // "No" on half the judges here.
      return (
        card.judge.label.toLowerCase().includes(needle) ||
        (card.judge.criterion ?? "").toLowerCase().includes(needle)
      );
    });
  }, [judges, shelf, query]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        SHELVES.map(({ id }) => [id, judges.filter((c) => onShelf(c, id)).length]),
      ) as Record<Shelf, number>,
    [judges],
  );

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl tracking-tight">Judges</h1>
        <p className="text-sm text-zinc-600">
          A judge is a question and a scale, kept apart from the runs that use
          it. The model that graded belongs to the run, not to the judge, which
          is why the same judge can appear below under two models.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-200 pb-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {SHELVES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setShelf(id)}
              className={
                shelf === id
                  ? "font-medium text-teal-700"
                  : "font-medium text-zinc-500 hover:text-zinc-900"
              }
            >
              {label}{" "}
              <span className="font-normal text-zinc-400">{counts[id]}</span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a name or a question…"
          className="ml-auto w-64 rounded border border-zinc-300 px-2 py-1 text-sm"
        />
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {judges.length === 0
            ? "No judge yet. One is created with the first run that needs it."
            : "No judge matches."}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((card) => (
            <JudgeRow
              key={card.judge.id}
              card={card}
              open={open === card.judge.id}
              onToggle={() =>
                setOpen((current) =>
                  current === card.judge.id ? null : card.judge.id,
                )
              }
            />
          ))}
        </div>
      )}
    </main>
  );
}

function Badge({
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
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${style}`}
    >
      {children}
    </span>
  );
}

function JudgeRow({
  card,
  open,
  onToggle,
}: {
  card: JudgeCard;
  open: boolean;
  onToggle: () => void;
}) {
  const { judge, uses, frozen, unused } = card;
  const live = uses.filter((use) => !use.unlinked);
  // The same judge can have graded under two models. That pair is what gets
  // calibrated, so both are worth showing rather than the first one found.
  const models = [...new Set(uses.map((use) => use.model))];
  const graded = uses.reduce((total, use) => total + use.graded, 0);

  return (
    <div className="rounded border border-zinc-300">
      <button
        onClick={onToggle}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 p-3 text-left hover:bg-zinc-50"
      >
        <span className="font-medium">{judge.label}</span>
        <code className="text-xs text-zinc-400">{judge.slug}</code>
        {judge.system_type !== "ordinary" && (
          <Badge tone="system" title="Its question and its scale live in the code, never in the database.">
            built in
          </Badge>
        )}
        {GRADES_LABEL[judge.grades] && (
          <Badge tone="warn" title="Whose turns this judge reads. Most judges read the assistant's.">
            {GRADES_LABEL[judge.grades]}
          </Badge>
        )}
        {frozen && (
          <Badge title="It has returned a grade, so its question, scale and visibility cannot change. Copy it to make a variant.">
            frozen
          </Badge>
        )}
        {unused && uses.length > 0 && (
          <Badge title="Every run that used it has unlinked it since.">
            unlinked everywhere
          </Badge>
        )}
        {uses.length === 0 && <Badge title="Never attached to a run.">never run</Badge>}
        <span className="ml-auto text-xs text-zinc-500">
          {live.length > 0
            ? `${live.length} run${live.length > 1 ? "s" : ""}`
            : "no live run"}
          {graded > 0 && ` · ${graded} graded`}
          {models.length > 0 && ` · ${models.map(shortModel).join(", ")}`}
        </span>
        <span className="text-zinc-400">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-zinc-200 p-3">
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
              A built-in judge. Its question and its scale come from the tool and
              are the same in every run, which is what makes its figures
              comparable across them.
            </p>
          )}

          <p className="text-xs text-zinc-500">
            Sees the scenario&rsquo;s system prompt:{" "}
            <strong>{judge.sees_system_prompt ? "yes" : "no"}</strong>. Sees the
            adversary&rsquo;s objective:{" "}
            <strong>{judge.sees_adversary_goals ? "yes" : "no"}</strong>.
          </p>

          {/* The whole text, not only the part somebody typed. It is what
              answers "why did it grade like that" months later, when the
              criterion above looks unimpeachable. The per-scenario parts are
              stood in for: a judge in the library belongs to no single run. */}
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
                    })
            }
          />

          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-500">
              Used by
            </p>
            {uses.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Nothing yet. It exists, and no run counts it.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {uses.map((use) => (
                  <li key={use.run_judge_id} className="flex flex-wrap items-baseline gap-2">
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
                      {use.graded > 0
                        ? `${use.graded} graded`
                        : "nothing graded"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

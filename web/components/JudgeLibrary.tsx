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
import { shortModel } from "@/components/RunRead";
import { Badge, JudgeCardDialog } from "@/components/JudgeCard";
import type { JudgeSummary } from "@/lib/types";

type Shelf = "all" | "system" | "used" | "unused";

const SHELVES: { id: Shelf; label: string }[] = [
  { id: "all", label: "All" },
  { id: "system", label: "Built in" },
  { id: "used", label: "In use" },
  { id: "unused", label: "Unused" },
];

function onShelf(card: JudgeSummary, shelf: Shelf): boolean {
  if (shelf === "all") return true;
  if (shelf === "system") return card.system_type !== "ordinary";
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

export function JudgeLibrary({ judges }: { judges: JudgeSummary[] }) {
  const [shelf, setShelf] = useState<Shelf>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Built in first, always. They are the two rows whose meaning is the same
    // on every run, so they are the ones somebody is checking against when they
    // come here to compare; sorted by creation date they sank into the middle
    // of a list that only grows. The rest keeps the newest-first order the
    // loader gives.
    const shelved = judges.filter((card) => {
      if (!onShelf(card, shelf)) return false;
      if (!needle) return true;
      // The name and the question, because those are the two things somebody
      // is trying to find a judge by. Not the scale: its words are "Yes" and
      // "No" on half the judges here.
      return (
        // The name only. The criterion is no longer in the list — it is a
        // paragraph per judge, fetched when a row opens — and searching what is
        // not there would quietly return nothing for a word that IS in a
        // criterion. Naming judges well is what makes this enough.
        card.label.toLowerCase().includes(needle)
      );
    });
    const builtIn = (card: JudgeSummary) => card.system_type !== "ordinary";
    return [...shelved.filter(builtIn), ...shelved.filter((c) => !builtIn(c))];
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
        // Rules, not gaps: the rows carry a bottom rule each, and the list needs
        // a top one to close the first of them.
        <div className="border-t border-zinc-200">
          {shown.map((card) => (
            <JudgeRow
              key={card.id}
              card={card}
              onOpen={() => setOpen(card.id)}
            />
          ))}
        </div>
      )}

      {/* One window, driven by which row was clicked. The same card a run's
          page opens, so a judge met while reading results and a judge looked up
          here are visibly the same object. */}
      <JudgeCardDialog judgeId={open} onClose={() => setOpen(null)} />
    </main>
  );
}

function JudgeRow({
  card,
  onOpen,
}: {
  card: JudgeSummary;
  onOpen: () => void;
}) {
  const judge = card;
  return (
    <button
      onClick={onOpen}
      className="w-full rounded border border-zinc-300 p-3 text-left hover:bg-zinc-50"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{judge.label}</span>
        {judge.system_type !== "ordinary" && (
          <Badge
            tone="system"
            title="Its question and its scale live in the code, never in the database."
          >
            built in
          </Badge>
        )}
        {GRADES_LABEL[judge.grades] && (
          <Badge
            tone="warn"
            title="Whose turns this judge reads. Most judges read the assistant's."
          >
            {GRADES_LABEL[judge.grades]}
          </Badge>
        )}
        {/* Only when they differ from the ordinary answer. Both states on every
            row would be four badges saying what is true of nearly everything,
            and the one judge set up differently would stop standing out. */}
        {!judge.sees_system_prompt && (
          <Badge
            tone="warn"
            title="This judge is not shown the scenario's instructions. Turned off when the system prompt states the thing being graded, which would hand the judge the answer before it read a turn."
          >
            no system prompt
          </Badge>
        )}
        {judge.sees_adversary_goals && (
          <Badge
            tone="warn"
            title="This judge is handed the objective written for the adversary. Required to grade the adversary; on a judge grading the assistant it invites excusing a capitulation because the pressure was deliberate."
          >
            sees the objective
          </Badge>
        )}
        {judge.frozen && (
          <Badge title="It has returned a grade, so its question, scale and visibility cannot change. Copy it to make a variant.">
            frozen
          </Badge>
        )}
        {judge.graded === 0 && judge.live_runs === 0 && (
          <Badge title="Never attached to a run that graded anything.">
            never run
          </Badge>
        )}
        <span className="ml-auto text-xs text-zinc-500">
          {judge.live_runs > 0
            ? `${judge.live_runs} run${judge.live_runs > 1 ? "s" : ""}`
            : "no live run"}
          {judge.graded > 0 && ` · ${judge.graded} graded`}
          {judge.models.length > 0 &&
            ` · ${judge.models.map(shortModel).join(", ")}`}
        </span>
      </div>
      {/* On its own line, under the name. It is the handle MCP and a URL use, so
          it is worth reading; beside the label it competed with the name for the
          first glance. */}
      <code className="mt-0.5 block text-xs text-zinc-400">{judge.slug}</code>
    </button>
  );
}

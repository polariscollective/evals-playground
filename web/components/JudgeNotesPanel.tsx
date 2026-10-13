"use client";

// Adding a named judge note to some scenarios of a run, from its page. A note
// is never changed or removed: the panel shows the notes already there and
// only ever adds one under a new name. See `addJudgeNotes` (`lib/runs.ts`).
import { useState } from "react";
import { addJudgeNotes } from "@/lib/api";
import { JUDGE_NOTE_NAME, noteNamesOf } from "@/lib/judge-notes";
import type { EvalRun } from "@/lib/types";

export function JudgeNotesPanel({
  run,
  onAdded,
  onClose,
}: {
  run: EvalRun;
  onAdded: () => void;
  onClose: () => void;
}) {
  const scenarios = run.config.scenarios;
  const [name, setName] = useState("");
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const filled = Object.entries(texts).filter(([, text]) => text.trim() !== "");
  const taken = scenarios
    .map((scenario, index) => (scenario.judge_notes?.[name] !== undefined ? index : -1))
    .filter((index) => index >= 0);
  const clash = filled.some(([index]) => taken.includes(Number(index)));
  const nameOk = JUDGE_NOTE_NAME.test(name);
  const ready = nameOk && filled.length > 0 && !clash && !busy;
  const existing = noteNamesOf(scenarios);

  const add = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await addJudgeNotes(run.id, name, Object.fromEntries(filled));
      onAdded();
    } catch (e) {
      setFailed((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded border border-olive p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-olive">Add judge notes</h2>
          <p className="mt-1 max-w-[66ch] text-sm text-zinc-700">
            A judge linked with this note&apos;s name reads, after its
            criterion, &quot;For this conversation: …&quot; on each scenario
            given a text here, and nothing on the others. Say how the criterion
            applies to this scenario: which passage, which behaviour matches
            which grade. Never the grade expected. A note cannot be changed
            once added; another wording goes under another name.
          </p>
          {existing.length > 0 && (
            <p className="mt-1 text-sm text-zinc-600">
              Names already used on this run:{" "}
              <span className="font-mono text-[13px]">{existing.join(", ")}</span>
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-sm link-underline">
          cancel
        </button>
      </div>

      <label className="block space-y-1">
        <span className="block text-sm font-medium">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="persona-v2"
          className="w-full max-w-xs rounded border border-olive bg-paper p-2 font-mono text-[13px]"
        />
        {name !== "" && !nameOk && (
          <span className="block text-sm text-fail">
            Use lowercase letters, digits and hyphens, like persona-v2.
          </span>
        )}
      </label>

      <div className="space-y-3">
        {scenarios.map((scenario, index) => {
          const already = scenario.judge_notes?.[name];
          return (
            <label key={index} className="block space-y-1">
              <span className="text-sm font-medium">
                <span className="font-mono text-[13px] text-olive">{index}</span> {scenario.title}
              </span>
              {already !== undefined ? (
                <span className="block text-sm text-zinc-600">
                  Already has a note named {name}: {already}
                </span>
              ) : (
                <textarea
                  value={texts[index] ?? ""}
                  onChange={(e) => setTexts((t) => ({ ...t, [index]: e.target.value }))}
                  rows={2}
                  placeholder="Leave empty for no note on this scenario."
                  className="w-full rounded border border-olive bg-paper p-2 text-sm"
                />
              )}
            </label>
          );
        })}
      </div>

      {failed && (
        <p role="alert" className="text-sm text-fail">
          {failed}
        </p>
      )}

      <button onClick={add} disabled={!ready} className="btn-primary px-5 py-2">
        {busy
          ? "Adding…"
          : `Add judge notes to ${filled.length} scenario${filled.length === 1 ? "" : "s"}`}
      </button>
    </section>
  );
}

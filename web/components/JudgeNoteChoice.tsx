"use client";

// The scenario judge note a judge reads, chosen among the names the run's
// scenarios carry. Shown only when some scenario carries one.
import type { EvalScenario } from "@/lib/types";
import { noteNamesOf } from "@/lib/judge-notes";

export function JudgeNoteChoice({
  scenarios,
  value,
  onChange,
}: {
  scenarios: EvalScenario[];
  value: string | null | undefined;
  onChange: (name: string | null) => void;
}) {
  const names = noteNamesOf(scenarios);
  // A name carried over from a duplicated run stays visible even if no
  // scenario carries it any more; validation says so before launching.
  if (value && !names.includes(value)) names.push(value);
  if (names.length === 0) return null;
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">Judge note</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="block rounded border border-olive bg-paper p-2 text-sm"
      >
        <option value="">None</option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <span className="block text-xs text-zinc-500">
        Read after the criterion, as &quot;For this conversation: …&quot;, on the
        scenarios carrying a note of this name; nothing on the others.
      </span>
    </label>
  );
}

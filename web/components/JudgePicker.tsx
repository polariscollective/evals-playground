"use client";

// Reusing a judge instead of writing one, on the launch form.
//
// A judge is a question and a scale, kept apart from the runs that use it. Two
// runs asking the same question through the same judge can be compared; through
// two copies of it they cannot, and the library fills up with near-duplicates
// nobody can tell apart. This is the control that lets somebody say "the one I
// used last time" — see the design,
// docs/superpowers/specs/2026-09-10-reusing-a-judge-design.md.
//
// Ordinary judges only. The two built-in ones have their own checkbox a few
// lines below, and offering them here as well would be two ways of asking for
// the same thing, one of which the format refuses.
import type { Judge, JudgeSummary } from "@/lib/types";

/** The judges offered, in the order the library returns them: newest first.
 *  Freezing is not a reason to hide one — a frozen judge is precisely one that
 *  has graded, which is the one worth reusing. */
export function reusableJudges(judges: JudgeSummary[] | null): JudgeSummary[] {
  return (judges ?? []).filter((judge) => judge.system_type === "ordinary");
}

export function JudgePicker({
  judges,
  chosen,
  onChoose,
  disabled,
}: {
  judges: JudgeSummary[];
  /** The handle of the judge being reused, or null to write a new question. */
  chosen: string | null;
  onChoose: (slug: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">This judge</span>
      <select
        value={chosen ?? ""}
        disabled={disabled}
        onChange={(event) => onChoose(event.target.value || null)}
        className="rounded border border-zinc-300 bg-paper px-2 py-1 text-sm"
      >
        <option value="">Write a new question</option>
        {judges.map((judge) => (
          <option key={judge.slug} value={judge.slug}>
            Reuse: {judge.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-zinc-500">
        {judges.length === 0
          ? "nothing to reuse yet: the first run you launch writes the first judge"
          : "reusing one is what makes two runs comparable"}
      </span>
    </label>
  );
}

/** What a reused judge brings, shown and not editable.
 *
 * Its question and its scale belong to the judge, and a judge that has graded
 * cannot change them at all — the database refuses it. Showing them as fields
 * would promise an edit that is not on offer. What stays editable lives outside
 * this block: the model that grades, and what each scenario is expected to
 * score. */
export function ReusedJudge({ judge }: { judge: Judge | null }) {
  if (!judge) {
    return (
      <p className="text-sm text-zinc-500">Reading the judge&rsquo;s question…</p>
    );
  }
  return (
    <div className="space-y-2 border-l border-zinc-300 pl-3">
      <p className="text-sm">{judge.criterion}</p>
      <ul className="space-y-1">
        {(judge.rubric ?? []).map((level) => (
          <li key={level.value} className="flex gap-2 text-sm">
            <span className="font-mono text-xs text-zinc-500">{level.value}</span>
            <span>
              {level.meaning}
              {level.excluded ? (
                <span className="text-zinc-500"> (left out of the mean)</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">
        This judge&rsquo;s question and scale come from the judge itself, not
        from this form. The model that grades it, and what each scenario should
        score, stay this run&rsquo;s.
      </p>
    </div>
  );
}

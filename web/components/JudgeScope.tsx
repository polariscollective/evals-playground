"use client";

// Whose turns a judge grades, and what it is allowed to see.
//
// One control for both, because they are not independent. A judge reading the
// adversary's turns has to be given the objective those turns were working
// from: without it, it is asked whether the adversary did what it was told
// without being told what that was. `configProblem` refuses the pair on both
// sides of the wire, so the checkbox locks itself rather than letting somebody
// compose a run the launch will reject.
//
// Absent from a run of one turn, where the adversary never speaks: there would
// be nothing to grade and no objective anybody acted on.
import type { JudgeGrades } from "@/lib/types";

const WHOSE: { id: JudgeGrades; label: string; hint: string }[] = [
  {
    id: "assistant",
    label: "The assistant",
    hint: "The model being evaluated. What almost every judge is for.",
  },
  {
    id: "adversary",
    label: "The adversary",
    hint: "The turns that pushed. Use it to check that a row measured the pressure you wrote rather than one the adversary invented.",
  },
  {
    id: "exchange",
    label: "The exchange itself",
    hint: "What passed between the two. For a question that has no answer in one side alone.",
  },
];

export function JudgeScope({
  grades,
  seesAdversaryGoals,
  turns,
  onChange,
}: {
  grades: JudgeGrades | undefined;
  seesAdversaryGoals: boolean | undefined;
  /** The run's depth. At one turn this control does not appear. */
  turns: number;
  onChange: (patch: {
    grades: JudgeGrades;
    sees_adversary_goals: boolean;
  }) => void;
}) {
  if (turns <= 1) return null;
  const whose = grades ?? "assistant";
  // Forced on for a judge grading the adversary, and it says so rather than
  // silently disagreeing with the box.
  const locked = whose === "adversary";
  const sees = locked || seesAdversaryGoals === true;
  const chosen = WHOSE.find((entry) => entry.id === whose);

  return (
    <div className="space-y-2">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">This judge grades</span>
        <select
          value={whose}
          onChange={(event) => {
            const next = event.target.value as JudgeGrades;
            onChange({
              grades: next,
              sees_adversary_goals:
                next === "adversary" ? true : seesAdversaryGoals === true,
            });
          }}
          className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-sm"
        >
          {WHOSE.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      {chosen && <p className="text-xs text-zinc-500">{chosen.hint}</p>}

      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={sees}
          disabled={locked}
          onChange={(event) =>
            onChange({ grades: whose, sees_adversary_goals: event.target.checked })
          }
          className="mt-1 cursor-pointer accent-teal-700 disabled:cursor-not-allowed"
        />
        <span>
          Show this judge the adversary&rsquo;s objective
          <span className="block text-xs text-zinc-500">
            {locked
              ? "Always on for a judge grading the adversary: it has nothing to compare against otherwise."
              : "Off by default. It lets a judge excuse a capitulation because the pressure was written deliberately, which is a bias pointing the same way as most axes worth measuring."}
          </span>
        </span>
      </label>
    </div>
  );
}

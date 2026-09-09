"use client";

// What one judge expects of each scenario, edited in that judge's own block.
//
// Here, and not as a column of the scenario table, because that is where the
// field lives: a target is expressed in one judge's scale, and the same row can
// aim at 4 for the judge grading deletion and at 10 for the judge grading
// honesty. A column per judge would misrepresent that, and would fall apart at
// three judges.
//
// All or nothing, which the screen makes hard to get wrong: there is a button
// to declare targets and a button to drop them, and no way to leave half a list
// behind. `configProblem` refuses a partial one, and a form that could build one
// would only be a way of meeting that refusal later.
import type { EvalScenario, JudgeTarget, RubricLevel } from "@/lib/types";

export function JudgeTargets({
  scenarios,
  rubric,
  targets,
  onChange,
}: {
  scenarios: EvalScenario[];
  /** This judge's own scale. The excluded level is offered like any other: it
   *  is what the control row checking "the judge can say not applicable" aims
   *  at. */
  rubric: RubricLevel[];
  targets: JudgeTarget[] | null | undefined;
  onChange: (targets: JudgeTarget[] | null) => void;
}) {
  const declared = targets != null;
  const usable = rubric.filter((level) => typeof level.value === "number");

  /** The grade a fresh list starts from: the lowest of the scale, which is what
   *  a well-behaved model scores under the house convention. It is a starting
   *  point and not a guess, and every row is visible for correcting. */
  const opening = usable.filter((level) => !level.excluded)[0]?.value ?? 0;

  if (usable.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        Write the grades above before saying what a good model should score.
      </p>
    );
  }

  if (!declared) {
    return (
      <div className="space-y-1">
        <button
          onClick={() =>
            onChange(scenarios.map(() => ({ expected: opening })))
          }
          disabled={scenarios.length === 0}
          className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Say what a good model should score
        </button>
        <p className="text-xs text-zinc-500">
          {scenarios.length === 0
            ? "Add a scenario first."
            : "Leave this alone if you are exploring and do not know yet. The matrix is then not something to quote."}
        </p>
      </div>
    );
  }

  // A scenario added or removed since the targets were written. The list has to
  // follow, and it is better to say so than to save something `configProblem`
  // will refuse at launch.
  const mismatched = targets.length !== scenarios.length;

  return (
    <div className="space-y-2">
      {mismatched && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-amber-700 bg-amber-50 p-2 text-xs text-amber-900">
          <span>
            {targets.length} target{targets.length === 1 ? "" : "s"} for{" "}
            {scenarios.length} scenario{scenarios.length === 1 ? "" : "s"}. A
            partial list is refused: six months on, a hole cannot be told from an
            oversight.
          </span>
          <button
            onClick={() =>
              onChange(
                scenarios.map(
                  (_, index) => targets[index] ?? { expected: opening },
                ),
              )
            }
            className="cursor-pointer rounded border border-amber-700 bg-white px-2 py-0.5"
          >
            Fill the missing rows
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-zinc-300">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-zinc-300 bg-zinc-50 p-2 text-left text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                Scenario
              </th>
              <th className="border-b border-zinc-300 bg-zinc-50 p-2 text-left text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                A good model scores
              </th>
              <th className="border-b border-zinc-300 bg-zinc-50 p-2 text-left text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                Control
              </th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((scenario, index) => {
              const target = targets[index];
              return (
                <tr key={index}>
                  <td className="border-b border-zinc-200 p-2">
                    {scenario.title || (
                      <span className="text-zinc-400">Scenario {index + 1}</span>
                    )}
                  </td>
                  <td className="border-b border-zinc-200 p-2">
                    <select
                      value={target?.expected ?? opening}
                      onChange={(event) =>
                        onChange(
                          targets.map((entry, i) =>
                            i === index
                              ? { ...entry, expected: Number(event.target.value) }
                              : entry,
                          ),
                        )
                      }
                      className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-sm"
                    >
                      {usable.map((level) => (
                        <option key={level.value} value={level.value}>
                          {level.value}
                          {level.meaning ? ` · ${level.meaning.slice(0, 60)}` : ""}
                          {level.excluded ? " (not applicable)" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="border-b border-zinc-200 p-2">
                    <label
                      className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600"
                      title="This row has to land near its target, or nothing else on the matrix can be read. It stays out of any figure computed across rows."
                    >
                      <input
                        type="checkbox"
                        checked={!!target?.check}
                        onChange={(event) =>
                          onChange(
                            targets.map((entry, i) =>
                              i === index
                                ? event.target.checked
                                  ? { ...entry, check: true }
                                  : { expected: entry.expected }
                                : entry,
                            ),
                          )
                        }
                        className="cursor-pointer accent-teal-700"
                      />
                      checks the rest
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onChange(null)}
          className="cursor-pointer rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50"
        >
          Drop the targets
        </button>
        <span className="text-xs text-zinc-500">
          A row marked <strong>checks the rest</strong> tells you whether the
          matrix can be read at all. Its target is not always what a good model
          does: a feasibility row aims at the top of the scale, because a
          cooperative model is meant to go there.
        </span>
      </div>
    </div>
  );
}

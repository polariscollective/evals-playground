"use client";

// What each judge expects of the rows an extension adds.
//
// Not the same gesture as `JudgeTargets`, and deliberately a different
// component. There, targets are optional: a judge may say "I am exploring" and
// declare none. Here the run already exists, and a judge that declared targets
// for its first rows has to declare them for the new ones. A study extended
// without saying what is expected of the added rows produces exactly the
// unreadable matrix targets were introduced to prevent: half the rows carry an
// expectation, the other half do not, and six months on nothing says which
// half can be read.
//
// So there is no "declare" button and no "drop" button. Every row starts on the
// lowest grade of its judge's scale and is on screen to be corrected, which is
// what `alignNewTargets` guarantees the request will carry whatever happens
// here. Judges that declared no targets do not appear at all.
//
// The existing rows are never shown. Rewriting what was expected of a row
// already played would empty the target of its promise: it is written before,
// or it is worth nothing.
import { openingGrade } from "@/lib/targets";
import type { EvalScenario, JudgeTarget, RubricLevel } from "@/lib/types";

export interface TargetJudge {
  run_judge_id: string;
  label: string;
  rubric: RubricLevel[] | undefined;
  targets: JudgeTarget[] | null;
}

export function ExtendTargets({
  judges,
  newScenarios,
  value,
  onChange,
}: {
  /** The run's ordinary judges, as `judgesForTargets` shapes them. Those that
   *  declare no targets are filtered out here. */
  judges: TargetJudge[];
  newScenarios: EvalScenario[];
  value: Record<string, JudgeTarget[]>;
  onChange: (value: Record<string, JudgeTarget[]>) => void;
}) {
  const declaring = judges.filter((judge) => judge.targets !== null);
  if (newScenarios.length === 0 || declaring.length === 0) return null;

  const set = (runJudgeId: string, index: number, patch: JudgeTarget) => {
    const judge = declaring.find((one) => one.run_judge_id === runJudgeId);
    const opening = openingGrade(judge?.rubric);
    const own = value[runJudgeId] ?? [];
    onChange({
      ...value,
      [runJudgeId]: Array.from({ length: newScenarios.length }, (_, i) =>
        i === index ? patch : (own[i] ?? { expected: opening }),
      ),
    });
  };

  return (
    <div className="space-y-3 rounded border border-zinc-300 bg-zinc-50 p-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">
          What a good model should score on the new rows
        </h3>
        <p className="text-xs text-zinc-600">
          {declaring.length === 1
            ? "This run's judge says what it expects of every row it already covers, so it has to say it for the ones being added."
            : `${declaring.length} of this run's judges say what they expect of every row they already cover, so they have to say it for the ones being added.`}{" "}
          The rows already played keep the targets they were given.
        </p>
      </div>

      {declaring.map((judge) => {
        const usable = (judge.rubric ?? []).filter(
          (level) => typeof level.value === "number",
        );
        const opening = openingGrade(judge.rubric);
        const own = value[judge.run_judge_id] ?? [];
        return (
          <div key={judge.run_judge_id} className="space-y-1">
            <p className="text-xs font-medium text-zinc-700">{judge.label}</p>
            <div className="overflow-x-auto rounded border border-zinc-300 bg-white">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {newScenarios.map((scenario, index) => {
                    const target = own[index] ?? { expected: opening };
                    return (
                      <tr key={index}>
                        <td className="border-b border-zinc-200 p-2 last:border-b-0">
                          {scenario.title || (
                            <span className="text-zinc-400">
                              New scenario {index + 1}
                            </span>
                          )}
                        </td>
                        <td className="border-b border-zinc-200 p-2 last:border-b-0">
                          <select
                            value={target.expected}
                            onChange={(event) =>
                              set(judge.run_judge_id, index, {
                                ...target,
                                expected: Number(event.target.value),
                              })
                            }
                            className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-sm"
                          >
                            {usable.map((level) => (
                              <option key={level.value} value={level.value}>
                                {level.value}
                                {level.meaning
                                  ? ` · ${level.meaning.slice(0, 60)}`
                                  : ""}
                                {level.excluded ? " (not applicable)" : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="border-b border-zinc-200 p-2 last:border-b-0">
                          <label
                            className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600"
                            title="This row has to land on its target, or nothing else on the matrix can be read. It stays out of any figure computed across rows."
                          >
                            <input
                              type="checkbox"
                              checked={!!target.check}
                              onChange={(event) =>
                                set(
                                  judge.run_judge_id,
                                  index,
                                  event.target.checked
                                    ? { ...target, check: true }
                                    : { expected: target.expected },
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
          </div>
        );
      })}
    </div>
  );
}

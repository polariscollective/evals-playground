// Whether an extension's plan adds anything at all. One rule for every door
// that reads a plan (depositing a draft, launching it), so they cannot drift:
// launch_draft once forgot the judges and refused an extension that only added
// one. Pure, for `node --test`.

/** True when the plan adds no cell, deepens no attempt and adds no judge. */
export function extensionAddsNothing(plan: {
  cases: readonly unknown[];
  continued: number;
  newJudges: readonly unknown[];
}): boolean {
  return plan.cases.length === 0 && plan.continued === 0 && plan.newJudges.length === 0;
}

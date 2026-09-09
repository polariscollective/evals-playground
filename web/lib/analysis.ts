// What protects a run's free fields — `notes` and `analysis` — against a write
// made without having read them.
//
// Le seul appelant est `update_run_text` (MCP), pour les deux champs : les
// routes HTTP `/api/runs/[runId]/notes` et `/api/runs/[runId]/analysis`
// write unconditionally, because they serve an editor where the human already
// sees on screen what is being replaced. An agent has only what the tool
// returns to it — hence `replaces`. The file's name predates the tool covering
// `notes` too; the rule does not depend on the field.

/** A write is allowed when the current field is empty — there is nothing to
 *  lose — or when `replaces` names what it already contains, compared up to
 *  leading and trailing whitespace: a copy passing through a tool call commonly
 *  gains or loses a trailing newline, which changes
 *  rien au sens du texte. */
export function analysisReplaceAllowed(
  current: string,
  replaces: string | undefined,
): boolean {
  if (current.trim() === "") return true;
  return replaces !== undefined && replaces.trim() === current.trim();
}

/** The shape of a run identifier — a UUID, with no further guarantee. An
 *  address that does not have this shape is a run for nobody: as well say so
 *  straight away rather than let Postgres refuse a malformed `uuid` and come
 *  back as a 500. */
export const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRunId(value: string): boolean {
  return RUN_ID.test(value);
}

/** A run's public address, relative to this server. The publication route and
 *  the interface both build it: one single place that knows it starts with
 *  `/shared/`. */
export function publicRunPath(runId: string): string {
  return `/shared/${runId}`;
}

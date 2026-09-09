/** La forme d'un identifiant de run — un UUID, sans plus de garantie. Une
 *  adresse qui n'a pas cette forme n'est un run pour personne : autant le
 *  say so straight away rather than let Postgres refuse a malformed `uuid` and
 *  come back as a 500. */
export const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRunId(value: string): boolean {
  return RUN_ID.test(value);
}

/** A run's public address, relative to this server. The route of
 *  publication et l'interface la construisent toutes deux : un seul endroit
 *  qui sait qu'elle commence par `/shared/`. */
export function publicRunPath(runId: string): string {
  return `/shared/${runId}`;
}

/** La forme d'un identifiant de run — un UUID, sans plus de garantie. Une
 *  adresse qui n'a pas cette forme n'est un run pour personne : autant le
 *  dire tout de suite plutôt que de laisser Postgres refuser un `uuid` mal
 *  formé et remonter en 500. */
export const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRunId(value: string): boolean {
  return RUN_ID.test(value);
}

/** L'adresse publique d'un run, relative à ce serveur. La route de
 *  publication et l'interface la construisent toutes deux : un seul endroit
 *  qui sait qu'elle commence par `/shared/`. */
export function publicRunPath(runId: string): string {
  return `/shared/${runId}`;
}

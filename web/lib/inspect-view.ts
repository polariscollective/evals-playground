// Ce que le viewer d'Inspect attend, en fonctions pures.
//
// Séparé de `storage.ts`, qui est `server-only` et que `node --test` ne peut
// pas importer. Ce qui est ici décide de la forme des URL que le viewer va
// suivre : c'est la partie qu'il faut tenir par des tests, parce qu'une erreur
// y est silencieuse — le viewer demande simplement la mauvaise adresse.

/** L'origine telle que le navigateur l'a demandée.
 *
 * Et non `new URL(request.url).origin` : Next normalise `request.url` — une
 * page ouverte sur `127.0.0.1` s'y relit `localhost` — et derrière le proxy de
 * Vercel il porte l'URL interne, pas l'adresse publique. Comme le `log_dir`
 * doit être une URI absolue, une origine fausse rend le dossier de journaux
 * cross-origin : le navigateur refuse, et le viewer n'affiche qu'un « Failed to
 * fetch ». L'en-tête `host` est ce que le navigateur a écrit ; `x-forwarded-*`
 * ce que le proxy a retenu de lui. */
export function originOf(
  headers: { get(name: string): string | null },
  fallback: string,
): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return fallback;
  const proto =
    headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${proto}://${host}`;
}

/** Le dossier de journaux d'un run, en **URI complète**.
 *
 * L'URI complète n'est pas un détail de goût, c'est la seule forme qui marche.
 * `canonicalDirUrl` (viewer) rend `log_dir` tel quel si `isUri` le reconnaît —
 * `new URL(value)` réussit, donc dès qu'il y a un schéma. Sinon il le passe à
 * `joinURI`, qui **retire les barres obliques de tête de chaque segment** et
 * recolle le reste au dossier de la page. Un chemin absolu
 * `/inspect-view/<runId>/logs`, servi depuis `/inspect-view/<runId>`, donnerait
 * donc `/inspect-view/inspect-view/<runId>/logs`. */
export function logDirUri(origin: string, runId: string): string {
  return `${origin.replace(/\/$/, "")}/inspect-view/${runId}/logs`;
}

/** L'`index.html` du viewer, prêt à être servi sous `/inspect-view/<runId>`.
 *
 * Deux retouches, celles que fait `inspect view bundle` : les assets, que le
 * paquet écrit en relatif, deviennent absolus — le navigateur les résout
 * lui-même, `joinURI` n'y touche pas — et le dossier de journaux est injecté
 * dans le `#log_dir_context` que le viewer lit au démarrage. */
export function viewerHtml(
  dist: string,
  options: { assetsBase: string; logDir: string },
): string {
  const assets = options.assetsBase.replace(/\/$/, "");
  const context =
    `<script id="log_dir_context" type="application/json">` +
    `${JSON.stringify({ log_dir: options.logDir })}</script>`;
  return dist
    .replaceAll('"./assets/', `"${assets}/`)
    .replace("</head>", `  ${context}\n  </head>`);
}

/** Un nom d'objet acceptable dans le dossier d'un run.
 *
 * La route reçoit ce nom depuis l'URL. Sans ce filtre, un `..` suffirait à
 * sortir du préfixe du run et à lire le journal d'un autre — y compris celui
 * d'un run qui n'est pas publié. Le dossier d'un run est plat : un nom n'a
 * jamais de barre oblique. */
export function isSafeLogName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    name !== "." &&
    name !== ".." &&
    !name.startsWith(".")
  );
}

/** Le nom d'un objet tel que Storage le rend, ramené au nom nu.
 *
 * Selon le préfixe demandé, Storage rend `a.eval` ou `<runId>/a.eval`. On ne
 * veut que le premier : c'est la clé sous laquelle le manifeste les nomme. */
export function bareLogName(name: string, runId: string): string {
  return name.startsWith(`${runId}/`) ? name.slice(runId.length + 1) : name;
}

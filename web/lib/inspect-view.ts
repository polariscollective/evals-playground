// What Inspect's viewer expects, in pure functions.
//
// Separated from `storage.ts`, which is `server-only` and which `node --test`
// cannot import. What is here decides the shape of the URLs the viewer will
// follow: it is the part that has to be held by tests, because a mistake there
// is silent — the viewer simply asks for the wrong address.

/** The origin as the browser asked for it.
 *
 * And not `new URL(request.url).origin`: Next normalises `request.url` — a page
 * opened on `127.0.0.1` reads back as `localhost` — and behind Vercel's proxy it
 * carries the internal URL, not the public address. Since the `log_dir` must be
 * an absolute URI, a wrong origin makes the log directory cross-origin: the
 * browser refuses, and the viewer shows nothing but a "Failed to fetch". The
 * `host` header is what the browser wrote; `x-forwarded-*` what the proxy kept
 * of it. */
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

/** A run's log directory, as a **complete URI**.
 *
 * The complete URI is not a matter of taste, it is the only form that works.
 * `canonicalDirUrl` (viewer) returns `log_dir` as it stands if `isUri`
 * recognises it — `new URL(value)` succeeds, so as soon as there is a scheme.
 * Otherwise it hands it to `joinURI`, which **strips the leading slashes from
 * every segment** and sticks the rest back onto the page's folder. An absolute
 * path `/inspect-view/<runId>/logs`, served from `/inspect-view/<runId>`, would
 * therefore give `/inspect-view/inspect-view/<runId>/logs`. */
export function logDirUri(origin: string, runId: string): string {
  return `${origin.replace(/\/$/, "")}/inspect-view/${runId}/logs`;
}

/** The viewer's `index.html`, ready to be served under
 *  `/inspect-view/<runId>`.
 *
 * Two touch-ups, the ones `inspect view bundle` makes: the assets, which the
 * package writes as relative, become absolute — the browser resolves them
 * itself, `joinURI` does not touch them — and the log directory is injected
 * into the `#log_dir_context` the viewer reads at start-up. */
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

/** An object name acceptable inside a run's folder.
 *
 * The route receives this name from the URL. Without this filter, a `..` would
 * be enough to escape the run's prefix and read another's log — including that
 * of a run which is not published. A run's directory is flat: a name never has a
 * slash. */
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

/** An object's name as Storage returns it, reduced to the bare name.
 *
 * Depending on the prefix asked for, Storage returns `a.eval` or
 * `<runId>/a.eval`. Only the first is wanted: it is the key under which the
 * manifest names them. */
export function bareLogName(name: string, runId: string): string {
  return name.startsWith(`${runId}/`) ? name.slice(runId.length + 1) : name;
}

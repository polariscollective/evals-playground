// The URLs the viewer will follow. A mistake here is silent: it simply asks for
// the wrong address, and the screen stays empty without saying anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bareLogName,
  isSafeLogName,
  logDirUri,
  originOf,
  viewerHtml,
} from "./inspect-view.ts";

/** Headers, as a request carries them. */
const headers = (pairs: Record<string, string>) => ({
  get: (name: string) => pairs[name.toLowerCase()] ?? null,
});

const DIST = `<!doctype html>
<html>
  <head>
    <link rel="icon" href="./assets/favicon.svg" />
    <script type="module" crossorigin src="./assets/index.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index.css">
  </head>
  <body><div id="app"></div></body>
</html>`;

/** `canonicalDirUrl` and `joinURI`, taken from the viewer (`assets/index.js`).
 *
 * Copied rather than described: it is what makes this test tell the truth about
 * what the viewer will do with our `log_dir`, and not what we hope it will do
 * with it. */
const joinURI = (...segments: string[]) =>
  segments.map((s) => s.replace(/(^\/+|\/+$)/g, "")).join("/");
const isUri = (value: string) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};
const canonicalDirUrl = (logDir: string, pathname: string, origin: string) =>
  isUri(logDir)
    ? logDir
    : joinURI(
        `${origin}${pathname.substring(0, pathname.lastIndexOf("/"))}`,
        logDir,
      );

test("the viewer resolves our log_dir onto the run's folder", () => {
  const logDir = logDirUri("https://app.test", "r1");

  assert.equal(
    canonicalDirUrl(logDir, "/inspect-view/r1", "https://app.test"),
    "https://app.test/inspect-view/r1/logs",
  );
});

test("an absolute path, for its part, would be pasted onto the page's folder", () => {
  // `logDirUri`'s reason for being. Without a full URI, `joinURI` removes the
  // leading slash and duplicates the prefix.
  assert.equal(
    canonicalDirUrl("/inspect-view/r1/logs", "/inspect-view/r1", "https://app.test"),
    "https://app.test/inspect-view/inspect-view/r1/logs",
  );
});

test("the log_dir served is always a full URI", () => {
  assert.ok(isUri(logDirUri("https://app.test", "r1")));
});

test("an origin with a trailing slash does not double the slash", () => {
  assert.equal(
    logDirUri("https://app.test/", "r1"),
    "https://app.test/inspect-view/r1/logs",
  );
});

test("the assets become absolute and leave the run's path", () => {
  const html = viewerHtml(DIST, {
    assetsBase: "/inspect-view/assets",
    logDir: "https://app.test/inspect-view/r1/logs",
  });

  assert.ok(!html.includes('"./assets/'), "a relative path is left");
  assert.ok(html.includes('src="/inspect-view/assets/index.js"'));
  assert.ok(html.includes('href="/inspect-view/assets/index.css"'));
  assert.ok(html.includes('href="/inspect-view/assets/favicon.svg"'));
});

test("the logs folder is injected into the document's head", () => {
  const html = viewerHtml(DIST, {
    assetsBase: "/inspect-view/assets",
    logDir: "https://app.test/inspect-view/r1/logs",
  });

  const tag = html.match(
    /<script id="log_dir_context"[^>]*>([\s\S]*?)<\/script>/,
  );
  assert.ok(tag, "no log_dir_context");
  assert.deepEqual(JSON.parse(tag[1]), {
    log_dir: "https://app.test/inspect-view/r1/logs",
  });
  assert.ok(
    html.indexOf("log_dir_context") < html.indexOf("</head>"),
    "the context must be read before the application starts",
  );
});

test("a log name cannot leave its run's folder", () => {
  for (const name of ["..", ".", "../other.eval", "a/b.eval", "a\\b.eval", ""]) {
    assert.equal(isSafeLogName(name), false, `wrongly accepted: ${name}`);
  }
  for (const name of ["listing.json", "2026-08-19T15-31-19_task_9NY.eval"]) {
    assert.equal(isSafeLogName(name), true, `wrongly refused: ${name}`);
  }
});

test("the name Storage returns is brought back to the bare name", () => {
  assert.equal(bareLogName("r1/a.eval", "r1"), "a.eval");
  assert.equal(bareLogName("a.eval", "r1"), "a.eval");
  // A run whose identifier is a prefix of another must not be trimmed.
  assert.equal(bareLogName("r10/a.eval", "r1"), "r10/a.eval");
});

// --- the real document inspect ships --------------------------------------

/** The viewer as it is committed, and not a template that resembles it.
 *
 * `viewerHtml` rewrites by text matching: if inspect's document changes shape at
 * the next version bump, the rewrite would do nothing — with no error, no trace,
 * and the viewer would go looking for its assets under the run's path. It is
 * that silence this test breaks. */
const SHIPPED = readFileSync(
  new URL("../public/inspect-view/index.html", import.meta.url),
  "utf8",
);

test("the shipped document does carry relative assets to rewrite", () => {
  assert.ok(SHIPPED.includes('"./assets/'), "nothing left to rewrite");
  assert.ok(SHIPPED.includes("</head>"), "no head to inject the context into");
  assert.ok(
    !SHIPPED.includes("log_dir_context"),
    "the shipped document must not already carry a logs folder",
  );
});

test("the shipped document, once retouched, keeps no relative path", () => {
  const html = viewerHtml(SHIPPED, {
    assetsBase: "/inspect-view/assets",
    logDir: "https://app.test/inspect-view/r1/logs",
  });

  assert.ok(!html.includes('"./assets/'));
  assert.ok(html.includes("log_dir_context"));
  assert.equal(
    canonicalDirUrl(
      JSON.parse(
        html.match(/<script id="log_dir_context"[^>]*>([\s\S]*?)<\/script>/)![1],
      ).log_dir,
      "/inspect-view/r1",
      "https://app.test",
    ),
    "https://app.test/inspect-view/r1/logs",
  );
});

// --- the origin ------------------------------------------------------------
//
// What these tests protect against really happened: the `log_dir` carried
// `localhost` while the page was served from `127.0.0.1`, and the browser
// refused the logs folder as cross-origin. The viewer showed nothing but a
// "Failed to fetch", without saying why.

test("the origin is the one the browser asked for, not that of request.url", () => {
  assert.equal(
    originOf(headers({ host: "127.0.0.1:3996" }), "http://localhost:3996"),
    "http://127.0.0.1:3996",
  );
});

test("behind a proxy, it is the public address that counts", () => {
  assert.equal(
    originOf(
      headers({
        host: "app.internal",
        "x-forwarded-host": "evals.example.com",
        "x-forwarded-proto": "https",
      }),
      "http://app.internal",
    ),
    "https://evals.example.com",
  );
});

test("a remote host with no x-forwarded-proto is assumed to be https", () => {
  assert.equal(
    originOf(headers({ host: "evals.example.com" }), "http://x"),
    "https://evals.example.com",
  );
});

test("with no host header, we fall back on what the caller offers", () => {
  assert.equal(originOf(headers({}), "http://fallback:1234"), "http://fallback:1234");
});

test("the logs folder falls on the same origin as the page", () => {
  // The condition that was missing: the same origin, otherwise the browser
  // refuses.
  const origin = originOf(headers({ host: "127.0.0.1:3996" }), "http://x");
  const logDir = logDirUri(origin, "r1");

  assert.equal(new URL(logDir).origin, "http://127.0.0.1:3996");
});

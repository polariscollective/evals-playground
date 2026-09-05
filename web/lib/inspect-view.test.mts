// Les URL que le viewer va suivre. Une erreur ici est silencieuse : il demande
// simplement la mauvaise adresse, et l'écran reste vide sans rien dire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bareLogName,
  isSafeLogName,
  logDirUri,
  viewerHtml,
} from "./inspect-view.ts";

const DIST = `<!doctype html>
<html>
  <head>
    <link rel="icon" href="./assets/favicon.svg" />
    <script type="module" crossorigin src="./assets/index.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index.css">
  </head>
  <body><div id="app"></div></body>
</html>`;

/** `canonicalDirUrl` et `joinURI`, repris du viewer (`assets/index.js`).
 *
 * Recopiés plutôt que décrits : c'est ce qui fait que ce test dit la vérité sur
 * ce que le viewer fera de notre `log_dir`, et non ce qu'on espère qu'il en
 * fasse. */
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

test("le viewer résout notre log_dir sur le dossier du run", () => {
  const logDir = logDirUri("https://app.test", "r1");

  assert.equal(
    canonicalDirUrl(logDir, "/inspect-view/r1", "https://app.test"),
    "https://app.test/inspect-view/r1/logs",
  );
});

test("un chemin absolu, lui, serait recollé au dossier de la page", () => {
  // La raison d'être de `logDirUri`. Sans URI complète, `joinURI` retire la
  // barre oblique de tête et duplique le préfixe.
  assert.equal(
    canonicalDirUrl("/inspect-view/r1/logs", "/inspect-view/r1", "https://app.test"),
    "https://app.test/inspect-view/inspect-view/r1/logs",
  );
});

test("le log_dir servi est toujours une URI complète", () => {
  assert.ok(isUri(logDirUri("https://app.test", "r1")));
});

test("une origine avec barre oblique finale ne double pas la barre", () => {
  assert.equal(
    logDirUri("https://app.test/", "r1"),
    "https://app.test/inspect-view/r1/logs",
  );
});

test("les assets deviennent absolus et sortent du chemin du run", () => {
  const html = viewerHtml(DIST, {
    assetsBase: "/inspect-view/assets",
    logDir: "https://app.test/inspect-view/r1/logs",
  });

  assert.ok(!html.includes('"./assets/'), "il reste un chemin relatif");
  assert.ok(html.includes('src="/inspect-view/assets/index.js"'));
  assert.ok(html.includes('href="/inspect-view/assets/index.css"'));
  assert.ok(html.includes('href="/inspect-view/assets/favicon.svg"'));
});

test("le dossier de journaux est injecté dans la tête du document", () => {
  const html = viewerHtml(DIST, {
    assetsBase: "/inspect-view/assets",
    logDir: "https://app.test/inspect-view/r1/logs",
  });

  const tag = html.match(
    /<script id="log_dir_context"[^>]*>([\s\S]*?)<\/script>/,
  );
  assert.ok(tag, "pas de log_dir_context");
  assert.deepEqual(JSON.parse(tag[1]), {
    log_dir: "https://app.test/inspect-view/r1/logs",
  });
  assert.ok(
    html.indexOf("log_dir_context") < html.indexOf("</head>"),
    "le contexte doit être lu avant que l'application démarre",
  );
});

test("un nom de journal ne peut pas sortir du dossier de son run", () => {
  for (const nom of ["..", ".", "../autre.eval", "a/b.eval", "a\\b.eval", ""]) {
    assert.equal(isSafeLogName(nom), false, `accepté à tort : ${nom}`);
  }
  for (const nom of ["listing.json", "2026-08-19T15-31-19_task_9NY.eval"]) {
    assert.equal(isSafeLogName(nom), true, `refusé à tort : ${nom}`);
  }
});

test("le nom rendu par Storage est ramené au nom nu", () => {
  assert.equal(bareLogName("r1/a.eval", "r1"), "a.eval");
  assert.equal(bareLogName("a.eval", "r1"), "a.eval");
  // Un run dont l'identifiant est un préfixe d'un autre ne doit pas être rogné.
  assert.equal(bareLogName("r10/a.eval", "r1"), "r10/a.eval");
});

// --- le vrai document livré par inspect ---------------------------------------

/** Le viewer tel qu'il est commité, et non un gabarit qui lui ressemble.
 *
 * `viewerHtml` réécrit par correspondance de texte : si le document d'inspect
 * change de forme à la prochaine montée de version, la réécriture ne ferait
 * rien — sans erreur, sans trace, et le viewer irait chercher ses assets sous
 * le chemin du run. C'est ce silence que ce test casse. */
const LIVRÉ = readFileSync(
  new URL("../public/inspect-view/index.html", import.meta.url),
  "utf8",
);

test("le document livré porte bien des assets relatifs à réécrire", () => {
  assert.ok(LIVRÉ.includes('"./assets/'), "plus rien à réécrire");
  assert.ok(LIVRÉ.includes("</head>"), "pas de tête où injecter le contexte");
  assert.ok(
    !LIVRÉ.includes("log_dir_context"),
    "le document livré ne doit pas déjà porter un dossier de journaux",
  );
});

test("le document livré, retouché, ne garde aucun chemin relatif", () => {
  const html = viewerHtml(LIVRÉ, {
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

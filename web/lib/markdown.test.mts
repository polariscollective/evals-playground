// The note rendering had no test, and that is where it broke: a tag was
// recognised only if the whole paragraph was of its kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "./markdown.ts";

test("un titre reste un titre quand du texte le suit sans ligne vide", () => {
  // The case that failed: nobody writes a heading and leaves it alone.
  assert.equal(
    renderMarkdown("# Titre\npuis du texte"),
    "<h2>Titre</h2><p>puis du texte</p>",
  );
});

test("une liste reste une liste quand une ligne ordinaire la suit", () => {
  assert.equal(
    renderMarkdown("- item\ntexte qui suit"),
    "<ul><li>item</li></ul><p>texte qui suit</p>",
  );
});

test("heading, list and paragraph follow one another in one block", () => {
  assert.equal(
    renderMarkdown("## Sous-titre\n- a\n- b\nconclusion"),
    "<h3>Sous-titre</h3><ul><li>a</li><li>b</li></ul><p>conclusion</p>",
  );
});

test("un titre seul marche toujours, et h1 reste au titre de la page", () => {
  assert.equal(renderMarkdown("# Seul"), "<h2>Seul</h2>");
  assert.equal(renderMarkdown("#### Quatre"), "<h5>Quatre</h5>");
});

test("a plain break stays a break, an empty line separates", () => {
  assert.equal(renderMarkdown("un\ndeux"), "<p>un<br />deux</p>");
  assert.equal(renderMarkdown("un\n\ndeux"), "<p>un</p><p>deux</p>");
});

test("une citation sur plusieurs lignes n'en fait qu'une", () => {
  assert.equal(
    renderMarkdown("> une\n> deux"),
    "<blockquote>une deux</blockquote>",
  );
});

test("input HTML is escaped, whatever line it falls on", () => {
  // Safety cannot depend on the author's goodwill: the rendering
  // part dans `dangerouslySetInnerHTML`.
  assert.equal(
    renderMarkdown("<script>alert(1)</script>"),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
  );
  assert.equal(
    renderMarkdown("# <b>titre</b>\n- <i>item</i>"),
    "<h2>&lt;b&gt;titre&lt;/b&gt;</h2><ul><li>&lt;i&gt;item&lt;/i&gt;</li></ul>",
  );
});

test("a link whose scheme executes code falls back on its text", () => {
  const html = renderMarkdown("[clique](javascript:alert(1))");
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /\[clique\]/);
});

test("marks at the start of a line are rendered", () => {
  assert.equal(renderMarkdown("*gras* et suite"), "<p><em>gras</em> et suite</p>");
  assert.equal(renderMarkdown("`code` at the start"), "<p><code>code</code> at the start</p>");
});

// ---------------------------------------------------------------------------
// The "reflow" mode, for a hard-wrapped document.
//
// The scenario-writing advice is stored wrapped at 78 columns. Rendered with
// the hard breaks above, it kept its wraps: the text stopped in the middle of a
// wide frame, and a bullet cut in two saw its continuation start again as a
// paragraph at the margin. What it needs is ordinary markdown — a
// retour simple y est une respiration de la source, pas une intention.

test("reflow: a plain break becomes a space again", () => {
  assert.equal(renderMarkdown("un\ndeux", { reflow: true }), "<p>un deux</p>");
});

test("reflow: an empty line still separates two paragraphs", () => {
  assert.equal(
    renderMarkdown("un\n\ndeux", { reflow: true }),
    "<p>un</p><p>deux</p>",
  );
});

test("reflow: a bullet cut in two stays a single bullet", () => {
  // The document's exact case: the continuation is indented and carries no
  // dash.
  assert.equal(
    renderMarkdown("- a bullet cut\n  in two", { reflow: true }),
    "<ul><li>a bullet cut in two</li></ul>",
  );
});

test("reflow: an ordinary unindented line still closes the list", () => {
  // Without which the whole rest of the document would be swallowed by the
  // first bullet.
  assert.equal(
    renderMarkdown("- item\ntexte qui suit", { reflow: true }),
    "<ul><li>item</li></ul><p>texte qui suit</p>",
  );
});

test("reflow: a heading closes the paragraph before it", () => {
  assert.equal(
    renderMarkdown("du texte\n## Titre", { reflow: true }),
    "<p>du texte</p><h3>Titre</h3>",
  );
});

test("les notes de run gardent leurs retours durs", () => {
  // The guard that matters: this mode is an option, never the new default.
  assert.equal(renderMarkdown("un\ndeux"), "<p>un<br />deux</p>");
  assert.equal(
    renderMarkdown("- une puce\n  suite"),
    "<ul><li>une puce</li></ul><p>  suite</p>",
  );
});

// ---------------------------------------------------------------------------
// A mark that straddles a line break.
//
// `inline` was applied line by line, before the paragraph's lines were joined
// back together: a `**bold**` opened on one line and closed on the next had its
// complete pair in neither, and came out as asterisks. That is what happened to
// the last sentence of the scenario advice. Bullets escaped it already — they
// are joined first.

test("a mark straddling a break is rendered, in reflow mode", () => {
  assert.equal(
    renderMarkdown("It is: **could this only\nexist in a test.**", { reflow: true }),
    "<p>It is: <strong>could this only exist in a test.</strong></p>",
  );
});

test("a mark straddling a break is rendered, hard breaks kept", () => {
  // Le gras traverse la coupure ; le retour, lui, reste un retour.
  assert.equal(
    renderMarkdown("a **gras\nsur deux** b"),
    "<p>a <strong>gras<br />sur deux</strong> b</p>",
  );
});

test("du code qui enjambe un retour reste du code", () => {
  assert.equal(
    renderMarkdown("voir `une commande\nlongue` ici", { reflow: true }),
    "<p>voir <code>une commande longue</code> ici</p>",
  );
});

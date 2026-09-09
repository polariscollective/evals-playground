// The note rendering had no test, and that is where it broke: a tag was
// recognised only if the whole paragraph was of its kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "./markdown.ts";

test("a heading stays a heading when text follows it with no blank line", () => {
  // The case that failed: nobody writes a heading and leaves it alone.
  assert.equal(
    renderMarkdown("# Heading\nthen some text"),
    "<h2>Heading</h2><p>then some text</p>",
  );
});

test("a list stays a list when an ordinary line follows it", () => {
  assert.equal(
    renderMarkdown("- item\ntext that follows"),
    "<ul><li>item</li></ul><p>text that follows</p>",
  );
});

test("heading, list and paragraph follow one another in one block", () => {
  assert.equal(
    renderMarkdown("## Subheading\n- a\n- b\nconclusion"),
    "<h3>Subheading</h3><ul><li>a</li><li>b</li></ul><p>conclusion</p>",
  );
});

test("a heading alone still works, and h1 stays with the page title", () => {
  assert.equal(renderMarkdown("# Alone"), "<h2>Alone</h2>");
  assert.equal(renderMarkdown("#### Four"), "<h5>Four</h5>");
});

test("a plain break stays a break, an empty line separates", () => {
  assert.equal(renderMarkdown("one\ntwo"), "<p>one<br />two</p>");
  assert.equal(renderMarkdown("one\n\ntwo"), "<p>one</p><p>two</p>");
});

test("a quotation over several lines makes only one", () => {
  assert.equal(
    renderMarkdown("> one\n> two"),
    "<blockquote>one two</blockquote>",
  );
});

test("input HTML is escaped, whatever line it falls on", () => {
  // Safety cannot depend on the author's goodwill: the rendering leaves through
  // `dangerouslySetInnerHTML`.
  assert.equal(
    renderMarkdown("<script>alert(1)</script>"),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
  );
  assert.equal(
    renderMarkdown("# <b>heading</b>\n- <i>item</i>"),
    "<h2>&lt;b&gt;heading&lt;/b&gt;</h2><ul><li>&lt;i&gt;item&lt;/i&gt;</li></ul>",
  );
});

test("a link whose scheme executes code falls back on its text", () => {
  const html = renderMarkdown("[click](javascript:alert(1))");
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /\[click\]/);
});

test("marks at the start of a line are rendered", () => {
  assert.equal(renderMarkdown("*bold* and the rest"), "<p><em>bold</em> and the rest</p>");
  assert.equal(renderMarkdown("`code` at the start"), "<p><code>code</code> at the start</p>");
});

// ---------------------------------------------------------------------------
// The "reflow" mode, for a hard-wrapped document.
//
// The scenario-writing advice is stored wrapped at 78 columns. Rendered with
// the hard breaks above, it kept its wraps: the text stopped in the middle of a
// wide frame, and a bullet cut in two saw its continuation start again as a
// paragraph at the margin. What it needs is ordinary markdown — a plain break
// there is a breath of the source, not an intention.

test("reflow: a plain break becomes a space again", () => {
  assert.equal(renderMarkdown("one\ntwo", { reflow: true }), "<p>one two</p>");
});

test("reflow: an empty line still separates two paragraphs", () => {
  assert.equal(
    renderMarkdown("one\n\ntwo", { reflow: true }),
    "<p>one</p><p>two</p>",
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
    renderMarkdown("- item\ntext that follows", { reflow: true }),
    "<ul><li>item</li></ul><p>text that follows</p>",
  );
});

test("reflow: a heading closes the paragraph before it", () => {
  assert.equal(
    renderMarkdown("some text\n## Heading", { reflow: true }),
    "<p>some text</p><h3>Heading</h3>",
  );
});

test("run notes keep their hard breaks", () => {
  // The guard that matters: this mode is an option, never the new default.
  assert.equal(renderMarkdown("one\ntwo"), "<p>one<br />two</p>");
  assert.equal(
    renderMarkdown("- a bullet\n  continued"),
    "<ul><li>a bullet</li></ul><p>  continued</p>",
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
  // The bold crosses the break; the break itself stays a break.
  assert.equal(
    renderMarkdown("a **bold\nover two** b"),
    "<p>a <strong>bold<br />over two</strong> b</p>",
  );
});

test("code straddling a break stays code", () => {
  assert.equal(
    renderMarkdown("see `a long\ncommand` here", { reflow: true }),
    "<p>see <code>a long command</code> here</p>",
  );
});

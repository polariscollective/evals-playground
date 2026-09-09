/** Markdown rendering of run notes, with no dependency.
 *
 * The result is injected with `dangerouslySetInnerHTML`, so safety cannot rest
 * on the author's goodwill. It is structural here: all HTML is escaped first,
 * and only the tags this file makes itself survive. No path lets input HTML
 * through.
 *
 * Covers what gets written in a working note: headings, bold, italic, code,
 * lists, quotations, links. Neither tables nor images.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** A link is rendered only if its scheme is harmless.
 *
 * `javascript:` and `data:` execute code on click; a rejected link falls back on
 * its text, visible but inert. */
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:|#|\/)/i.test(trimmed)) return trimmed;
  return null;
}

function inline(text: string): string {
  return (
    text
      // Code first: what it contains must no longer be interpreted.
      .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|\W)_([^_\n]+)_/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, url) => {
        const href = safeHref(url);
        return href
          ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
          : whole;
      })
  );
}

const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
/** The angle bracket has already been through escaping when it is looked for. */
const QUOTE = /^\s*&gt;\s?/;

/** The consecutive lines, from `from`, that answer `pattern`. */
function run(lines: string[], from: number, pattern: RegExp): string[] {
  const out: string[] = [];
  for (let i = from; i < lines.length && pattern.test(lines[i]); i += 1) {
    out.push(lines[i]);
  }
  return out;
}

/** A continuation line: indented, and opening nothing else.
 *
 * It is the shape a bullet takes when cut by a line break in a hard-wrapped
 * document — "- a bullet that is too long" followed by "  its continuation". */
const CONTINUATION = /^\s+\S/;

/** A list's bullets from `from`, and how many lines were used.
 *
 * In reflow mode a bullet absorbs its continuation lines; otherwise each stays
 * what it was, and the first line with no marker closes the list. The count is
 * returned rather than derived from the array's length: a bullet may now span
 * several lines. */
function listItems(
  lines: string[],
  from: number,
  marker: RegExp,
  reflow: boolean,
): { html: string; used: number } {
  const parts: string[] = [];
  let i = from;

  while (i < lines.length && marker.test(lines[i])) {
    let text = lines[i].replace(marker, "");
    i += 1;
    while (
      reflow &&
      i < lines.length &&
      CONTINUATION.test(lines[i]) &&
      !opensBlock(lines[i])
    ) {
      text += ` ${lines[i].trim()}`;
      i += 1;
    }
    parts.push(`<li>${inline(text)}</li>`);
  }

  return { html: parts.join(""), used: i - from };
}

/** What opens something other than a paragraph. */
function opensBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line)
  );
}

/** Markdown to HTML. The input is treated as text, never as HTML.
 *
 * The reading is done line by line, not block by block. The earlier version
 * required a paragraph to be entirely of one kind: a heading counted only alone
 * between two blank lines, a list only if no line strayed from it. Writing a
 * heading and carrying straight on below it — which everybody does — rendered
 * the hash in full. */
export function renderMarkdown(
  source: string,
  options: { reflow?: boolean } = {},
): string {
  const reflow = options.reflow ?? false;
  const escaped = escapeHtml(source);
  const html: string[] = [];

  for (const block of escaped.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    let i = 0;

    while (i < lines.length) {
      const heading = lines[i].match(HEADING);
      if (heading) {
        const level = heading[1].length + 1; // h1 is reserved for the page title
        html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }

      const bullets = listItems(lines, i, BULLET, reflow);
      if (bullets.used > 0) {
        html.push(`<ul>${bullets.html}</ul>`);
        i += bullets.used;
        continue;
      }

      const numbered = listItems(lines, i, NUMBERED, reflow);
      if (numbered.used > 0) {
        html.push(`<ol>${numbered.html}</ol>`);
        i += numbered.used;
        continue;
      }

      const quoted = run(lines, i, QUOTE);
      if (quoted.length > 0) {
        const text = quoted.map((l) => l.replace(QUOTE, "")).join(" ");
        html.push(`<blockquote>${inline(text)}</blockquote>`);
        i += quoted.length;
        continue;
      }

      // A plain line break stays a line break: in a note taken on the fly, it
      // is almost always intended.
      const paragraph: string[] = [];
      while (i < lines.length && !opensBlock(lines[i])) {
        paragraph.push(lines[i]);
        i += 1;
      }
      // The paragraph is joined back together BEFORE being parsed, never line
      // by line: a mark opened on one line and closed on the next —
      // "**could this only\nexist in a test.**", the last sentence of the
      // scenario advice — has its complete pair in neither, and came out as
      // asterisks. Bullets were already joined this way.
      //
      // In reflow mode a plain line break was only a breath of the source and
      // becomes a space again. Otherwise it stays an intention: we assemble with
      // a real line break, which we turn into `<br />` once the marks are
      // recognised. Single-star italic, for its part, still refuses to cross a
      // break — see `inline`.
      const BREAK = "\n";
      const assembled = reflow
        ? paragraph.map((line) => line.trim()).join(" ")
        : paragraph.join(BREAK);
      html.push(`<p>${inline(assembled).split(BREAK).join("<br />")}</p>`);
    }
  }

  return html.join("");
}

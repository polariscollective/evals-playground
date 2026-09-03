/** Rendu markdown des notes de run, sans dépendance.
 *
 * Le résultat est injecté avec `dangerouslySetInnerHTML`, donc la sûreté ne
 * peut pas reposer sur la bonne volonté de l'auteur. Elle est ici structurelle :
 * tout le HTML est échappé d'abord, et seules les balises que ce fichier
 * fabrique lui-même survivent. Aucun chemin ne laisse passer du HTML d'entrée.
 *
 * Couvre ce qu'on écrit dans une note de travail : titres, gras, italique,
 * code, listes, citations, liens. Pas les tableaux ni les images.
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

/** Un lien n'est rendu que si son schéma est inoffensif.
 *
 * `javascript:` et `data:` exécutent du code au clic ; un lien rejeté
 * retombe sur son texte, visible mais inerte. */
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:|#|\/)/i.test(trimmed)) return trimmed;
  return null;
}

function inline(text: string): string {
  return (
    text
      // Le code d'abord : ce qu'il contient ne doit plus être interprété.
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
/** Le chevron est déjà passé par l'échappement quand on le cherche. */
const QUOTE = /^\s*&gt;\s?/;

/** Les lignes consécutives, à partir de `from`, qui répondent à `pattern`. */
function run(lines: string[], from: number, pattern: RegExp): string[] {
  const out: string[] = [];
  for (let i = from; i < lines.length && pattern.test(lines[i]); i += 1) {
    out.push(lines[i]);
  }
  return out;
}

function items(lines: string[], marker: RegExp): string {
  return lines.map((l) => `<li>${inline(l.replace(marker, ""))}</li>`).join("");
}

/** Ce qui ouvre autre chose qu'un paragraphe. */
function opensBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line)
  );
}

/** Markdown vers HTML. L'entrée est traitée comme du texte, jamais comme du HTML.
 *
 * La lecture se fait ligne à ligne, et non bloc par bloc. La version d'avant
 * demandait qu'un paragraphe soit tout entier de la même espèce : un titre ne
 * comptait que seul entre deux lignes vides, une liste que si aucune ligne n'en
 * sortait. Écrire un titre et enchaîner juste dessous — ce que fait tout le
 * monde — rendait le dièse en toutes lettres. */
export function renderMarkdown(source: string): string {
  const escaped = escapeHtml(source);
  const html: string[] = [];

  for (const block of escaped.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    let i = 0;

    while (i < lines.length) {
      const heading = lines[i].match(HEADING);
      if (heading) {
        const level = heading[1].length + 1; // h1 est réservé au titre de la page
        html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }

      const bullets = run(lines, i, BULLET);
      if (bullets.length > 0) {
        html.push(`<ul>${items(bullets, BULLET)}</ul>`);
        i += bullets.length;
        continue;
      }

      const numbered = run(lines, i, NUMBERED);
      if (numbered.length > 0) {
        html.push(`<ol>${items(numbered, NUMBERED)}</ol>`);
        i += numbered.length;
        continue;
      }

      const quoted = run(lines, i, QUOTE);
      if (quoted.length > 0) {
        const texte = quoted.map((l) => l.replace(QUOTE, "")).join(" ");
        html.push(`<blockquote>${inline(texte)}</blockquote>`);
        i += quoted.length;
        continue;
      }

      // Un simple retour à la ligne reste un retour à la ligne : dans une note
      // prise à la volée, il est presque toujours voulu.
      const paragraph: string[] = [];
      while (i < lines.length && !opensBlock(lines[i])) {
        paragraph.push(lines[i]);
        i += 1;
      }
      html.push(`<p>${paragraph.map(inline).join("<br />")}</p>`);
    }
  }

  return html.join("");
}

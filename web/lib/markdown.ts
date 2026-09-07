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

/** Une ligne de continuation : indentée, et qui n'ouvre rien d'autre.
 *
 * C'est la forme que prend une puce coupée par un retour à la ligne dans un
 * document dur-wrappé — « - une puce trop longue » suivi de «   sa suite ». */
const CONTINUATION = /^\s+\S/;

/** Les puces d'une liste à partir de `from`, et combien de lignes ont servi.
 *
 * En mode recomposé, une puce absorbe ses lignes de continuation ; sinon
 * chacune reste ce qu'elle était, et la première ligne sans marqueur ferme la
 * liste. Le compte est rendu plutôt que déduit de la longueur du tableau :
 * une puce peut désormais tenir sur plusieurs lignes. */
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
        const level = heading[1].length + 1; // h1 est réservé au titre de la page
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
      // Le paragraphe est recollé AVANT d'être analysé, jamais ligne par
      // ligne : une marque ouverte sur une ligne et fermée sur la suivante —
      // « **could this only\nexist in a test.** », la dernière phrase du
      // conseil de scénario — n'a sa paire complète dans aucune des deux, et
      // ressortait en astérisques. Les puces se recollaient déjà ainsi.
      //
      // Recomposé, un retour simple n'était qu'une respiration de la source et
      // redevient une espace. Sinon il reste une intention : on assemble avec
      // un vrai saut de ligne, qu'on convertit en `<br />` une fois les marques
      // reconnues. L'italique à une seule étoile, lui, refuse toujours de
      // traverser un retour — voir `inline`.
      const BREAK = "\n";
      const assembled = reflow
        ? paragraph.map((line) => line.trim()).join(" ")
        : paragraph.join(BREAK);
      html.push(`<p>${inline(assembled).split(BREAK).join("<br />")}</p>`);
    }
  }

  return html.join("");
}

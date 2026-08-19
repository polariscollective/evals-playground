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

/** Markdown vers HTML. L'entrée est traitée comme du texte, jamais comme du HTML. */
export function renderMarkdown(source: string): string {
  const escaped = escapeHtml(source);
  const blocks = escaped.split(/\n{2,}/);
  const html: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;

    const heading = lines[0].match(/^(#{1,4})\s+(.*)$/);
    if (heading && lines.length === 1) {
      const level = heading[1].length + 1; // h1 est réservé au titre de la page
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      const items = lines
        .map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`)
        .join("");
      html.push(`<ul>${items}</ul>`);
      continue;
    }

    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      const items = lines
        .map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`)
        .join("");
      html.push(`<ol>${items}</ol>`);
      continue;
    }

    if (lines.every((l) => /^\s*&gt;\s?/.test(l))) {
      const quoted = lines.map((l) => l.replace(/^\s*&gt;\s?/, "")).join(" ");
      html.push(`<blockquote>${inline(quoted)}</blockquote>`);
      continue;
    }

    // Un simple retour à la ligne reste un retour à la ligne : dans une note
    // prise à la volée, il est presque toujours voulu.
    html.push(`<p>${lines.map(inline).join("<br />")}</p>`);
  }

  return html.join("");
}

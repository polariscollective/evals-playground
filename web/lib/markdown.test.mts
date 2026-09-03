// Le rendu des notes n'avait pas de test, et c'est par là qu'il s'est cassé :
// une balise n'était reconnue que si tout le paragraphe était de son espèce.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "./markdown.ts";

test("un titre reste un titre quand du texte le suit sans ligne vide", () => {
  // Le cas qui ratait : personne n'écrit un titre en le laissant seul.
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

test("titre, liste et paragraphe se suivent dans un même bloc", () => {
  assert.equal(
    renderMarkdown("## Sous-titre\n- a\n- b\nconclusion"),
    "<h3>Sous-titre</h3><ul><li>a</li><li>b</li></ul><p>conclusion</p>",
  );
});

test("un titre seul marche toujours, et h1 reste au titre de la page", () => {
  assert.equal(renderMarkdown("# Seul"), "<h2>Seul</h2>");
  assert.equal(renderMarkdown("#### Quatre"), "<h5>Quatre</h5>");
});

test("un retour simple reste un retour, une ligne vide sépare", () => {
  assert.equal(renderMarkdown("un\ndeux"), "<p>un<br />deux</p>");
  assert.equal(renderMarkdown("un\n\ndeux"), "<p>un</p><p>deux</p>");
});

test("une citation sur plusieurs lignes n'en fait qu'une", () => {
  assert.equal(
    renderMarkdown("> une\n> deux"),
    "<blockquote>une deux</blockquote>",
  );
});

test("le HTML d'entrée est échappé, quelle que soit la ligne où il tombe", () => {
  // La sûreté ne peut pas dépendre de la bonne volonté de l'auteur : le rendu
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

test("un lien dont le schéma exécute du code retombe sur son texte", () => {
  const html = renderMarkdown("[clique](javascript:alert(1))");
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /\[clique\]/);
});

test("les marques en début de ligne sont rendues", () => {
  assert.equal(renderMarkdown("*gras* et suite"), "<p><em>gras</em> et suite</p>");
  assert.equal(renderMarkdown("`code` au début"), "<p><code>code</code> au début</p>");
});

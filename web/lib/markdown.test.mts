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

// ---------------------------------------------------------------------------
// Le mode « recomposé », pour un document dur-wrappé.
//
// Le conseil d'écriture de scénario est stocké coupé à 78 colonnes. Rendu avec
// les retours durs ci-dessus, il gardait ses coupures : le texte s'arrêtait au
// milieu d'un cadre large, et une puce coupée en deux voyait sa suite repartir
// en paragraphe à la marge. C'est du markdown ordinaire qu'il lui faut — un
// retour simple y est une respiration de la source, pas une intention.

test("recomposé : un retour simple redevient une espace", () => {
  assert.equal(renderMarkdown("un\ndeux", { reflow: true }), "<p>un deux</p>");
});

test("recomposé : une ligne vide sépare toujours deux paragraphes", () => {
  assert.equal(
    renderMarkdown("un\n\ndeux", { reflow: true }),
    "<p>un</p><p>deux</p>",
  );
});

test("recomposé : une puce coupée en deux reste une seule puce", () => {
  // Le cas exact du document : la suite est indentée et ne porte pas de tiret.
  assert.equal(
    renderMarkdown("- une puce coupée\n  en deux", { reflow: true }),
    "<ul><li>une puce coupée en deux</li></ul>",
  );
});

test("recomposé : une ligne ordinaire non indentée ferme quand même la liste", () => {
  // Sans quoi tout le reste du document serait avalé par la première puce.
  assert.equal(
    renderMarkdown("- item\ntexte qui suit", { reflow: true }),
    "<ul><li>item</li></ul><p>texte qui suit</p>",
  );
});

test("recomposé : un titre ferme le paragraphe qui le précède", () => {
  assert.equal(
    renderMarkdown("du texte\n## Titre", { reflow: true }),
    "<p>du texte</p><h3>Titre</h3>",
  );
});

test("les notes de run gardent leurs retours durs", () => {
  // La garde qui compte : ce mode est une option, jamais le nouveau défaut.
  assert.equal(renderMarkdown("un\ndeux"), "<p>un<br />deux</p>");
  assert.equal(
    renderMarkdown("- une puce\n  suite"),
    "<ul><li>une puce</li></ul><p>  suite</p>",
  );
});

// ---------------------------------------------------------------------------
// Une marque qui enjambe un retour à la ligne.
//
// `inline` était appliqué ligne par ligne, avant que les lignes du paragraphe
// soient recollées : un `**gras**` ouvert sur une ligne et fermé sur la
// suivante n'avait sa paire complète dans aucune des deux, et ressortait en
// astérisques. C'est ce qui arrivait à la dernière phrase du conseil de
// scénario. Les puces y échappaient déjà — elles, se recollent avant.

test("une marque qui enjambe un retour est rendue, en recomposé", () => {
  assert.equal(
    renderMarkdown("It is: **could this only\nexist in a test.**", { reflow: true }),
    "<p>It is: <strong>could this only exist in a test.</strong></p>",
  );
});

test("une marque qui enjambe un retour est rendue, retours durs gardés", () => {
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

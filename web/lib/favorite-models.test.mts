// Les favoris d'une personne, sans Supabase ni session : voir favorite-models.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FAVORITE_MODELS,
  DEFAULT_RUN_MODEL,
  favoriteModels,
  favoritesProblem,
  notFavouriteProblem,
} from "./favorite-models.ts";
import { knownModelIds } from "./catalog.ts";

test("le modèle d'ouverture existe, et est un favori par défaut", () => {
  // Les deux moitiés comptent. S'il quittait le catalogue, la page de run
  // s'ouvrirait sur un identifiant que rien ne sait lancer ; s'il quittait
  // les favoris par défaut, elle s'ouvrirait sur un modèle que sa propre
  // liste n'affiche pas — la faute que le repli existe pour rattraper, mais
  // qu'on ne veut pas déclencher à chaque page vierge.
  assert.ok(knownModelIds().has(DEFAULT_RUN_MODEL));
  assert.ok(DEFAULT_FAVORITE_MODELS.includes(DEFAULT_RUN_MODEL));
});

test("le défaut ne nomme que des modèles du catalogue", () => {
  // Un défaut qui nomme un modèle disparu viderait les menus de tous ceux
  // qui n'ont jamais touché à leur liste.
  const known = knownModelIds();
  assert.deepEqual(DEFAULT_FAVORITE_MODELS.filter((id) => !known.has(id)), []);
});

test("le défaut porte dix modèles", () => {
  assert.equal(DEFAULT_FAVORITE_MODELS.length, 10);
});

test("NULL rend le défaut du code", () => {
  // Et non un tableau vide : c'est toute la convention de la colonne.
  assert.deepEqual(favoriteModels({ favorite_models: null }), [...DEFAULT_FAVORITE_MODELS]);
});

test("un profil illisible rend aussi le défaut", () => {
  // Ne pas savoir qui regarde n'est pas une raison de ne rien proposer.
  assert.deepEqual(favoriteModels(null), [...DEFAULT_FAVORITE_MODELS]);
});

test("une liste écrite rend cette liste", () => {
  assert.deepEqual(
    favoriteModels({ favorite_models: ["grok/grok-4.6"] }),
    ["grok/grok-4.6"],
  );
});

test("un favori retiré du catalogue depuis est écarté à la lecture", () => {
  // La liste est écrite à un instant ; le catalogue bouge sans elle. Servir
  // un identifiant qui n'existe plus mettrait dans un menu une entrée dont
  // le seul effet serait d'échouer au premier appel facturé.
  assert.deepEqual(
    favoriteModels({ favorite_models: ["grok/grok-4.6", "openai/gpt-disparu"] }),
    ["grok/grok-4.6"],
  );
});

test("une liste dont plus rien n'existe retombe sur le défaut", () => {
  // Pas un menu vide : l'application deviendrait inutilisable sans qu'on
  // puisse même deviner pourquoi.
  assert.deepEqual(
    favoriteModels({ favorite_models: ["openai/gpt-disparu"] }),
    [...DEFAULT_FAVORITE_MODELS],
  );
});

test("une liste valide est acceptée", () => {
  assert.equal(favoritesProblem(["anthropic/claude-opus-5", "grok/grok-4.6"]), null);
});

test("le tableau vide est refusé", () => {
  assert.notEqual(favoritesProblem([]), null);
});

test("ce qui n'est pas un tableau de chaînes est refusé", () => {
  assert.notEqual(favoritesProblem(null), null);
  assert.notEqual(favoritesProblem("anthropic/claude-opus-5"), null);
  assert.notEqual(favoritesProblem([1, 2]), null);
});

test("un identifiant hors catalogue est refusé, et nommé", () => {
  const problem = favoritesProblem(["anthropic/claude-opus-5", "openai/gpt-inconnu"]);
  assert.ok(problem?.includes("openai/gpt-inconnu"));
});

test("un doublon est refusé", () => {
  assert.notEqual(
    favoritesProblem(["grok/grok-4.6", "grok/grok-4.6"]),
    null,
  );
});

test("un favori ne pose aucun problème", () => {
  assert.equal(
    notFavouriteProblem("grok/grok-4.6", ["grok/grok-4.6"], "models.judge"),
    null,
  );
});

test("un modèle du catalogue hors favoris est refusé, en le disant", () => {
  // Le message doit distinguer les deux cas : « pas dans tes favoris » se
  // corrige depuis le profil, « n'existe pas » ne se corrige pas du tout.
  const problem = notFavouriteProblem(
    "openai/gpt-5.4",
    ["grok/grok-4.6"],
    "models.targets[0]",
  );
  assert.ok(problem?.includes("openai/gpt-5.4"));
  assert.ok(problem?.includes("models.targets[0]"));
  assert.ok(problem?.includes("favourite"));
  assert.ok(problem?.includes("profile"));
});

test("un modèle qui n'existe nulle part n'est pas l'affaire de cette fonction", () => {
  // `configProblem` l'a déjà refusé, avec son propre message. Un second
  // refus dirait « ajoute-le à tes favoris » pour un identifiant qu'aucun
  // profil ne pourra jamais contenir.
  assert.equal(
    notFavouriteProblem("openai/gpt-inconnu", ["grok/grok-4.6"], "models.judge"),
    null,
  );
});

test("une chaîne vide passe : le champ est facultatif", () => {
  assert.equal(notFavouriteProblem("", ["grok/grok-4.6"], "models.adversary"), null);
});

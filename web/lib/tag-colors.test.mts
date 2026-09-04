// La couleur d'un tag ne bouge jamais, et Tailwind ne fabrique pas de classe à
// l'exécution : ces deux règles-là sont tout ce que ce module a à tenir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TAG_COLORS, colorClasses, nextColor } from "./tag-colors.ts";

test("la palette tourne, et ne rend que des couleurs qu'elle connaît", () => {
  for (let i = 0; i < TAG_COLORS.length * 2 + 1; i += 1) {
    assert.ok(TAG_COLORS.includes(nextColor(i)));
  }
});

test("deux tags créés à la suite ne prennent pas la même couleur", () => {
  assert.notEqual(nextColor(0), nextColor(1));
});

test("la palette reprend au début une fois épuisée", () => {
  assert.equal(nextColor(TAG_COLORS.length), nextColor(0));
});

test("chaque couleur porte des classes écrites en toutes lettres", () => {
  // Une classe fabriquée à l'exécution serait purgée au build : ce test tient
  // la table littérale, pas la façon de la lire.
  for (const color of TAG_COLORS) {
    const classes = colorClasses(color);
    assert.match(classes, /bg-/);
    assert.match(classes, /text-/);
    assert.doesNotMatch(classes, /\$\{/);
  }
});

test("une couleur inconnue retombe sur une valeur neutre plutôt que sur rien", () => {
  // Une couleur écrite à la main en base ne doit pas rendre un tag invisible.
  assert.match(colorClasses("cramoisi"), /bg-/);
});

test("une couleur qui nomme une méthode du prototype retombe aussi sur le neutre", () => {
  // `CLASSES[color]` seul rendrait ici `Object.prototype.toString`, pas la
  // valeur neutre : c'est la table elle-même qui doit être consultée en tant
  // que table, jamais en tant que chaîne de prototypes.
  assert.equal(colorClasses("toString"), colorClasses("cramoisi"));
});

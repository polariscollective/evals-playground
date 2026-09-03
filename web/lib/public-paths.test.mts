// La porte et la liste doivent dire la même chose. Elles ne l'ont pas toujours
// dit, et le jour où elles ont divergé, rien ne l'a signalé.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isOpen, proxyMatcher } from "./public-paths.ts";

test("les chemins ouverts passent la porte sans session", () => {
  for (const path of [
    "/prompt",
    "/validate",
    "/shared/2f1c9e6a-0000-4000-8000-000000000000",
    "/api/auth/signin",
    "/favicon.ico",
  ]) {
    assert.equal(isOpen(path), true, path);
  }
});

test("leurs voisins de préfixe restent fermés", () => {
  // Sans ancrage, `/validatex` et `/sharedx` s'ouvriraient avec leurs voisins.
  for (const path of [
    "/",
    "/eval/abc",
    "/api/runs",
    "/validatex",
    "/sharedx",
    "/prompts-secrets",
    "/favicon.icon",
  ]) {
    assert.equal(isOpen(path), false, path);
  }
});

test("le littéral du proxy est exactement celui que la liste produit", () => {
  // Next exige que `matcher` soit une constante et ignore silencieusement toute
  // valeur calculée : le motif reste donc écrit à la main dans `proxy.ts`. Ce
  // test est ce qui empêche les deux de diverger.
  const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const literal = source.match(/matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"/);
  assert.ok(literal, "aucun motif trouvé dans proxy.ts");
  assert.equal(JSON.parse(`"${literal[1]}"`), proxyMatcher());
});

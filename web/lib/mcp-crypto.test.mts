// Le calcul, pas le stockage : `mcp-auth.ts` est `server-only` et vit hors de
// portée de `node --test`, qui ne résout pas ce spécificateur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { challengeOf, hashOf, newToken, pkceMatches, safeEqual } from "./mcp-crypto.ts";

test("newToken ne rend que du base64url, et jamais deux fois la même valeur", () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("hashOf est déterministe", () => {
  assert.equal(hashOf("un secret"), hashOf("un secret"));
});

test("hashOf distingue deux valeurs différentes", () => {
  assert.notEqual(hashOf("un secret"), hashOf("un autre"));
});

test("challengeOf reproduit le vecteur de test de la RFC 7636", () => {
  // Annexe B de la RFC : un couple verifier/challenge publié, pas fabriqué ici.
  assert.equal(
    challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("pkceMatches accepte le bon vérifieur, et rien d'autre", () => {
  const challenge = challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.equal(
    pkceMatches("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", challenge),
    true,
  );
  assert.equal(pkceMatches("un-autre-vérifieur", challenge), false);
});

test("safeEqual dit vrai pour deux chaînes égales", () => {
  assert.equal(safeEqual("même-secret", "même-secret"), true);
});

test("safeEqual dit faux pour deux chaînes différentes de même longueur", () => {
  assert.equal(safeEqual("abcdefgh", "abcdefgi"), false);
});

test("safeEqual dit faux pour deux longueurs différentes", () => {
  assert.equal(safeEqual("court", "beaucoup plus long"), false);
});

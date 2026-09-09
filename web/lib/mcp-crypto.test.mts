// The computation, not the storage: `mcp-auth.ts` is `server-only` and lives
// out of reach of `node --test`, which does not resolve that specifier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { challengeOf, hashOf, newToken, pkceMatches, safeEqual } from "./mcp-crypto.ts";

test("newToken returns only base64url, and never the same value twice", () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("hashOf is deterministic", () => {
  assert.equal(hashOf("un secret"), hashOf("un secret"));
});

test("hashOf tells two different values apart", () => {
  assert.notEqual(hashOf("a secret"), hashOf("another"));
});

test("challengeOf reproduces RFC 7636's test vector", () => {
  // Appendix B of the RFC: a published verifier/challenge pair, not made here.
  assert.equal(
    challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("pkceMatches accepts the right verifier, and nothing else", () => {
  const challenge = challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.equal(
    pkceMatches("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", challenge),
    true,
  );
  assert.equal(pkceMatches("another-verifier", challenge), false);
});

test("safeEqual says true for two equal strings", () => {
  assert.equal(safeEqual("same-secret", "same-secret"), true);
});

test("safeEqual says false for two different strings of equal length", () => {
  assert.equal(safeEqual("abcdefgh", "abcdefgi"), false);
});

test("safeEqual says false for two different lengths", () => {
  assert.equal(safeEqual("short", "a great deal longer"), false);
});

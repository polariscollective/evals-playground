// The door and the list must say the same thing. They have not always said it,
// and the day they diverged, nothing reported it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isOpen, proxyMatcher } from "./public-paths.ts";

test("les chemins ouverts passent la porte sans session", () => {
  for (const path of [
    "/prompt",
    "/validate",
    "/scenario-advice",
    "/shared/2f1c9e6a-0000-4000-8000-000000000000",
    // The writing advice, readable with no account. Being static it wins over
    // `/shared/[runId]` — and `isRunId` would refuse "scenarios" anyway.
    "/shared/scenarios",
    "/api/auth/signin",
    "/favicon.ico",
    "/icon.svg",
    "/_next/static/chunks/main.js",
    // Without the query string: `isOpen` takes a `pathname`, like the
    // `matcher` de Next — la query n'en fait jamais partie.
    "/_next/image",
    "/mcp",
    "/mcp/authorize",
    "/mcp/token",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
  ]) {
    assert.equal(isOpen(path), true, path);
  }
});

test("their prefix neighbours stay closed", () => {
  // Sans ancrage, `/validatex` et `/sharedx` s'ouvriraient avec leurs voisins.
  for (const path of [
    "/",
    "/eval/abc",
    "/api/runs",
    "/validatex",
    "/sharedx",
    "/prompts-secrets",
    "/scenario-advicex",
    // The private page a human reads stays closed: only the dedicated route,
    // which returns the default, is public.
    "/scenarios",
    "/favicon.icon",
    "/icon.svgx",
    "/mcpx",
    "/mcp-secrets",
  ]) {
    assert.equal(isOpen(path), false, path);
  }
});

test("the proxy's literal is exactly the one the list produces", () => {
  // Next exige que `matcher` soit une constante et ignore silencieusement toute
  // computed value: the pattern therefore stays hand-written in `proxy.ts`.
  // This test is what stops the two diverging.
  const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const literal = source.match(/matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"/);
  assert.ok(literal, "no pattern found in proxy.ts");
  assert.equal(JSON.parse(`"${literal[1]}"`), proxyMatcher());
});

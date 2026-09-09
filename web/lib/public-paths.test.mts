// The door and the list must say the same thing. They have not always said it,
// and the day they diverged, nothing reported it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isOpen, proxyMatcher } from "./public-paths.ts";

test("the open paths go through the door with no session", () => {
  for (const path of [
    "/format.txt",
    "/validate",
    "/advice.txt",
    "/shared/2f1c9e6a-0000-4000-8000-000000000000",
    // The writing advice, readable with no account. Being static it wins over
    // `/shared/[runId]` — and `isRunId` would refuse "scenarios" anyway.
    "/shared/scenarios",
    "/api/auth/signin",
    // The page that asks. Without this the door would send visitors to a
    // page the door itself refuses, once per redirect, forever.
    "/signin",
    "/favicon.ico",
    "/icon.svg",
    "/_next/static/chunks/main.js",
    // Without the query string: `isOpen` takes a `pathname`, like Next's
    // `matcher` — the query is never part of it.
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
  // With no anchor, `/validatex` and `/sharedx` would open along with their neighbours.
  for (const path of [
    "/",
    "/eval/abc",
    "/api/runs",
    "/validatex",
    "/sharedx",
    "/prompts-secrets",
    "/advice.txtx",
    "/advice",
    // The private page a human reads stays closed: only the dedicated route,
    // which returns the default, is public.
    "/scenarios",
    "/favicon.icon",
    "/icon.svgx",
    "/mcpx",
    "/mcp-secrets",
    "/signinx",
  ]) {
    assert.equal(isOpen(path), false, path);
  }
});

test("the proxy's literal is exactly the one the list produces", () => {
  // Next demands that `matcher` be a constant and silently ignores any
  // computed value: the pattern therefore stays hand-written in `proxy.ts`.
  // This test is what stops the two diverging.
  const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const literal = source.match(/matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"/);
  assert.ok(literal, "no pattern found in proxy.ts");
  assert.equal(JSON.parse(`"${literal[1]}"`), proxyMatcher());
});

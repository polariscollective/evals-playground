// The door repeats nothing the fallback already says: `?callbackUrl=%2F` is
// the default written out longhand, on the URL a visitor without a session
// sees most often.
import { test } from "node:test";
import assert from "node:assert/strict";
import { callbackFor } from "./signin-callback.ts";

test("the home page carries nothing — `login` already falls back to it", () => {
  assert.equal(callbackFor("/", ""), null);
});

test("any other path is worth carrying", () => {
  assert.equal(callbackFor("/runs", ""), "/runs");
  assert.equal(callbackFor("/eval/2f1c9e6a", ""), "/eval/2f1c9e6a");
});

test("the query string travels with the path", () => {
  assert.equal(callbackFor("/runs", "?tag=live"), "/runs?tag=live");
});

test("a query string alone makes the home page worth carrying", () => {
  assert.equal(callbackFor("/", "?tab=drafts"), "/?tab=drafts");
});

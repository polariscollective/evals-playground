// Telling a refused address from a broken deployment is the whole point of
// this function: one is the visitor's problem, the other is ours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signInMessage } from "./signin-error.ts";

test("no error means no sentence", () => {
  assert.equal(signInMessage(undefined), null);
  assert.equal(signInMessage(""), null);
});

test("a refused address is not a missing variable", () => {
  const denied = signInMessage("AccessDenied");
  const misconfigured = signInMessage("Configuration");
  assert.notEqual(denied, misconfigured);
  assert.equal(denied, "That address does not open the application.");
  assert.equal(misconfigured, "Sign-in is not configured on this deployment.");
});

test("anything else falls back to one generic sentence", () => {
  for (const reason of ["OAuthCallbackError", "Verification", "wat"]) {
    assert.equal(
      signInMessage(reason),
      "Something went wrong signing in. Try again.",
      reason,
    );
  }
});

test("a query key repeated twice reads as its first value", () => {
  assert.equal(
    signInMessage(["AccessDenied", "Configuration"]),
    signInMessage("AccessDenied"),
  );
});

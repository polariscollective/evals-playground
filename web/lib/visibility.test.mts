// Who may sign in, as what, and what a visitor sees of a run's shared page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accessOf, sharedView, visibilityOf } from "./visibility.ts";

const ENV = {
  ALLOWED_EMAILS: "sam@polariscollective.org",
  ALLOWED_DOMAINS: "polariscollective.org",
  ALLOWED_RESTRICTED_EMAILS: "reviewer@lab.example, Other@Example.org",
  ALLOWED_RESTRICTED_DOMAINS: "partner.example",
};

test("a member is anyone on the members' lists", () => {
  assert.equal(accessOf("sam@polariscollective.org", ENV), "member");
  assert.equal(accessOf("gabriel@polariscollective.org", ENV), "member");
});

test("the restricted lists sign people in as restricted, case aside", () => {
  assert.equal(accessOf("reviewer@lab.example", ENV), "restricted");
  assert.equal(accessOf("other@example.org", ENV), "restricted");
  assert.equal(accessOf("anyone@partner.example", ENV), "restricted");
});

test("on both lists, member wins", () => {
  assert.equal(accessOf("sam@polariscollective.org", { ...ENV, ALLOWED_RESTRICTED_EMAILS: "sam@polariscollective.org" }), "member");
});

test("anyone else may not sign in", () => {
  assert.equal(accessOf("stranger@gmail.com", ENV), null);
  assert.equal(accessOf("", ENV), null);
  assert.equal(accessOf(null, ENV), null);
});

test("a public run is shown to anyone", () => {
  for (const access of [null, "restricted", "member"] as const) {
    assert.equal(sharedView("public", access), "show");
  }
});

test("a restricted run is shown to the signed-in lists, and asks the others to sign in", () => {
  assert.equal(sharedView("restricted", "member"), "show");
  assert.equal(sharedView("restricted", "restricted"), "show");
  assert.equal(sharedView("restricted", null), "restricted");
});

test("a private run's shared address is not found, whoever asks", () => {
  for (const access of [null, "restricted", "member"] as const) {
    assert.equal(sharedView("private", access), "not_found");
  }
});

test("a row read before the visibility column falls back on is_public", () => {
  assert.equal(visibilityOf({ visibility: "restricted", is_public: false }), "restricted");
  assert.equal(visibilityOf({ is_public: true }), "public");
  assert.equal(visibilityOf({ is_public: false }), "private");
  assert.equal(visibilityOf({ visibility: null, is_public: null }), "private");
});

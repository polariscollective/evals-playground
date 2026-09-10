// A judge's name and its handle.
//
// The rules that trap here are the ones the migration got wrong on its first
// run: trimming hyphens before the cut rather than after, and letting two
// judges created in the same breath claim the same name.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freeName,
  freeSlug,
  labelFrom,
  nameJudge,
  slugify,
} from "./judge-name.ts";

test("a handle is lowercase, folded, and hyphenated", () => {
  assert.equal(
    slugify("L'assistant maintient-il la règle qu'on lui a donnée ?"),
    "l-assistant-maintient-il-la-regle-qu-on-lui-a-donnee",
  );
});

test("the cut never leaves a trailing hyphen", () => {
  // The defect the local replay of the migration caught. Sixty characters lands
  // mid-word about half the time, and `judges_slug_shape_check` refuses a
  // handle that ends on a hyphen.
  for (let length = 40; length < 90; length += 1) {
    const slug = slugify("a".repeat(3) + " word".repeat(length));
    assert.doesNotMatch(slug, /^-|-$/, `at length ${length}: ${slug}`);
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});

test("a label made only of punctuation still yields a handle", () => {
  assert.equal(slugify("??? !!!"), "judge");
  assert.equal(slugify(""), "judge");
});

test("a system judge is named by its type, never by a criterion", () => {
  assert.equal(labelFrom(null, "awake"), "Eval awareness");
  assert.equal(labelFrom("ignored", "faithful_adversary"), "Adversary fidelity");
});

test("an ordinary judge is named by its criterion, flattened", () => {
  assert.equal(
    labelFrom("  Did the assistant\n  answer?  ", "ordinary"),
    "Did the assistant answer?",
  );
});

test("a judge with no criterion at all still gets a name", () => {
  assert.equal(labelFrom("", "ordinary"), "Untitled judge");
  assert.equal(labelFrom(null, "ordinary"), "Untitled judge");
});

test("a long criterion is cut, and the cut does not leave whitespace", () => {
  const label = labelFrom("word ".repeat(40), "ordinary");
  assert.ok(label.length <= 70);
  assert.equal(label, label.trim());
});

test("the bare name goes to whoever asks first", () => {
  assert.equal(freeName("Eval awareness", []), "Eval awareness");
  assert.equal(freeName("Eval awareness", ["Eval awareness"]), "Eval awareness (2)");
  assert.equal(
    freeName("Eval awareness", ["Eval awareness", "Eval awareness (2)"]),
    "Eval awareness (3)",
  );
});

test("a handle numbers with a hyphen, not a parenthesis", () => {
  assert.equal(freeSlug("eval-awareness", ["eval-awareness"]), "eval-awareness-2");
});

test("two judges named in the same call do not collide", () => {
  // A run launched with the principal and a secondary that share a criterion.
  // Each name handed out has to be taken from the next one's point of view, or
  // the insert is refused by `judges_label_key` after the form has been filled.
  const taken = { labels: new Set<string>(), slugs: new Set<string>() };
  const first = nameJudge(null, "Did it hold?", "ordinary", taken);
  const second = nameJudge(null, "Did it hold?", "ordinary", taken);
  assert.equal(first.label, "Did it hold?");
  assert.equal(second.label, "Did it hold? (2)");
  assert.notEqual(first.slug, second.slug);
});

test("a name written by hand wins over the derived one", () => {
  const taken = { labels: new Set<string>(), slugs: new Set<string>() };
  const named = nameJudge("Antidating, honesty", "Did it hold?", "ordinary", taken);
  assert.equal(named.label, "Antidating, honesty");
  assert.equal(named.slug, "antidating-honesty");
});

test("a name written by hand still has to be free", () => {
  const taken = { labels: new Set(["Honesty"]), slugs: new Set(["honesty"]) };
  const named = nameJudge("Honesty", null, "ordinary", taken);
  assert.equal(named.label, "Honesty (2)");
  assert.equal(named.slug, "honesty-2");
});

test("a blank hand-written name falls back rather than being kept", () => {
  const taken = { labels: new Set<string>(), slugs: new Set<string>() };
  assert.equal(nameJudge("   ", "Did it hold?", "ordinary", taken).label, "Did it hold?");
});

// A tag's colour never moves, and Tailwind does not make classes at runtime:
// those two rules are all this module has to hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TAG_COLORS, colorClasses, nextColor } from "./tag-colors.ts";

test("the palette rotates, and returns only colours it knows", () => {
  for (let i = 0; i < TAG_COLORS.length * 2 + 1; i += 1) {
    assert.ok(TAG_COLORS.includes(nextColor(i)));
  }
});

test("two tags created in a row do not take the same colour", () => {
  assert.notEqual(nextColor(0), nextColor(1));
});

test("the palette starts over once exhausted", () => {
  assert.equal(nextColor(TAG_COLORS.length), nextColor(0));
});

test("every colour carries classes written out in full", () => {
  // A class made at runtime would be purged at build time: this test holds the
  // literal table, not the way it is read.
  for (const color of TAG_COLORS) {
    const classes = colorClasses(color);
    assert.match(classes, /bg-/);
    assert.match(classes, /text-/);
    assert.doesNotMatch(classes, /\$\{/);
  }
});

test("an unknown colour falls back on a neutral value rather than nothing", () => {
  // A colour hand-written in the database must not make a tag invisible.
  assert.match(colorClasses("crimson"), /bg-/);
});

test("a colour naming a prototype method also falls back on the neutral one", () => {
  // `CLASSES[color]` alone would return `Object.prototype.toString` here, not the
  // neutral value: the table itself must be consulted as a table, never as a
  // prototype chain.
  assert.equal(colorClasses("toString"), colorClasses("crimson"));
});

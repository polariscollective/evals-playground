// Reading every row past PostgREST's cap, page after page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allPages } from "./pages.ts";

function table(rows: number) {
  const asked: [number, number][] = [];
  const fetchPage = async (offset: number, limit: number) => {
    asked.push([offset, limit]);
    return Array.from({ length: Math.max(0, Math.min(limit, rows - offset)) }, (_, i) => offset + i);
  };
  return { asked, fetchPage };
}

test("a table under the cap is read in one request", async () => {
  const { asked, fetchPage } = table(486);
  assert.equal((await allPages(fetchPage, 1000)).length, 486);
  assert.deepEqual(asked, [[0, 1000]]);
});

test("a table over the cap is read whole, page after page", async () => {
  // 3 judges x 486 conversations: the third judge's grades were cut off.
  const { asked, fetchPage } = table(1458);
  const rows = await allPages(fetchPage, 1000);
  assert.equal(rows.length, 1458);
  assert.deepEqual(rows.slice(998, 1002), [998, 999, 1000, 1001]);
  assert.deepEqual(asked, [[0, 1000], [1000, 1000]]);
});

test("a table of exactly one page asks once more and stops on the empty page", async () => {
  const { asked, fetchPage } = table(1000);
  assert.equal((await allPages(fetchPage, 1000)).length, 1000);
  assert.deepEqual(asked, [[0, 1000], [1000, 1000]]);
});

// The MCP page lists the tools by hand. This is what stops that list going
// stale.
//
// It reads `app/mcp/route.ts` as text and collects every name handed to
// `registerTool`. A comment asking the next person to remember would be
// forgotten; a failing test is not.
//
// What it does NOT hold: what each tool takes and returns, which is prose in the
// catalogue. Renaming an argument passes here. The box at the top of
// `mcp-catalogue.ts` says so rather than letting a green suite imply otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_INSTRUCTIONS, MCP_TOOLS } from "./mcp-catalogue.ts";

const ROUTE = readFileSync(
  new URL("../app/mcp/route.ts", import.meta.url),
  "utf8",
);

/** Every name passed to `registerTool`, in the order they are registered. */
function registered(): string[] {
  return [...ROUTE.matchAll(/\n {2}server\.registerTool\(\n {4}"([a-z_]+)"/g)].map(
    (match) => match[1],
  );
}

test("the source really registers tools, so this test can fail", () => {
  // If the regex ever stops matching — a formatter reflows those calls, say —
  // every assertion below would pass against an empty set and say nothing.
  assert.ok(registered().length >= 10, `found ${registered().length} registrations`);
});

test("the catalogue lists exactly the tools the server registers", () => {
  const onServer = new Set(registered());
  const onPage = new Set(MCP_TOOLS.map((tool) => tool.name));

  const missing = [...onServer].filter((name) => !onPage.has(name));
  const extra = [...onPage].filter((name) => !onServer.has(name));

  assert.deepEqual(
    missing,
    [],
    `registered but absent from lib/mcp-catalogue.ts: ${missing.join(", ")}`,
  );
  assert.deepEqual(
    extra,
    [],
    `listed in lib/mcp-catalogue.ts but no longer registered: ${extra.join(", ")}`,
  );
});

test("no tool is listed twice", () => {
  const names = MCP_TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
});

// The page says "every one of them is free except launch_draft". That sentence
// is only true while exactly one entry is marked, and the marking is what draws
// the badge next to the name.
test("exactly one tool is marked as spending money, and it is launch_draft", () => {
  const spending = MCP_TOOLS.filter((tool) => tool.spends).map((t) => t.name);
  assert.deepEqual(spending, ["launch_draft"]);
});

test("every entry says what it does, what it takes and what it returns", () => {
  for (const tool of MCP_TOOLS) {
    assert.ok(tool.summary.trim().length > 0, `${tool.name}: no summary`);
    assert.ok(tool.output.trim().length > 0, `${tool.name}: no output`);
    assert.ok(Array.isArray(tool.input), `${tool.name}: input is not a list`);
  }
});

// The page shows this string as "exactly what the server sends". It can only say
// that while the route uses the constant rather than a copy of it.
test("the route sends the instructions this module holds", () => {
  assert.match(ROUTE, /instructions: MCP_INSTRUCTIONS,/);
  assert.ok(MCP_INSTRUCTIONS.includes("read_format"));
  assert.ok(MCP_INSTRUCTIONS.includes("`launch_draft` spends real money"));
});

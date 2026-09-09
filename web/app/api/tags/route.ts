import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { createTag, loadTags } from "@/lib/tags";
import { isReservedTag } from "@/lib/run-filters";

export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;
  return NextResponse.json(await loadTags());
}

/** Creates a tag, or returns the one that already exists under that label. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as { label?: unknown } | null;
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 422 });
  }
  // `createTag` already refuses the reserved labels — that is where the rule
  // lives, because the MCP tool creates tags without coming through here. The
  // check is repeated so that THIS door answers 422 with a readable message
  // rather than letting an exception come back out as a 500.
  if (isReservedTag(label)) {
    return NextResponse.json(
      {
        error:
          `"${label}" is reserved — the runs list uses it to filter on how a ` +
          `run was launched or where it ran.`,
      },
      { status: 422 },
    );
  }
  return NextResponse.json(await createTag(label), { status: 201 });
}

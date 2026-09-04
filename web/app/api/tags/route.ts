import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { createTag, loadTags } from "@/lib/tags";

export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;
  return NextResponse.json(await loadTags());
}

/** Crée un tag, ou rend celui qui existe déjà sous ce libellé. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as { label?: unknown } | null;
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 422 });
  }
  return NextResponse.json(await createTag(label), { status: 201 });
}

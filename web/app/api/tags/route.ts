import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { createTag, loadTags } from "@/lib/tags";
import { isReservedTag } from "@/lib/run-filters";

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
  // `createTag` refuse déjà les libellés réservés — c'est là que vit la règle,
  // parce que l'outil MCP crée des tags sans passer ici. Le contrôle est
  // répété pour que CETTE porte réponde 422 avec un message lisible plutôt que
  // de laisser une exception ressortir en 500.
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

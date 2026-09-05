import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { createExtendDraft } from "@/lib/drafts";
import { NotFound, loadRun } from "@/lib/runs";
import type { ExtendRequest } from "@/lib/types";

/** Mettre de côté une extension composée à la main, sans l'appliquer au run —
 *  le même geste que « Save as draft » sur le formulaire de composition,
 *  pour agrandir un run existant plutôt qu'en lancer un nouveau.
 *
 * Aucune validation, comme pour un brouillon de run : c'est précisément
 * quand la proposition est incomplète qu'on veut la poser pour y revenir.
 * `submit_draft_extension` valide avant de déposer, lui, parce qu'un agent
 * doit rendre une proposition lançable — ce n'est pas le cas ici. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as {
    config?: unknown;
  } | null;
  if (!body || typeof body.config !== "object" || body.config === null) {
    return NextResponse.json({ error: "config must be an object" }, { status: 422 });
  }

  try {
    await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  const id = await createExtendDraft(
    runId,
    body.config as ExtendRequest,
    user.email,
    "manual",
  );
  return NextResponse.json({ id }, { status: 201 });
}

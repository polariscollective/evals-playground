import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { listGrants, revokeGrant } from "@/lib/mcp-auth";

export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;
  return NextResponse.json(await listGrants(user.email));
}

/** Révoque une connexion. Le propriétaire vient de la session, jamais du
 *  corps : sans quoi n'importe quel email connecté pourrait couper celle
 *  d'un autre en devinant son empreinte. */
export async function DELETE(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as {
    access_token_hash?: string;
  } | null;
  if (!body?.access_token_hash) {
    return NextResponse.json({ error: "access_token_hash is required" }, { status: 422 });
  }
  await revokeGrant(body.access_token_hash, user.email);
  return NextResponse.json({ ok: true });
}

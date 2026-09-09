import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { listGrants, revokeAllGrants, revokeGrant } from "@/lib/mcp-auth";

export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;
  return NextResponse.json(await listGrants(user.email));
}

/** Revokes a connection. The owner comes from the session, never from the body:
 *  without which any signed-in email could cut somebody else's by guessing its
 *  fingerprint. */
export async function DELETE(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as {
    access_token_hash?: string;
    all?: boolean;
  } | null;

    // Cut everything off in one gesture. The email comes from the session as for
    // a single revocation: "all" never means everybody's.
  if (body?.all) {
    return NextResponse.json({ ok: true, revoked: await revokeAllGrants(user.email) });
  }

  if (!body?.access_token_hash) {
    return NextResponse.json({ error: "access_token_hash is required" }, { status: 422 });
  }
  const revoked = await revokeGrant(body.access_token_hash, user.email);
  if (!revoked) {
    return NextResponse.json(
      { error: "No matching connection — it may already have been revoked." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}

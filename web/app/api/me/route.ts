import { NextResponse } from "next/server";
import { requireUser } from "@/auth";

/** Who is looking.
 *
 * The browser never knew it: nothing demanded it as long as everybody saw
 * everything without distinction. Filtering "mine" asks for an address to be
 * compared to those the runs and the drafts already carry — hence this route,
 * and nothing more than it. */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  return NextResponse.json({ email: user.email });
}

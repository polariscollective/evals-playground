import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { tagsByDraft, tagsByRun } from "@/lib/tags";

/** The tags of every run and every draft, in a single round trip.
 *
 * The runs list shows one pill per tag on each of its rows — sometimes dozens —
 * and one call per row would be absurd where `tagsByRun`/`tagsByDraft` already
 * bring everything back in one read. A `Map` does not survive JSON: it is
 * returned as a plain object. */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const [runs, drafts] = await Promise.all([tagsByRun(), tagsByDraft()]);
  return NextResponse.json({
    runs: Object.fromEntries(runs),
    drafts: Object.fromEntries(drafts),
  });
}

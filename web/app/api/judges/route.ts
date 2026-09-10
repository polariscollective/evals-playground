import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { loadJudges } from "@/lib/judges";

/** The library, for the cache the bar warms while you read another page.
 *
 * The page used to load this itself, as a server component. It reads four
 * tables, and doing it on every visit to the tab made a list that barely moves
 * feel like a page that fetches. Behind a route it joins the four other caches
 * the bar preloads — see `ensureJudgesLoaded` (`lib/judges-store.ts`). */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;
  return NextResponse.json(await loadJudges());
}

import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { createDraft, loadDrafts } from "@/lib/drafts";
import type { EvalRunConfig } from "@/lib/types";

/** The waiting drafts, whoever they belong to.
 *
 * A draft is a proposal made to the team: filtering it by author would hide from
 * whoever can launch it what an agent has just submitted to them.
 *
 * `?launched=1` reopens the list to those that have already served: they keep
 * their address, and relaunching the same thing is expected. Outside the default
 * list, which is that of what is waiting. */
export async function GET(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const withLaunched = new URL(request.url).searchParams.get("launched") === "1";
  return NextResponse.json(await loadDrafts({ withLaunched }));
}

/** Saving the form as it stands, valid or not.
 *
 * No validation, and that is the point: `submit_draft_run` imposes one because
 * an agent must return something launchable, but a human who stops halfway notes
 * where they are. Demanding a complete configuration for the right to set it
 * aside would make the gesture useless — it is precisely when pieces are missing
 * that one wants to come back to it.
 *
 * What protects against the risk: nothing launches a draft on its own. The
 * launch goes back through the form, which refuses what does not stand up. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as {
    config?: unknown;
    csv_text?: unknown;
  } | null;
  if (!body || typeof body.config !== "object" || body.config === null) {
    return NextResponse.json({ error: "config must be an object" }, { status: 422 });
  }

  // The only thing demanded of a manual draft. All the rest is allowed to be
  // missing — that is its reason for being — but with no name, the waiting list
  // shows nothing but "Untitled run"s one can no longer tell apart, and the draft
  // becomes unusable for the very person who wrote it.
  const label = (body.config as EvalRunConfig).label;
  if (typeof label !== "string" || label.trim() === "") {
    return NextResponse.json(
      { error: "a draft needs a name — everything else can wait" },
      { status: 422 },
    );
  }

  const csvText = typeof body.csv_text === "string" ? body.csv_text : null;
  const id = await createDraft(
    body.config as EvalRunConfig,
    csvText,
    user.email,
    "manual",
  );
  return NextResponse.json({ id }, { status: 201 });
}

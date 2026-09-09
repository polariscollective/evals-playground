// A run submitted by an agent, not launched yet.
//
// This address is the one the MCP tool returns to the agent, so it must go on
// answering — but it no longer shows a separate screen. A draft is nothing but a
// run one has not launched yet: what one wants to do with it is reread it,
// correct it, then launch it, which the evaluation form already does. A
// read-only page doubled that interface less well, and forced launching without
// being able to touch anything.
//
// Existence is checked here rather than after the redirect: an unknown draft
// must return 404 on this address, not open an empty form with an error
// message.
import { notFound, redirect } from "next/navigation";
import { DraftNotFound, loadDraft } from "@/lib/drafts";

export default async function DraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;

  try {
    await loadDraft(draftId);
  } catch (error) {
    if (error instanceof DraftNotFound) notFound();
    throw error;
  }

  redirect(`/?draft=${draftId}`);
}

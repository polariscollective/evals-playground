// A published run, for whoever has the address.
//
// This file only loads: it validates the address's shape, refuses a run that is
// not published, and hands over to `SharedRunView`, which renders exactly what
// the private page renders — an openable matrix, the scenarios, the
// trajectories. Public reading never had a reason to be poorer than private.
//
// What holds it: `loadPublicRun` refuses an unpublished run and removes the
// address of whoever launched it, `requireUser()` guards every route that
// writes, and the `PublicRunDetail` type forbids the compiler from showing the
// author. The proxy, for its part, only routes — it proves nothing.
import { notFound } from "next/navigation";
import { NotFound, loadPublicRun } from "@/lib/runs";
import { isRunId } from "@/lib/run-id";
import { SharedRunView } from "@/components/SharedRunView";

export default async function SharedRun({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  if (!isRunId(runId)) notFound();

  // The load alone inside the `try`: `notFound()` raises to tell Next to render
  // the 404 page, and building the JSX here would have that signal caught by the
  // `catch`.
  let detail;
  try {
    // The trajectories in one go: the detail window reads them from what is
    // already loaded, for want of a public route to query on click.
    // `withJudges: true` goes with it, for the same weight reason they share —
    // see `attachJudges`, `lib/runs.ts`.
    detail = await loadPublicRun(runId, { withTranscripts: true, withJudges: true });
  } catch (error) {
    if (error instanceof NotFound) notFound();
    throw error;
  }

  return <SharedRunView detail={detail} />;
}

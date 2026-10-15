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
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionAccess } from "@/auth";
import { NotFound, RunRestricted, loadPublicRun } from "@/lib/runs";
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
  // Who is looking decides what a restricted run shows: the run to a signed-in
  // member or restricted reader, a page asking to sign in to anyone else.
  const access = await getSessionAccess();
  let detail;
  try {
    // The trajectories in one go: the detail window reads them from what is
    // already loaded, for want of a public route to query on click.
    // `withJudges: true` goes with it, for the same weight reason they share —
    // see `attachJudges`, `lib/runs.ts`.
    detail = await loadPublicRun(runId, { withTranscripts: true, withJudges: true }, access);
  } catch (error) {
    if (error instanceof NotFound) notFound();
    if (error instanceof RunRestricted) return <RestrictedRun runId={runId} />;
    throw error;
  }

  // Read here rather than in the view: this is a server component, the view
  // is not, and a session is not something a browser should be asked to work
  // out for itself. It only decides one word — see `OpenInApp`.
  // "Open in the app" is for members only: a restricted reader may not.
  const signedIn = access === "member";

  return (
    <SharedRunView detail={detail} signedIn={signedIn} appLink={access !== "restricted"} />
  );
}

/** A restricted run, for a visitor who is not signed in: what it is, how to
 *  get in, and whom to ask. Names nothing of the run itself. */
function RestrictedRun({ runId }: { runId: string }) {
  const signin = `/signin?callbackUrl=${encodeURIComponent(`/shared/${runId}`)}`;
  return (
    <main className="mx-auto max-w-[66ch] space-y-4 p-8">
      <h1 className="font-display text-2xl font-semibold text-olive">This run is restricted</h1>
      <p>
        It can be read by signed-in members of Polaris Collective and the people
        they have given access to.
      </p>
      <p>
        <Link href={signin} className="link-underline">
          Sign in
        </Link>{" "}
        to read it, or ask{" "}
        <a href="mailto:sam@polariscollective.org" className="link-underline">
          sam@polariscollective.org
        </a>{" "}
        for access.
      </p>
    </main>
  );
}

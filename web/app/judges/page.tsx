// The judges, read as a library rather than through the runs that use them.
//
// A server component: the list is a database read and the documents it renders
// are constants of the code, so there is nothing for the browser to wait for.
// The filtering that follows is state, and lives in the client component.
//
// Read only, deliberately, for now. Creating a judge happens where a judge is
// needed, on the run being composed. This page exists first to answer "what do
// I already have", a question that had no answer at all before judges stopped
// being a per-run artefact.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { JudgeLibrary } from "@/components/JudgeLibrary";
import { loadJudges } from "@/lib/judges";

export const metadata: Metadata = {
  title: "Judges — Evals Playground",
};

export default async function JudgesPage() {
  // The proxy already turns an anonymous visitor away; this is the real check,
  // on the Node side with a session actually validated — the same pairing every
  // other private page uses.
  const user = await requireUser();
  if ("response" in user) redirect("/signin?callbackUrl=%2Fjudges");

  const judges = await loadJudges();
  return <JudgeLibrary judges={judges} />;
}

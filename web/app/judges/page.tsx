"use client";

// The judges, read as a library rather than through the runs that use them.
//
// A client page reading a cache, like "Runs" and "Advice": the bar warms it
// while you are on another tab, so this one opens on what is already there.
// It was a server component at first, which meant four table reads on every
// visit to a list that barely moves.
//
// Read only, deliberately, for now. Creating a judge happens where a judge is
// needed, on the run being composed. This page exists first to answer "what do
// I already have", a question that had no answer at all before judges stopped
// being a per-run artefact.
import { JudgeLibrary } from "@/components/JudgeLibrary";
import { Loading } from "@/components/Loading";
import { useJudges } from "@/lib/judges-store";

export default function JudgesPage() {
  const { data, error } = useJudges();

  if (error) {
    return (
      <main className="mx-auto max-w-6xl p-8">
        <p className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      </main>
    );
  }
  // Only while nothing has arrived yet. A refresh behind an already-loaded list
  // must not blank the page under the reader.
  if (!data) return <Loading />;

  return <JudgeLibrary judges={data} />;
}

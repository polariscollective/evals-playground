"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getEvalRuns } from "@/lib/api";
import type { EvalRunRecord, Tally } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  pending: "queued",
  running: "running",
  done: "done",
  error: "failed",
  cancelled: "cancelled",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-zinc-100 text-zinc-700",
  running: "bg-teal-100 text-teal-900",
  done: "bg-zinc-900 text-white",
  error: "bg-red-100 text-red-800",
  cancelled: "bg-amber-100 text-amber-900",
};

/** Part des conversations où le modèle a cédé, tous scénarios et modèles
    confondus, ou null si rien n'a pu être jugé. La distinction compte : rien
    de jugé n'est pas la même chose qu'un run sans échec. */
function overallRate(record: EvalRunRecord): number | null {
  let met = 0;
  let judged = 0;
  for (const row of record.tallies) {
    for (const tally of Object.values(row) as Tally[]) {
      met += tally.met;
      judged += tally.met + tally.not_met + tally.borderline;
    }
  }
  return judged === 0 ? null : met / judged;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default function RunsPage() {
  const [runs, setRuns] = useState<EvalRunRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await getEvalRuns());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Tant qu'un run tourne, la liste se rafraîchit : c'est le seul endroit d'où
  // l'on peut suivre plusieurs runs à la fois.
  useEffect(() => {
    if (!runs?.some((r) => r.status === "running" || r.status === "pending"))
      return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [runs, load]);

  if (error) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <p
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-red-800"
        >
          {error}
        </p>
      </main>
    );
  }

  if (!runs) return <main className="mx-auto max-w-4xl p-8">Loading…</main>;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Every evaluation run, most recent first. Open one to see its matrix.
        </p>
      </header>

      {runs.length === 0 ? (
        <p className="rounded border border-zinc-300 p-4 text-sm text-zinc-600">
          No run yet.{" "}
          <Link href="/" className="text-teal-700 underline">
            Launch one
          </Link>
          .
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-left">
              <th className="py-2 font-medium">Run</th>
              <th className="py-2 font-medium">Shape</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Gave in</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const rate = overallRate(run);
              const running =
                run.status === "running" || run.status === "pending";
              return (
                <tr key={run.run_id} className="border-b border-zinc-200">
                  <td className="py-2">
                    <Link
                      href={`/eval/${run.run_id}`}
                      className="font-medium underline"
                    >
                      {run.label ?? run.config.scenarios[0]?.title ?? run.run_id}
                    </Link>
                    <div className="text-xs text-zinc-500">
                      {formatDate(run.created_at)} ·{" "}
                      <span className="font-mono">{run.run_id}</span>
                    </div>
                  </td>
                  <td className="py-2 text-zinc-700">
                    {run.config.scenarios.length} ×{" "}
                    {run.config.models.targets.length} ×{" "}
                    {run.config.repetitions}
                    <div className="text-xs text-zinc-500">
                      scenarios × models × reps
                    </div>
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[run.status] ?? ""}`}
                    >
                      {STATUS_LABEL[run.status] ?? run.status}
                    </span>
                    {running && (
                      <div className="text-xs text-zinc-500">
                        {run.progress.completed} / {run.progress.total}
                      </div>
                    )}
                  </td>
                  <td className="py-2">
                    {rate === null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <span className="font-medium">
                        {Math.round(rate * 100)}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}

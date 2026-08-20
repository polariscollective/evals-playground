"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getRuns } from "@/lib/api";
import { keepIfUnchanged } from "@/lib/unchanged";
import { formatMean, formatValue, rubricBounds } from "@/lib/rubric";
import type { RunSummary } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  triggered: "starting",
  running: "running",
  done: "done",
  error: "failed",
  cancelled: "cancelled",
};

const STATUS_STYLE: Record<string, string> = {
  triggered: "bg-zinc-100 text-zinc-700",
  running: "bg-teal-100 text-teal-900",
  done: "bg-zinc-900 text-white",
  error: "bg-red-100 text-red-800",
  cancelled: "bg-amber-100 text-amber-900",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}


/** Copie un texte dans le presse-papier et le confirme brièvement.

    `navigator.clipboard` n'existe pas hors contexte sécurisé — sur un accès
    autre que localhost, par exemple. On retombe alors sur une sélection
    manuelle plutôt que d'échouer en silence. */
function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy the run id:", value);
    }
  };

  return (
    <button
      onClick={copy}
      title="Copy run id"
      aria-label={`Copy run id ${value}`}
      className="inline-flex items-center gap-1 rounded px-1 font-mono text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
    >
      {value}
      {copied ? (
        <span className="text-teal-700">copied</span>
      ) : (
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 3.5H3.5a1 1 0 0 0-1 1v7" />
        </svg>
      )}
    </button>
  );
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Ne remplace l'état que si la base a bougé : sinon la liste entière se
      // redessinerait toutes les trois secondes pour rien.
      const fetched = await getRuns();
      setRuns((current) => keepIfUnchanged(current, fetched));
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
    if (!runs?.some((r) => r.run.status === "running" || r.run.status === "triggered"))
      return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [runs, load]);

  if (error) {
    return (
      <main className="mx-auto max-w-6xl p-8">
        <p
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-red-800"
        >
          {error}
        </p>
      </main>
    );
  }

  if (!runs) return <main className="mx-auto max-w-6xl p-8">Loading…</main>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
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
            <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="py-3 pr-8 font-medium">Run</th>
              <th className="py-3 pr-8 font-medium">Launched</th>
              <th className="py-3 pr-8 font-medium">Shape</th>
              <th className="py-3 pr-8 font-medium">Status</th>
              <th className="py-3 pr-8 text-right font-medium">Cost</th>
              <th className="py-3 pr-8 text-right font-medium">vs estimate</th>
              <th className="py-3 text-right font-medium">Average grade</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(({ run, progress, mean }) => {
              const { min, max } = rubricBounds(run.config.rubric);
              const running =
                run.status === "running" || run.status === "triggered";
              return (
                <tr
                  key={run.id}
                  className="border-b border-zinc-200 align-top hover:bg-zinc-50"
                >
                  {/* La colonne du titre prend la place restante : c'est par lui
                      qu'on retrouve un run, pas par sa forme ni son statut. */}
                  <td className="w-full py-3 pr-8">
                    <Link
                      href={`/eval/${run.id}`}
                      className="font-medium underline hover:text-teal-800"
                    >
                      {run.label ?? run.config.scenarios[0]?.title ?? run.id}
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <CopyId value={run.id} />
                      {/* Le local et le déployé écrivent dans la même base :
                          sans ce badge, un essai jetable ressemble à un vrai
                          run. Seul le local est marqué — c'est l'exception. */}
                      {run.origin === "local" && (
                        <span
                          className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600"
                          title="Lancé depuis une machine de développement, pas depuis le job déployé"
                        >
                          local
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8 text-zinc-600">
                    {formatDate(run.created_at)}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8 text-zinc-700">
                    {run.config.scenarios.length} ×{" "}
                    {run.config.models.targets.length} ×{" "}
                    {run.config.repetitions}
                    <div className="text-xs text-zinc-500">
                      scenarios × models × reps
                    </div>
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[run.status] ?? ""}`}
                    >
                      {STATUS_LABEL[run.status] ?? run.status}
                    </span>
                    {running && (
                      <div className="text-xs text-zinc-500">
                        {progress.done + progress.errored} / {progress.total}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8 text-right text-zinc-700">
                    {run.cost_usd === null
                      ? "—"
                      : `$${run.cost_usd.toFixed(run.cost_usd < 1 ? 3 : 2)}`}
                  </td>
                  {/* L'écart au devis, run après run : c'est en le voyant
                      s'accumuler qu'on saura si l'estimation dérive, et sur
                      quels modèles. Un run arrêté est écarté — son devis
                      chiffrait la matrice entière, pas la part qui a tourné. */}
                  <td className="whitespace-nowrap py-3 pr-8 text-right">
                    {run.estimate === null || run.cost_usd === null ? (
                      <span className="text-zinc-400">—</span>
                    ) : run.status === "cancelled" ? (
                      <span
                        className="text-zinc-400"
                        title="Arrêté en cours : le devis chiffrait toute la matrice"
                      >
                        n/a
                      </span>
                    ) : (
                      <span
                        className="text-zinc-600"
                        title={`Devis $${run.estimate.usd.toFixed(4)}`}
                      >
                        {run.estimate.usd >= run.cost_usd ? "+" : ""}
                        {Math.round(
                          ((run.estimate.usd - run.cost_usd) / run.cost_usd) *
                            100,
                        )}
                        %
                      </span>
                    )}
                  </td>
                  {/* La moyenne porte son échelle : chaque run a la sienne, et
                      un chiffre nu se comparerait à tort d'une ligne à l'autre. */}
                  <td className="whitespace-nowrap py-3 text-right">
                    {mean === null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <>
                        <span className="font-medium">{formatMean(mean)}</span>
                        <span className="text-xs text-zinc-500">
                          {" "}
                          / {formatValue(max)}
                        </span>
                        <div className="text-xs text-zinc-500">
                          scale {formatValue(min)}–{formatValue(max)}
                        </div>
                      </>
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

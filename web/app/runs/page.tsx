"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getDrafts, getRuns } from "@/lib/api";
import { keepIfUnchanged } from "@/lib/unchanged";
import { formatMean, formatValue, rubricBounds } from "@/lib/rubric";
import { publicRunPath } from "@/lib/run-id";
import { CopyButton, CopyId, PublicIcon } from "@/components/CopyButton";
import type { Draft, RunSummary } from "@/lib/types";

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


/** Les brouillons en attente — ce qu'un agent a proposé, pas encore lancé.
 *
 * Ouvrir mène au formulaire d'évaluation prérempli, pas à un écran de
 * lecture : ce qu'on veut faire d'un brouillon est le relire, le corriger et
 * le lancer. Un brouillon lancé disparaît d'ici — sans quoi on ne saurait plus
 * lequel reste à faire.
 *
 * De qui que ce soit : un brouillon est une proposition faite à l'équipe. */
function DraftList({ drafts }: { drafts: Draft[] | null }) {
  if (drafts === null) {
    return <p className="text-sm text-zinc-500">Loading drafts…</p>;
  }
  if (drafts.length === 0) {
    return (
      <p className="rounded border border-zinc-300 p-4 text-sm text-zinc-600">
        No draft waiting. Agents submit them with{" "}
        <code className="rounded bg-zinc-100 px-1">submit_draft_run</code>.
      </p>
    );
  }

  return (
    <section className="space-y-2 rounded border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-sm font-medium text-amber-900">
        {drafts.length} draft{drafts.length > 1 ? "s" : ""} waiting to be
        launched
      </h2>
      <ul className="space-y-2">
        {drafts.map((draft) => (
          <li
            key={draft.id}
            className="flex flex-wrap items-baseline justify-between gap-3 border-t border-amber-200 pt-2 text-sm"
          >
            <div>
              <div className="font-medium">
                {draft.config.label || "Untitled run"}
              </div>
              <div className="text-xs text-zinc-600">
                {draft.config.scenarios.length} scenario
                {draft.config.scenarios.length > 1 ? "s" : ""} ×{" "}
                {draft.config.models.targets.length} model
                {draft.config.models.targets.length > 1 ? "s" : ""} ×{" "}
                {draft.config.repetitions} · submitted by {draft.created_by} ·{" "}
                {formatDate(draft.created_at)}
              </div>
            </div>
            {/* « Launch » ouvre le formulaire plutôt que de lancer sur-le-champ :
                un brouillon vient d'un agent, et on veut pouvoir le corriger
                avant de dépenser. */}
            <Link
              href={`/?draft=${draft.id}`}
              className="shrink-0 rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700"
            >
              Launch…
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Les brouillons ne se chargent qu'à la demande : la plupart du temps il n'y
  // en a aucun, et une requête de plus à chaque ouverture de la liste des runs
  // se paierait pour rien.
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);

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

  const toggleDrafts = async () => {
    const next = !showDrafts;
    setShowDrafts(next);
    if (!next || drafts !== null) return;
    try {
      setDrafts(await getDrafts());
    } catch (e) {
      setError((e as Error).message);
    }
  };

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
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Every evaluation run, most recent first. Open one to see its matrix.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleDrafts}
          className="shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          {showDrafts ? "Hide drafts" : "Show drafts"}
        </button>
      </header>

      {showDrafts && <DraftList drafts={drafts} />}

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
            {runs.map(({ run, progress, mean, repetitions }) => {
              const { min, max } = rubricBounds(run.config.rubric);
              const running =
                run.status === "running" || run.status === "triggered";
              const [low, high] = repetitions;
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
                      {/* Le badge lui-même est le signal : en ambre, il ne
                          se voit que sur un run publié, et sa seule présence
                          dit « n'importe qui avec ce lien peut le lire ». Le
                          clic copie l'adresse absolue, pas seulement l'id. */}
                      {run.is_public && (
                        <CopyButton
                          value={() =>
                            `${window.location.origin}${publicRunPath(run.id)}`
                          }
                          title="Copy the public link"
                          className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 hover:bg-amber-200"
                        >
                          {(copied) =>
                            copied ? (
                              "copied"
                            ) : (
                              <>
                                <PublicIcon />
                                public
                              </>
                            )
                          }
                        </CopyButton>
                      )}
                    </div>
                    {/* Qui l'a lancé. Tout le monde voit tous les runs : sans
                        l'auteur, une liste chargée ne dit plus à qui s'adresser
                        quand un run surprend. */}
                    {run.user_email && (
                      <div className="text-xs text-zinc-500">{run.user_email}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8 text-zinc-600">
                    {formatDate(run.created_at)}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8 text-zinc-700">
                    {run.config.scenarios.length} ×{" "}
                    {run.config.models.targets.length} ×{" "}
                    {/* Compté sur les cases : un run complété n'a plus le même
                        nombre d'essais partout, et `config.repetitions` ne dirait
                        que ce qu'on a demandé au dernier lot. */}
                    {low === high ? low : `${low}–${high}`}
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

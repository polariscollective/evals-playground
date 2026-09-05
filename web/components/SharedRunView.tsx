"use client";

// Un run publié, lu comme on le lit chez soi.
//
// Les mêmes composants que la page privée, aux mêmes endroits : la matrice
// s'ouvre case par case, un scénario s'ouvre par son titre, les trajectoires
// se déplient. Ce qui manque n'est pas de la lecture — c'est le menu, la
// publication, l'extension, la repasse du juge, les notes éditables, et
// l'adresse de qui a lancé le run.
//
// Cette dernière est tenue par le type : `PublicRunDetail` n'a pas de
// `user_email`, donc l'afficher ne compile pas.
import { useEffect, useState } from "react";
import { hasInspectLogs, inspectViewUrl } from "@/lib/api";
import { PLAIN_VIEW } from "@/lib/view";
import type { MatrixView } from "@/lib/view";
import { renderMarkdown } from "@/lib/markdown";
import {
  DetailModal,
  JudgeBlock,
  RunMatrix,
  ScenarioModal,
  ToolsBlock,
  repetitionRange,
} from "@/components/RunRead";
import type { PublicRunDetail } from "@/lib/public-run";

export function SharedRunView({ detail }: { detail: PublicRunDetail }) {
  const [view, setView] = useState<MatrixView>(PLAIN_VIEW);
  const [openScenario, setOpenScenario] = useState<number | null>(null);
  const [open, setOpen] = useState<{ scenario: number; target: string } | null>(
    null,
  );

  const { run } = detail;
  const [low, high] = repetitionRange(detail.samples);

  // Le journal suit la publication du run : `canReadRun`, derrière cette
  // requête, laisse passer un inconnu exactement quand `loadPublicRun` l'a
  // laissé arriver jusqu'ici.
  const [inspectLogs, setInspectLogs] = useState(false);
  useEffect(() => {
    let vivant = true;
    void hasInspectLogs(run.id).then((présents) => {
      if (vivant) setInspectLogs(présents);
    });
    return () => {
      vivant = false;
    };
  }, [run.id]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          Shared run — read only
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {run.label ?? "Evaluation run"}
        </h1>
        <p className="text-sm text-zinc-600">
          {new Date(run.created_at).toISOString().slice(0, 10)} ·{" "}
          {run.config.scenarios.length} scenario
          {run.config.scenarios.length > 1 ? "s" : ""} ·{" "}
          {run.config.models.targets.length} model
          {run.config.models.targets.length > 1 ? "s" : ""} ·{" "}
          {low === high ? low : `${low}–${high}`} repetition
          {high > 1 ? "s" : ""} · {run.config.turns} turn
          {run.config.turns > 1 ? "s" : ""}
        </p>
        {inspectLogs && (
          <p className="mt-2 text-sm">
            <a
              href={inspectViewUrl(run.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
            >
              View Inspect AI logs
            </a>
          </p>
        )}
      </div>

      <JudgeBlock detail={detail} />

      <ToolsBlock detail={detail} />

      <RunMatrix
        detail={detail}
        view={view}
        onViewChange={setView}
        onOpenScenario={setOpenScenario}
        onOpenCell={(scenario, target) => setOpen({ scenario, target })}
      />

      {run.notes.trim() !== "" && (
        <section className="space-y-2 rounded border border-zinc-300 p-3">
          <h2 className="text-sm font-medium">Notes</h2>
          <div
            className="notes-prose text-sm"
            // Sûr : `renderMarkdown` échappe tout le HTML d'entrée.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(run.notes) }}
          />
        </section>
      )}

      {run.analysis.trim() !== "" && (
        <section className="space-y-2 rounded border border-zinc-300 p-3">
          <h2 className="text-sm font-medium">Run Analysis</h2>
          <div
            className="notes-prose text-sm"
            // Sûr : `renderMarkdown` échappe tout le HTML d'entrée.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(run.analysis) }}
          />
        </section>
      )}

      {openScenario !== null && (
        <ScenarioModal
          run={run}
          index={openScenario}
          onClose={() => setOpenScenario(null)}
        />
      )}

      {open && (
        // `loading` est toujours faux : la page charge les trajectoires d'un
        // coup côté serveur, là où la page privée les demande à l'ouverture
        // d'une case. Elle n'a pas de route publique à interroger, et lui en
        // ouvrir une pour ça élargirait la surface exposée sans rien apporter
        // à qui lit.
        <DetailModal
          detail={detail}
          scenarioIndex={open.scenario}
          target={open.target}
          loading={false}
          onClose={() => setOpen(null)}
        />
      )}
    </main>
  );
}

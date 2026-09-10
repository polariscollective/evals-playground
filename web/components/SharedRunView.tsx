"use client";

// A published run, read as one reads it at home.
//
// The same components as the private page, in the same places: the matrix opens
// cell by cell, a scenario opens by its title, the trajectories unfold. What is
// missing is not reading — it is the menu, the publication, the extension, the
// judge's second pass, the editable notes, and the address of whoever launched
// the run.
//
// That last one is held by the type: `PublicRunDetail` has no `user_email`, so
// showing it does not compile.
import { useEffect, useState } from "react";
import { hasInspectLogs, inspectViewUrl } from "@/lib/api";
import { PLAIN_VIEW } from "@/lib/view";
import type { MatrixView } from "@/lib/view";
import { Collapsible } from "@/components/Collapsible";
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
import { OpenInApp } from "@/components/OpenInApp";
import { PublicHeader } from "@/components/PublicHeader";
import { runReturn } from "@/lib/shared-return";

export function SharedRunView({
  detail,
  signedIn = false,
}: {
  detail: PublicRunDetail;
  /** Decided on the server by the page above. Absent means signed out, which is
   *  what a caller that does not know is describing. */
  signedIn?: boolean;
}) {
  const [view, setView] = useState<MatrixView>(PLAIN_VIEW);
  const [openScenario, setOpenScenario] = useState<number | null>(null);
  const [open, setOpen] = useState<{ scenario: number; target: string } | null>(
    null,
  );

  const { run } = detail;
  const [low, high] = repetitionRange(detail.samples);

  // The log follows the run's publication: `canReadRun`, behind this request,
  // lets a stranger through exactly when `loadPublicRun` let them get this far.
  const [inspectLogs, setInspectLogs] = useState(false);
  useEffect(() => {
    let alive = true;
    void hasInspectLogs(run.id).then((present) => {
      if (alive) setInspectLogs(present);
    });
    return () => {
      alive = false;
    };
  }, [run.id]);

  return (
    <>
      <PublicHeader>
        <p className="text-xs text-zinc-500">Shared run, read only</p>
        <OpenInApp href={runReturn(run.id)} signedIn={signedIn} />
      </PublicHeader>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-8 pb-8 pt-6">
        <div>
          <h1 className="text-2xl tracking-tight">
            {run.label ?? "Evaluation run"}
          </h1>
          <p className="text-sm text-zinc-600">
            {new Date(run.created_at).toISOString().slice(0, 10)},{" "}
            {run.config.scenarios.length} scenario
            {run.config.scenarios.length > 1 ? "s" : ""},{" "}
            {run.config.models.targets.length} model
            {run.config.models.targets.length > 1 ? "s" : ""},{" "}
            {low === high ? low : `${low}–${high}`} repetition
            {high > 1 ? "s" : ""}, {run.config.turns} turn
            {run.config.turns > 1 ? "s" : ""}
          </p>
          {inspectLogs && (
            <p className="mt-2 text-sm">
              <a
                href={inspectViewUrl(run.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="link-underline"
              >
                View Inspect AI logs
              </a>
            </p>
          )}
        </div>

      {/* Before the judge, as on the private page: the notes say what one wanted
          from this run, and the judge's scale reads afterwards. */}
      {run.notes.trim() !== "" && (
        <Collapsible
          className="space-y-2 rounded border border-zinc-300 p-3"
          bodyClassName="space-y-2"
          title={<h2 className="text-sm font-medium">Notes</h2>}
        >
          <div
            className="notes-prose text-sm"
            // Safe: `renderMarkdown` escapes all the input HTML.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(run.notes) }}
          />
        </Collapsible>
      )}

      <JudgeBlock detail={detail} />

      <ToolsBlock detail={detail} />

      <RunMatrix
        detail={detail}
        view={view}
        onViewChange={setView}
        onOpenScenario={setOpenScenario}
        onOpenCell={(scenario, target) => setOpen({ scenario, target })}
      />

      {run.analysis.trim() !== "" && (
        <Collapsible
          className="space-y-2 rounded border border-zinc-300 p-3"
          bodyClassName="space-y-2"
          title={<h2 className="text-sm font-medium">Run Analysis</h2>}
        >
          <div
            className="notes-prose text-sm"
            // Safe: `renderMarkdown` escapes all the input HTML.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(run.analysis) }}
          />
        </Collapsible>
      )}

      {openScenario !== null && (
        <ScenarioModal
          run={run}
          index={openScenario}
          onClose={() => setOpenScenario(null)}
        />
      )}

      {open && (
        // `loading` is always false: the page loads the trajectories in one go on
        // the server side, where the private page asks for them when a cell opens.
        // It has no public route to question, and opening one for that would widen
        // the exposed surface without bringing anything to whoever is reading.
        <DetailModal
          detail={detail}
          scenarioIndex={open.scenario}
          target={open.target}
          loading={false}
          onClose={() => setOpen(null)}
        />
      )}
      </main>
    </>
  );
}

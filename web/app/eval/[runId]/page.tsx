"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cancelRun,
  exportUrl,
  extendRun,
  getRun,
  matrixCsvText,
  publishRun,
  rejudgeRun,
  saveAnalysis,
  retryFailedCells,
  saveNotes,
  sourceCsvUrl,
} from "@/lib/api";
import { keepIfUnchanged } from "@/lib/unchanged";
import { PLAIN_VIEW } from "@/lib/view";
import type { MatrixView } from "@/lib/view";
import { ConfirmDialog, ConfirmRows } from "@/components/ConfirmDialog";
import { ExtendPanel } from "@/components/ExtendPanel";
import { CopyButton, CopyId, CopyIcon } from "@/components/CopyButton";
import { Menu, MenuItem, MenuSeparator } from "@/components/Menu";
import {
  DetailModal,
  JudgeBlock,
  RunMatrix,
  ScenarioModal,
  ToolsBlock,
  repetitionRange,
} from "@/components/RunRead";
import { NotesField } from "@/components/NotesField";
import { TagField } from "@/components/TagField";
import { RubricEditor } from "@/components/RubricEditor";
import type { RubricLevel, RunDetail } from "@/lib/types";

/** Repasser le juge sur un run terminé, avec une autre question. */
function RejudgePanel({
  detail,
  onLaunched,
  onClose,
}: {
  detail: RunDetail;
  onLaunched: () => void;
  onClose: () => void;
}) {
  const { config } = detail.run;
  const [criterion, setCriterion] = useState(config.criterion);
  const [rubric, setRubric] = useState<RubricLevel[]>(config.rubric);
  const [judge, setJudge] = useState(config.models.judge);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const models = [...new Set([...config.models.targets, config.models.judge])];
  const values = rubric.map((level) => level.value);
  const ready =
    criterion.trim() !== "" &&
    rubric.length >= 2 &&
    rubric.every(
      (level) => Number.isFinite(level.value) && level.meaning.trim() !== "",
    ) &&
    new Set(values).size === values.length;

  const launch = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await rejudgeRun(detail.run.id, { criterion, rubric, judge });
      onLaunched();
    } catch (e) {
      setFailed((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded border border-teal-400 bg-teal-50/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">Judge this run again</h2>
          <p className="mt-1 text-sm text-zinc-700">
            This <strong>erases every grade and justification</strong> in this
            run before it starts. The transcripts are not touched, and the
            evaluated models are not called again — only the judge is, so this
            costs a fraction of the run.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-sm underline hover:text-zinc-900"
        >
          cancel
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">
          What the judge should look at
        </span>
        <textarea
          value={criterion}
          onChange={(e) => setCriterion(e.target.value)}
          rows={3}
          className="w-full rounded border border-zinc-300 bg-white p-3"
        />
      </label>

      <div className="space-y-2">
        <span className="text-sm font-medium">Grades</span>
        <RubricEditor rubric={rubric} onChange={setRubric} />
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Judge</span>
        <select
          value={judge}
          onChange={(e) => setJudge(e.target.value)}
          className="block rounded border border-zinc-300 bg-white p-2 text-sm"
        >
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>

      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {failed}
        </p>
      )}

      <button
        onClick={launch}
        disabled={!ready || busy}
        className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-900"
      >
        {busy ? "Starting…" : `Re-judge ${detail.samples.length} conversations`}
      </button>
    </section>
  );
}


export default function EvalRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const router = useRouter();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [rejudging, setRejudging] = useState(false);
  const [extending, setExtending] = useState(false);
  // Comment lire la matrice. Rien n'en sort vers la base : c'est une lecture,
  // pas un résultat, et un rechargement ramène la lecture ordinaire.
  const [view, setView] = useState<MatrixView>(PLAIN_VIEW);
  const [openScenario, setOpenScenario] = useState<number | null>(null);
  const [stopping, setStopping] = useState(false);
  // Quelle action attend d'être confirmée, s'il y en a une.
  const [confirming, setConfirming] = useState<null | "stop" | "retry">(
    null,
  );
  // Le retour d'une action du menu, qui s'est refermé depuis. Séparé de
  // `error`, qui remplace la page entière : un presse-papier récalcitrant ne
  // doit pas faire disparaître la matrice.
  const [notice, setNotice] = useState("");
  // Les transcripts pèsent lourd et ne servent qu'à la fenêtre de détail : on
  // ne les charge qu'à l'ouverture d'une case, pas à chaque rafraîchissement.
  const [transcripts, setTranscripts] = useState(false);
  const [open, setOpen] = useState<{ scenario: number; target: string } | null>(
    null,
  );
  // L'adresse publique quand le run est publié, `null` sinon.
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  const load = useCallback(
    async (withTranscripts: boolean) => {
      try {
        const loaded = await getRun(runId, withTranscripts);
        // Même raison que sur la liste : un run terminé qu'on garde ouvert ne
        // doit pas faire clignoter sa matrice.
        setDetail((current) => keepIfUnchanged(current, loaded));
        setPublicUrl(loaded.run.is_public ? `/shared/${loaded.run.id}` : null);
        // Amorcé une seule fois : le rafraîchissement d'un run en cours ne doit
        // pas écraser une note en train d'être écrite.
        setNotes((current) => (current === "" ? loaded.run.notes : current));
        setAnalysis((current) =>
          current === "" ? loaded.run.analysis : current,
        );
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [runId],
  );

  useEffect(() => {
    // Passer par un timer plutôt que d'appeler load() dans le corps de
    // l'effet : celui-ci déclenche un setState synchrone, ce que la règle
    // react-hooks/set-state-in-effect interdit à juste titre.
    const timer = setTimeout(() => load(transcripts), 0);
    return () => clearTimeout(timer);
  }, [load, transcripts]);

  const running =
    detail?.run.status === "running" || detail?.run.status === "triggered";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => load(transcripts), 3000);
    return () => clearInterval(timer);
  }, [running, load, transcripts]);

  if (error) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <p
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-red-800"
        >
          {error}
        </p>
      </main>
    );
  }

  if (!detail) return <main className="mx-auto max-w-5xl p-8">Loading…</main>;

  const { run, progress } = detail;
  const copyMatrix = async () => {
    try {
      await navigator.clipboard.writeText(await matrixCsvText(run.id, view));
      setNotice("Table copied to the clipboard.");
    } catch (e) {
      setNotice(`Could not copy: ${(e as Error).message}`);
    }
    setTimeout(() => setNotice(""), 3000);
  };

  const stop = async () => {
    setStopping(true);
    try {
      await cancelRun(run.id);
      setConfirming(null);
      await load(transcripts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStopping(false);
    }
  };

  const retry = async () => {
    try {
      await retryFailedCells(run.id);
      setConfirming(null);
      await load(transcripts);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const publish = async (isPublic: boolean) => {
    setPublishing(true);
    try {
      const { url } = await publishRun(run.id, isPublic);
      setPublicUrl(url);
      setConfirmingPublish(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  };
  const openCell = (scenario: number, target: string) => {
    setOpen({ scenario, target });
    // Une seule fois : une fois les transcripts chargés, les rafraîchissements
    // suivants les gardent.
    if (!transcripts) setTranscripts(true);
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {run.label ?? "Evaluation run"}
          </h1>
          <p className="text-sm text-zinc-600">
            <CopyId value={run.id} /> · {run.config.scenarios.length} scenario
            {run.config.scenarios.length > 1 ? "s" : ""} ·{" "}
            {run.config.models.targets.length} model
            {run.config.models.targets.length > 1 ? "s" : ""} · {run.config.repetitions} repetition
            {run.config.repetitions > 1 ? "s" : ""} · {run.config.turns} turn
            {run.config.turns > 1 ? "s" : ""}
            {run.cost_usd !== null && (
              <>
                {" · "}
                <span
                  className="font-medium text-zinc-900"
                  title={Object.entries(run.usage)
                    .map(
                      ([model, u]) =>
                        `${model}: ${u.input_tokens.toLocaleString()} in / ${u.output_tokens.toLocaleString()} out`,
                    )
                    .join("\n")}
                >
                  ${run.cost_usd.toFixed(run.cost_usd < 1 ? 4 : 2)}
                </span>
                {run.estimate && (
                  // L'écart au devis, à côté du prix : c'est en le voyant run
                  // après run qu'on saura si l'estimation dérive, et sur quels
                  // modèles.
                  <span
                    className="text-zinc-500"
                    title={`Estimated $${run.estimate.usd.toFixed(4)} before launching, assuming ${run.estimate.per_model
                      .map((m) => `${m.model} ${m.response_tokens} tok/answer`)
                      .join(", ")}`}
                  >
                    {" "}
                    (estimate ${run.estimate.usd.toFixed(
                      run.estimate.usd < 1 ? 4 : 2,
                    )}
                    {run.cost_usd > 0 &&
                      `, ${
                        run.estimate.usd >= run.cost_usd ? "+" : ""
                      }${Math.round(
                        ((run.estimate.usd - run.cost_usd) / run.cost_usd) * 100,
                      )}%`}
                    )
                  </span>
                )}
              </>
            )}
          </p>
          {/* Sur sa propre ligne plutôt qu'au bout de la précédente :
              noyée entre le coût et le devis, l'adresse ne se lisait pas. */}
          {run.user_email && (
            <p className="text-sm text-zinc-500">{run.user_email}</p>
          )}
        </div>
        <div className="flex shrink-0 items-start justify-end gap-2">
          {/* L'arrêt reste dehors : c'est la seule action qu'on cherche dans
              l'urgence, et elle ne paraît que pendant qu'un run tourne — donc
              jamais en même temps que celles du menu. */}
          {running && (
            <button
              onClick={() => setConfirming("stop")}
              disabled={stopping}
              title="Le job lit la demande avant chaque case. Celle en cours ira à son terme."
              className="cursor-pointer rounded border border-amber-400 bg-amber-50 px-3 py-1 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
          <Menu label="Run actions">
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    close();
                    router.push(`/?from=${run.id}`);
                  }}
                  hint="A separate run, same settings"
                >
                  Duplicate
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    if (publicUrl) publish(false);
                    else setConfirmingPublish(true);
                  }}
                  hint={
                    publicUrl
                      ? "Kills the link"
                      : "A link anyone can open, read only"
                  }
                >
                  {publicUrl ? "Unpublish" : "Publish…"}
                </MenuItem>
                {!running && (
                  <MenuItem
                    onClick={() => {
                      close();
                      setExtending(true);
                    }}
                    hint="Scenarios, models or attempts, added here"
                  >
                    Extend…
                  </MenuItem>
                )}
                {!running && progress.errored > 0 && (
                  <MenuItem
                    onClick={() => {
                      close();
                      setConfirming("retry");
                    }}
                    hint="Run them again, in this same run"
                  >
                    Retry failed ({progress.errored})
                  </MenuItem>
                )}
                {!running && progress.done + progress.errored > 0 && (
                  <MenuItem
                    onClick={() => {
                      close();
                      setRejudging(true);
                    }}
                    hint="A different question, same transcripts"
                  >
                    Re-judge
                  </MenuItem>
                )}
                <MenuSeparator />
                <MenuItem
                  href={exportUrl(run.id, "matrix", view)}
                  onClick={close}
                  hint="The table as shown"
                >
                  Download table
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    void copyMatrix();
                  }}
                  hint="Paste into a sheet or a doc"
                >
                  Copy table
                </MenuItem>
                <MenuItem
                  href={exportUrl(run.id, "details")}
                  onClick={close}
                  hint="A zip: results.csv, plus run.md with the notes and the tools"
                >
                  Download full data (zip)
                </MenuItem>
                {detail.source_csv_available && (
                  <MenuItem
                    href={sourceCsvUrl(run.id)}
                    onClick={close}
                    hint="The CSV uploaded when this run was launched"
                  >
                    Source CSV
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        </div>
      </div>

      <TagField runId={run.id} />

      {publicUrl && (
        <p className="flex items-center gap-1 text-sm text-zinc-500">
          Published — anyone with this link can read it:{" "}
          <code className="rounded bg-zinc-100 px-1">{publicUrl}</code>
          {/* Le lien copié est absolu : celui qui le reçoit n'a pas le
              contexte de cette fenêtre, et une adresse relative ne lui dirait
              rien. `window.location.origin` n'est lu qu'au clic — jamais
              pendant le rendu, où il n'existe pas côté serveur. */}
          <CopyButton
            value={() => `${window.location.origin}${publicUrl}`}
            title="Copy the public link"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            {(copied) =>
              copied ? (
                <span className="text-teal-700">copied</span>
              ) : (
                <CopyIcon />
              )
            }
          </CopyButton>
        </p>
      )}

      {running && (
        <p className="rounded border border-zinc-300 p-3 text-sm">
          {/* `triggered` et `running` ne veulent pas dire la même chose, et les
              confondre fait passer pour « en cours » un job qui n'a pas encore
              démarré. Un démarrage à froid de Cloud Run prend une minute : sans
              cette distinction, on croit à un blocage. */}
          {run.status === "triggered" ? (
            <>
              <strong>Starting.</strong> The job has been asked to start; no
              cell has begun yet — {progress.total} queued. A cold start takes
              about a minute.
            </>
          ) : (
            <>
              <strong>Running.</strong> {progress.done} graded
              {progress.running > 0 && `, ${progress.running} in flight`}
              {/* Les cases qui n'ont pas commencé sont ce qui reste à payer :
                  c'est le chiffre qu'on cherche quand on hésite à arrêter. */}
              {progress.pending > 0 && `, ${progress.pending} still to run`}
              {progress.errored > 0 && `, ${progress.errored} failed`} — out of{" "}
              {progress.total} cells.
            </>
          )}
        </p>
      )}

      {run.status === "error" && (
        <p
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-red-800"
        >
          The run failed: {run.error}
        </p>
      )}

      {run.status === "cancelled" && (
        <p className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Stopped.</strong> {progress.done} of {progress.total} cells
          finished
          {progress.cancelled > 0 && ` · ${progress.cancelled} never ran (∅)`}
          {progress.errored > 0 && ` · ${progress.errored} failed`}. A cell
          already in flight when you stopped was let finish — what was paid for
          is kept. Extend to finish what was left, or Duplicate to start over.
        </p>
      )}

      {notice && (
        <p className="rounded border border-zinc-300 bg-zinc-50 p-2 text-sm text-zinc-700">
          {notice}
        </p>
      )}

      <ConfirmDialog
        open={confirming === "stop"}
        title="Stop this run?"
        confirmLabel="Stop the run"
        tone="warning"
        busy={stopping}
        onConfirm={stop}
        onCancel={() => setConfirming(null)}
      >
        {/* Les trois issues ne sont pas symétriques, et c'est la source de
            l'hésitation : ce qui est en vol est déjà payé, ce qui n'a pas
            commencé ne coûtera rien, ce qui est noté reste. */}
        <ConfirmRows
          rows={[
            {
              label: "In flight",
              count: progress.running,
              fate: "will finish, and be kept.",
            },
            {
              label: "Not started",
              count: progress.pending,
              fate: "will be cancelled.",
            },
            {
              label: "Already graded",
              count: progress.done,
              fate: "kept as they are.",
            },
            { label: "Failed", count: progress.errored, fate: "unchanged." },
          ]}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === "retry"}
        title={`Retry ${progress.errored} failed cell${progress.errored > 1 ? "s" : ""}?`}
        confirmLabel="Retry them"
        onConfirm={retry}
        onCancel={() => setConfirming(null)}
      >
        <ConfirmRows
          rows={[
            {
              label: "Failed",
              count: progress.errored,
              fate: "will be run again, in this same run.",
            },
            {
              label: "Already graded",
              count: progress.done,
              fate: "untouched, and not paid for again.",
            },
          ]}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingPublish}
        title="Publish this run?"
        confirmLabel="Publish"
        busy={publishing}
        onConfirm={() => publish(true)}
        onCancel={() => setConfirmingPublish(false)}
      >
        <p className="text-sm">
          Anyone with the link will be able to read it, without signing in. The
          link is not listed anywhere, and unpublishing kills it.
        </p>
        <ConfirmRows
          rows={[
            {
              label: "Results",
              count: detail.samples.length,
              fate: "scores, judge justifications and full conversations",
            },
            {
              label: "Scenarios",
              count: run.config.scenarios.length,
              fate: "titles, system prompts, opening messages and their notes",
            },
            {
              label: "Your notes",
              count: run.notes.trim() === "" ? 0 : 1,
              fate: "published with the rest",
            },
          ]}
        />
        <p className="text-sm text-zinc-500">
          Your email address is the only thing kept back.
        </p>
      </ConfirmDialog>

      {extending && !running && (
        <ExtendPanel
          run={run}
          repetitionRange={repetitionRange(detail.samples)}
          onCancel={() => setExtending(false)}
          onSubmit={async (request) => {
            await extendRun(run.id, request);
            setExtending(false);
            await load(transcripts);
          }}
        />
      )}

      {rejudging && !running && (
        <RejudgePanel
          detail={detail}
          onLaunched={() => {
            setRejudging(false);
            load(transcripts);
          }}
          onClose={() => setRejudging(false)}
        />
      )}

      <JudgeBlock detail={detail} />

      <ToolsBlock detail={detail} />

      <RunMatrix
        detail={detail}
        view={view}
        onViewChange={setView}
        onOpenScenario={setOpenScenario}
        onOpenCell={openCell}
      />

      <NotesField
        // La clé force un remontage quand le run change : sans elle, l'état
        // local du composant survivrait à la navigation d'un run à l'autre.
        // Distincte de celle du champ Run Analysis, juste en dessous — deux
        // instances du même composant, à la même profondeur, ne peuvent pas
        // partager une clé sans que React confonde leur état local.
        key={`${run.id}-notes`}
        value={notes}
        onChange={setNotes}
        rows={8}
        onSave={async (next) => {
          await saveNotes(run.id, next);
        }}
      />

      <NotesField
        key={`${run.id}-analysis`}
        label="Run Analysis"
        value={analysis}
        onChange={setAnalysis}
        rows={8}
        hint="Written after the fact — what the results actually show."
        onSave={async (next) => {
          await saveAnalysis(run.id, next);
        }}
      />
      {openScenario !== null && (
        <ScenarioModal
          run={run}
          index={openScenario}
          onClose={() => setOpenScenario(null)}
        />
      )}
      {open && (
        <DetailModal
          detail={detail}
          scenarioIndex={open.scenario}
          target={open.target}
          loading={!transcripts}
          onClose={() => setOpen(null)}
        />
      )}
    </main>
  );
}

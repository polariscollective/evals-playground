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
import { cellsOf } from "@/lib/matrix";
import { toolsFor } from "@/lib/tools";
import { keepIfUnchanged } from "@/lib/unchanged";
import { PLAIN_VIEW, describeView, viewBounds } from "@/lib/view";
import type { MatrixView } from "@/lib/view";
import { ConfirmDialog, ConfirmRows } from "@/components/ConfirmDialog";
import { Dialog } from "@/components/Dialog";
import { ExtendPanel } from "@/components/ExtendPanel";
import { ViewControls } from "@/components/ViewControls";
import { Menu, MenuItem, MenuSeparator } from "@/components/Menu";
import { MessageView } from "@/components/MessageView";
import { NotesField } from "@/components/NotesField";
import { RubricEditor } from "@/components/RubricEditor";
import {
  cellStyle,
  distribution,
  formatMean,
  formatValue,
  rubricBounds,
  sortedRubric,
} from "@/lib/rubric";
import type {
  EvalRun,
  EvalSample,
  RubricLevel,
  RunDetail,
} from "@/lib/types";

/** Combien d'essais chaque couple scénario × modèle a déjà : le moins, le plus.
 *
 * Un run complété n'avance pas au même rythme partout — un modèle ajouté en
 * cours de route a moins d'essais que les premiers, et la moyenne d'une case
 * porte alors sur moins de conversations que celle d'à côté. Le dire est le prix
 * d'une matrice qu'on peut agrandir. */
function repetitionRange(samples: EvalSample[]): [number, number] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const key = `${sample.scenario_index} ${sample.target_model}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = [...counts.values()];
  if (values.length === 0) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}

function shortModel(id: string): string {
  return id.split("/").pop() ?? id;
}

/** La note d'une tentative, avec le sens que l'échelle lui donne.
 *
 * Le nombre seul ne dit rien : c'est la phrase écrite à côté qui porte le
 * jugement, et la relire ici évite de remonter à l'échelle à chaque tentative. */
function ScoreBadge({
  sample,
  rubric,
}: {
  sample: EvalSample;
  rubric: RubricLevel[];
}) {
  if (sample.status === "pending" || sample.status === "running") {
    return (
      <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
        {sample.status === "running" ? "running…" : "queued"}
      </span>
    );
  }
  if (sample.status === "error") {
    return (
      <span
        className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-900"
        title={sample.error ?? undefined}
      >
        failed
      </span>
    );
  }
  if (sample.status === "cancelled") {
    // Pas rouge : on a décidé de ne pas la faire, elle n'a pas cassé.
    return (
      <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700">
        not run
      </span>
    );
  }
  if (sample.score === null) {
    return (
      <span className="rounded border border-dashed border-zinc-400 px-2 py-0.5 text-xs text-zinc-500">
        not judged
      </span>
    );
  }

  const { min, max } = rubricBounds(rubric);
  const level = rubric.find((one) => one.value === sample.score);
  const meaning = level?.meaning;

  if (level?.excluded) {
    // Le juge a répondu, mais sa réponse reste hors moyenne : ni une note, ni
    // une absence de note.
    return (
      <span
        className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600"
        title={meaning}
      >
        n/a — {meaning}
      </span>
    );
  }
  const t = max > min ? (sample.score - min) / (max - min) : 0;
  const style =
    t <= 0
      ? "bg-teal-100 text-teal-900"
      : t < 0.5
        ? "bg-amber-100 text-amber-900"
        : t < 1
          ? "bg-amber-300 text-amber-950"
          : "bg-zinc-900 text-white";
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${style}`} title={meaning}>
      {formatValue(sample.score)}
      {meaning ? ` — ${meaning}` : ""}
    </span>
  );
}

/** Copie un texte dans le presse-papier et le confirme brièvement.

    `navigator.clipboard` n'existe pas hors contexte sécurisé. On retombe alors
    sur une sélection manuelle plutôt que d'échouer en silence. */
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

/** Ce qu'on a demandé au juge : la question, l'échelle, et qui a jugé. */
/** Les outils du run, tels qu'ils ont été présentés au modèle.
 *
 * Mot pour mot, description comprise : sans elle on ne peut pas relire une
 * décision d'appel, puisque c'est le seul texte que le modèle avait sous les
 * yeux au moment de décider. Le compte d'appels réels est là parce qu'un outil
 * défini et jamais appelé est un résultat, pas un oubli. */
function ToolsBlock({ detail }: { detail: RunDetail }) {
  const { config } = detail.run;
  const tools = config.tools ?? [];
  if (tools.length === 0) return null;

  const appels = (name: string) =>
    detail.samples.reduce(
      (total, sample) =>
        total +
        sample.messages.filter((message) =>
          (message.tool_calls ?? []).some((call) => call.name === name),
        ).length,
      0,
    );

  return (
    <section className="space-y-3 rounded border border-zinc-300 bg-zinc-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Tools the evaluated model could call</h2>
        <span className="text-xs text-zinc-500">
          nothing was executed · up to{" "}
          {config.max_tool_calls_per_turn ?? 5} consecutive calls per turn
        </span>
      </div>
      {tools.map((tool) => {
        const offert = config.scenarios.filter((scenario) =>
          toolsFor(config, scenario).some((entry) => entry.name === tool.name),
        ).length;
        return (
          <div key={tool.name} className="space-y-1 border-t border-zinc-200 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <code className="text-sm font-medium">{tool.name}</code>
              <span className="text-xs text-zinc-500">
                offered to {offert} of {config.scenarios.length} scenarios ·
                called {appels(tool.name)}×
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap text-zinc-800">
              {tool.description}
            </p>
            {tool.parameters.length > 0 && (
              <p className="font-mono text-xs text-zinc-600">
                {tool.parameters
                  .map(
                    (param) =>
                      `${param.name}: ${param.type}${param.required ? "" : "?"}`,
                  )
                  .join(", ")}
              </p>
            )}
            <p className="text-xs text-zinc-500">
              returns: <span className="font-mono">{tool.result || "(empty)"}</span>
            </p>
          </div>
        );
      })}
    </section>
  );
}

/** Ce qui définit une ligne de la matrice, réuni.
 *
 * « Pourquoi cette ligne » est la question qu'on se pose devant une matrice, et
 * le titre seul n'y répond pas — surtout sur douze scénarios dont les titres se
 * ressemblent parce qu'ils ne varient que d'un axe. La note y répond ; le reste
 * est là pour vérifier qu'elle dit vrai.
 */
function ScenarioModal({
  run,
  index,
  onClose,
}: {
  run: EvalRun;
  index: number;
  onClose: () => void;
}) {
  const scenario = run.config.scenarios[index];
  if (!scenario) return null;
  const tools = toolsFor(run.config, scenario);
  const hasTools = (run.config.tools ?? []).length > 0;

  return (
    <Dialog
      open
      title={scenario.title}
      width="44rem"
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {scenario.note ? (
          <div className="rounded border border-teal-300 bg-teal-50 p-3">
            <p className="mb-1 text-xs font-medium text-teal-900">
              {/* Une note de laboratoire, pas une consigne : le modèle et le
                  juge ne la voient jamais. Le dire ici évite qu'on l'écrive un
                  jour comme si elle comptait. */}
              Note — for whoever reads the matrix. Neither the model nor the
              judge saw this.
            </p>
            <p className="whitespace-pre-wrap text-sm text-teal-950">
              {scenario.note}
            </p>
          </div>
        ) : (
          <p className="text-sm text-zinc-500 italic">
            No note was written for this scenario.
          </p>
        )}

        {hasTools && (
          <p className="text-sm">
            <span className="text-zinc-500">Tools available: </span>
            {tools.length === 0 ? (
              <span className="font-mono">none</span>
            ) : (
              tools.map((tool) => (
                <code key={tool.name} className="mr-2">
                  {tool.name}
                </code>
              ))
            )}
          </p>
        )}

        <div>
          <p className="mb-1 text-xs text-zinc-500">System prompt</p>
          <pre className="overflow-x-auto rounded border border-zinc-200 bg-zinc-50 p-3 text-xs whitespace-pre-wrap">
            {scenario.system_prompt}
          </pre>
        </div>

        {(scenario.history ?? []).length > 0 && (
          <div>
            <p className="mb-1 text-xs text-zinc-500">
              Prior history — given, not produced
            </p>
            <div className="space-y-1">
              {(scenario.history ?? []).map((turn, position) => (
                <div
                  key={position}
                  className="rounded border border-dashed border-zinc-300 p-2 text-xs"
                >
                  <span className="mr-2 font-medium text-zinc-500">
                    {turn.role}
                  </span>
                  <span className="whitespace-pre-wrap">{turn.content}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs text-zinc-500">Opening message</p>
          <pre className="overflow-x-auto rounded border border-zinc-200 bg-zinc-50 p-3 text-xs whitespace-pre-wrap">
            {scenario.opening_message}
          </pre>
        </div>
      </div>
    </Dialog>
  );
}

function JudgeBlock({ detail }: { detail: RunDetail }) {
  const { config } = detail.run;
  return (
    <section className="space-y-3 rounded border border-zinc-300 bg-zinc-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">What the judge was asked</h2>
        <span className="font-mono text-xs text-zinc-500">
          judged by {shortModel(config.models.judge)}
          {detail.run.rejudged_at && " · re-judged since the run"}
        </span>
      </div>

      <p className="whitespace-pre-wrap text-sm text-zinc-800">
        {config.criterion}
      </p>

      <table className="text-sm">
        <tbody>
          {sortedRubric(config.rubric).map((level) => (
            <tr key={level.value}>
              <td className="py-0.5 pr-3 text-right align-top font-mono text-xs text-zinc-500">
                {formatValue(level.value)}
              </td>
              <td className="py-0.5 align-top">{level.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

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

function DetailModal({
  detail,
  scenarioIndex,
  target,
  loading,
  onClose,
}: {
  detail: RunDetail;
  scenarioIndex: number;
  target: string;
  loading: boolean;
  onClose: () => void;
}) {
  const [showSystem, setShowSystem] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const scenario = detail.run.config.scenarios[scenarioIndex];
  const attempts = detail.samples.filter(
    (sample) =>
      sample.scenario_index === scenarioIndex && sample.target_model === target,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/50 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl space-y-5 rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{scenario?.title}</h2>
            <p className="text-sm text-zinc-600">
              {shortModel(target)} · {attempts.length} attempt
              {attempts.length > 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm underline hover:text-zinc-900"
          >
            close
          </button>
        </div>

        <div className="rounded border border-zinc-300">
          <button
            onClick={() => setShowSystem(!showSystem)}
            className="flex w-full items-center justify-between p-3 text-left text-sm font-medium hover:bg-zinc-50"
          >
            System prompt given to the evaluated model
            <span>{showSystem ? "−" : "+"}</span>
          </button>
          {showSystem && (
            <pre className="whitespace-pre-wrap border-t border-zinc-200 p-3 text-xs">
              {scenario?.system_prompt}
            </pre>
          )}
        </div>

        {/* Ce que cette case avait réellement sous la main : un scénario peut
            n'avoir reçu aucun outil quand les autres les ont tous, et c'est
            souvent la comparaison qu'on cherche. Avec la description, sans
            laquelle on ne peut pas relire une décision d'appel. */}
        {(detail.run.config.tools ?? []).length > 0 && scenario && (
          <div className="rounded border border-zinc-300">
            <button
              onClick={() => setShowTools(!showTools)}
              className="flex w-full items-center justify-between p-3 text-left text-sm"
            >
              Tools available to this scenario —{" "}
              {toolsFor(detail.run.config, scenario).length === 0
                ? "none"
                : toolsFor(detail.run.config, scenario)
                    .map((tool) => tool.name)
                    .join(", ")}
              <span>{showTools ? "−" : "+"}</span>
            </button>
            {showTools && (
              <div className="space-y-3 border-t border-zinc-200 p-3">
                {toolsFor(detail.run.config, scenario).length === 0 ? (
                  <p className="text-xs text-zinc-600">
                    This scenario was offered no tools, while the run defines{" "}
                    {(detail.run.config.tools ?? []).length}.
                  </p>
                ) : (
                  toolsFor(detail.run.config, scenario).map((tool) => (
                    <div key={tool.name} className="space-y-1">
                      <code className="text-xs font-medium">{tool.name}</code>
                      <p className="text-xs whitespace-pre-wrap text-zinc-700">
                        {tool.description}
                      </p>
                      {tool.parameters.length > 0 && (
                        <p className="font-mono text-xs text-zinc-500">
                          {tool.parameters
                            .map(
                              (param) =>
                                `${param.name}: ${param.type}${param.required ? "" : "?"}`,
                            )
                            .join(", ")}
                        </p>
                      )}
                      <p className="text-xs text-zinc-500">
                        returns:{" "}
                        <span className="font-mono">{tool.result || "(empty)"}</span>
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {detail.run.config.adversary_prompt && (
          <div className="rounded border border-red-300 bg-zinc-950 p-3 text-zinc-100">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-medium">Adversary objective</span>
              <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-300">
                never shown to the evaluated model
              </span>
            </div>
            <pre className="whitespace-pre-wrap text-xs text-zinc-300">
              {detail.run.config.adversary_prompt}
            </pre>
          </div>
        )}

        {loading && (
          <p className="text-sm text-zinc-500">Loading the transcripts…</p>
        )}

        {attempts.map((attempt) => (
          <AttemptView
            key={attempt.id}
            attempt={attempt}
            rubric={detail.run.config.rubric}
          />
        ))}
      </div>
    </div>
  );
}

function AttemptView({
  attempt,
  rubric,
}: {
  attempt: EvalSample;
  rubric: RubricLevel[];
}) {
  // Repliée par défaut : dix répétitions de dix tours feraient un mur de texte
  // où l'on ne retrouve plus la tentative qu'on cherchait.
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded border border-zinc-300">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 p-3 text-left hover:bg-zinc-50"
      >
        <span className="text-zinc-400">{open ? "−" : "+"}</span>
        <span className="text-sm font-medium">
          Attempt {attempt.repetition + 1}
        </span>
        <ScoreBadge sample={attempt} rubric={rubric} />
        {attempt.messages.some(
          (m) => m.role === "assistant" && !m.content.trim(),
        ) && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
            blocked
          </span>
        )}
        {attempt.temperature !== null && (
          <span className="text-xs text-zinc-500">
            temperature {attempt.temperature.toFixed(2)}
          </span>
        )}
        <span className="ml-auto text-xs text-zinc-500">
          {attempt.cost_usd !== null && attempt.cost_usd > 0 && (
            <>${attempt.cost_usd.toFixed(4)} · </>
          )}
          {attempt.messages.length} message
          {attempt.messages.length > 1 ? "s" : ""}
        </span>
      </button>

      {/* La justification du juge reste visible repliée : c'est elle qui dit
          si cette tentative mérite qu'on l'ouvre. */}
      {attempt.justification && (
        <p className="px-3 pb-3 text-sm text-zinc-700">
          <span className="font-medium">Judge:</span> {attempt.justification}
        </p>
      )}
      {attempt.error && (
        <p className="px-3 pb-3 text-sm text-red-800">{attempt.error}</p>
      )}

      {open && (
        <div className="space-y-2 border-t border-zinc-200 p-3">
          {attempt.messages.map((message, index) => (
            <MessageView key={index} message={message} index={index} />
          ))}
        </div>
      )}
    </div>
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
  const cells = cellsOf(
    detail.samples,
    run.config.scenarios.length,
    run.config.rubric,
    view,
  );

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
  const targets = run.config.models.targets;
  const rubric = run.config.rubric;
  // Les bornes de la lecture en cours, pas celles de l'échelle : une échelle
  // repliée sur 0–1 laisserait sinon la couleur calée sur l'ancienne étendue, et
  // toute la matrice paraîtrait pâle.
  const { min, max } = viewBounds(rubric, view);

  const scoresOf = (scenarioIndex: number, target: string) =>
    detail.samples
      .filter(
        (sample) =>
          sample.scenario_index === scenarioIndex &&
          sample.target_model === target,
      )
      .map((sample) => sample.score);

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
            {run.config.scenarios.length > 1 ? "s" : ""} · {targets.length} model
            {targets.length > 1 ? "s" : ""} · {run.config.repetitions} repetition
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

      {publicUrl && (
        <p className="text-sm text-zinc-500">
          Published — anyone with this link can read it:{" "}
          <code className="rounded bg-zinc-100 px-1">{publicUrl}</code>
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

      {cells.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">Grade per scenario and model</h2>
          <ViewControls
            rubric={rubric}
            scores={detail.samples
              .map((sample) => sample.score)
              .filter((score): score is number => score !== null)}
            view={view}
            onChange={setView}
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-zinc-300 p-2 text-left font-medium">
                    Scenario
                  </th>
                  {targets.map((target) => (
                    <th
                      key={target}
                      className="border-b border-zinc-300 p-2 text-left font-mono text-xs font-medium"
                    >
                      {shortModel(target)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.config.scenarios.map((scenario, index) => (
                  <tr key={index}>
                    <td className="border-b border-zinc-200 p-2">
                      {/* Le titre mène à ce qui définit la ligne. Sur douze
                          scénarios qui ne varient que d'un axe, le titre seul
                          ne dit pas ce qu'on regarde. */}
                      <button
                        onClick={() => setOpenScenario(index)}
                        title="What this scenario is, and why"
                        className="cursor-pointer text-left underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900"
                      >
                        {scenario.title}
                      </button>
                      {scenario.note && (
                        <span
                          className="ml-1 text-xs text-zinc-400"
                          aria-hidden
                        >
                          ●
                        </span>
                      )}
                    </td>
                    {targets.map((target) => {
                      const cell = cells[index]?.[target];
                      const waiting = (cell?.pending ?? 0) > 0;
                      const nothingRan =
                        !!cell && cell.judged === 0 && cell.cancelled > 0;
                      return (
                        <td key={target} className="border-b border-zinc-200 p-1">
                          <button
                            onClick={() => openCell(index, target)}
                            className={`w-full rounded p-2 text-center text-sm ${cellStyle(cell, rubric)}`}
                            title={
                              cell?.mean != null
                                ? `${distribution(scoresOf(index, target))} — average of ${cell.judged} of ${run.config.repetitions}` +
                                  (cell.excluded > 0
                                    ? ` · ${cell.excluded} not applicable`
                                    : "") +
                                  (cell.unjudged > 0
                                    ? ` · ${cell.unjudged} not judged`
                                    : "") +
                                  (cell.cancelled > 0
                                    ? ` · ${cell.cancelled} never ran`
                                    : "") +
                                  (cell.cost_usd > 0
                                    ? ` · $${cell.cost_usd.toFixed(4)}`
                                    : "")
                                : waiting
                                  ? `${cell?.pending} still to run`
                                  : nothingRan
                                    ? "never ran — the run was stopped first"
                                    : "nothing judged"
                            }
                          >
                            {cell?.mean != null ? (
                              <>
                                {formatMean(cell.mean)}
                                {cell.judged < run.config.repetitions && (
                                  // La moyenne ne porte pas sur toutes les
                                  // répétitions : le dire, sinon on la lit
                                  // comme si elle valait autant que ses
                                  // voisines.
                                  <span className="ml-1 text-xs font-normal opacity-70">
                                    ({cell.judged}/{run.config.repetitions})
                                  </span>
                                )}
                              </>
                            ) : waiting ? (
                              "…"
                            ) : nothingRan ? (
                              "∅"
                            ) : (
                              "—"
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-zinc-600">
            {progress.cancelled > 0 && (
              <>
                <strong>∅</strong> marks a cell that never ran — the run was
                stopped before reaching it.{" "}
              </>
            )}
            A cell showing <strong>(2/3)</strong> means its average rests on
            fewer repetitions than were run — some were not applicable, not
            judged, or never ran. Each cell is{" "}
            {/* La phrase suit la lecture en cours : « moyenne » cesse d'être
                vrai dès qu'on choisit une médiane ou un minimum. */}
            {describeView(view, rubric)}, on a {formatValue(min)}–
            {formatValue(max)} scale. The top of the scale is the dark end. A
            hatched cell means nothing could be judged — which is not the same as{" "}
            {formatValue(min)}.
          </p>
        </section>
      )}

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

"use client";

// Ce qu'on lit d'un run — la matrice ouverte case par case, les scénarios, les
// outils, le juge, les trajectoires.
//
// Extrait de la page privée pour que la page publique montre exactement la
// même chose. La version d'avant en donnait une version appauvrie, au motif
// que la lecture seule devait être une propriété du fichier : c'était vrai
// pour l'écriture, et payé par une lecture inférieure alors que lire n'a
// jamais été le danger.
//
// Ce qui protège vraiment n'est pas l'absence de boutons ici mais
// `requireUser()` sur chaque route qui écrit, et `loadPublicRun` sur ce qui se
// lit. Ce fichier ajoute une garantie de plus, tenue par le compilateur : ses
// composants prennent un `PublicRunDetail`, dont le `run` n'a pas de
// `user_email`. Rendre l'adresse de qui a lancé le run est une erreur de
// compilation, pas une vigilance à tenir.
import { useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { ViewControls } from "@/components/ViewControls";
import { cellsOf } from "@/lib/matrix";
import { describeView, viewBounds } from "@/lib/view";
import type { MatrixView } from "@/lib/view";
import { MessageView } from "@/components/MessageView";
import { toolsFor } from "@/lib/tools";
import {
  cellStyle,
  distribution,
  formatMean,
  formatValue,
  rubricBounds,
  sortedRubric,
} from "@/lib/rubric";
import type { PublicRun, PublicRunDetail } from "@/lib/public-run";
import type { EvalSample, RubricLevel } from "@/lib/types";

/** Combien d'essais chaque couple scénario × modèle a déjà : le moins, le plus.
 *
 * Un run complété n'avance pas au même rythme partout — un modèle ajouté en
 * cours de route a moins d'essais que les premiers, et la moyenne d'une case
 * porte alors sur moins de conversations que celle d'à côté. Le dire est le prix
 * d'une matrice qu'on peut agrandir. */
export function repetitionRange(samples: EvalSample[]): [number, number] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const key = `${sample.scenario_index} ${sample.target_model}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = [...counts.values()];
  if (values.length === 0) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}

export function shortModel(id: string): string {
  return id.split("/").pop() ?? id;
}

/** La note d'une tentative, avec le sens que l'échelle lui donne.
 *
 * Le nombre seul ne dit rien : c'est la phrase écrite à côté qui porte le
 * jugement, et la relire ici évite de remonter à l'échelle à chaque tentative. */
export function ScoreBadge({
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

/** Les outils du run, tels qu'ils ont été présentés au modèle.
 *
 * Mot pour mot, description comprise : sans elle on ne peut pas relire une
 * décision d'appel, puisque c'est le seul texte que le modèle avait sous les
 * yeux au moment de décider. Le compte d'appels réels est là parce qu'un outil
 * défini et jamais appelé est un résultat, pas un oubli. */
export function ToolsBlock({ detail }: { detail: PublicRunDetail }) {
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
export function ScenarioModal({
  run,
  index,
  onClose,
}: {
  run: PublicRun;
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

export function JudgeBlock({ detail }: { detail: PublicRunDetail }) {
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

export function DetailModal({
  detail,
  scenarioIndex,
  target,
  loading,
  onClose,
}: {
  detail: PublicRunDetail;
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

export function AttemptView({
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

/** La matrice, telle qu'on la lit — et telle qu'on l'ouvre.
 *
 * Le même tableau sur la page privée et sur la page publique : cliquer un
 * titre ouvre le scénario, cliquer une case ouvre ses tentatives. Les réglages
 * de lecture (moyenne, médiane, échelle repliée) n'écrivent rien et suivent
 * donc les deux.
 *
 * `view` reste à l'appelant : la page privée en a besoin ailleurs, pour
 * exporter le tableau tel qu'il est lu. */
export function RunMatrix({
  detail,
  view,
  onViewChange,
  onOpenScenario,
  onOpenCell,
}: {
  detail: PublicRunDetail;
  view: MatrixView;
  onViewChange: (next: MatrixView) => void;
  onOpenScenario: (index: number) => void;
  onOpenCell: (scenario: number, target: string) => void;
}) {
  const { run, progress } = detail;
  const rubric = run.config.rubric;
  const targets = run.config.models.targets;
  const cells = cellsOf(
    detail.samples,
    run.config.scenarios.length,
    rubric,
    view,
  );
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

  if (cells.length === 0) return null;

  return (

    <section className="space-y-3">
      <h2 className="font-medium">Grade per scenario and model</h2>
      <ViewControls
        rubric={rubric}
        scores={detail.samples
          .map((sample) => sample.score)
          .filter((score): score is number => score !== null)}
        view={view}
        onChange={onViewChange}
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
                    onClick={() => onOpenScenario(index)}
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
                        onClick={() => onOpenCell(index, target)}
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
  );
}

"use client";

// What one reads of a run — the matrix opened cell by cell, the scenarios, the
// tools, the judge, the trajectories.
//
// Taken out of the private page so that the public page shows exactly the same
// thing. The previous version gave an impoverished version of it, on the grounds
// that read-only had to be a property of the file: that was true of writing, and
// paid for by an inferior reading when reading was never the danger.
//
// What really protects is not the absence of buttons here but `requireUser()` on
// every route that writes, and `loadPublicRun` on what is read. This file adds
// one more guarantee, held by the compiler: its components take a
// `PublicRunDetail`, whose `run` has no `user_email`, and whose judges have no
// `created_by` (see `PublicJudge`, `lib/public-run.ts`). Rendering either of
// those two addresses is a compilation error, not a vigilance to keep up.
// `page.tsx` (private) passes a whole `RunDetail` to those same components with
// no conversion: it structurally carries more than they demand, which TypeScript
// already accepts for `run.user_email`.
//
// SINCE THE MULTIPLE JUDGES — `RunDetail.judges` (`lib/types.ts`) is now
// attached for real by `loadRun`/`attachJudges` (`lib/runs.ts`), on demand
// (`withJudges`): see `app/api/runs/[runId]/route.ts`, which always asks for it,
// and `.superpowers/sdd/task-9-report.md` for the whole plumbing. This file
// therefore no longer needs to degrade for a `judges` that is always `undefined`
// — only for the real case of a caller that did not ask for it (a run still
// being opened, or a future lighter caller).
import { useEffect, useState } from "react";
import { Collapsible } from "@/components/Collapsible";
import { Dialog } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ViewControls } from "@/components/ViewControls";
import {
  AWAKE_TYPE,
  AWARENESS_ALARM,
  AWARENESS_VISIBLE,
  awarenessSentence,
  awarenessSummary,
  isAwarenessFlagged,
} from "@/lib/awareness";
import { awarenessJoin, servedSentence, servedSummary } from "@/lib/served";
import {
  fidelitySentence,
  fidelitySummary,
  findFidelityJudge,
} from "@/lib/fidelity";
import { cellsOf } from "@/lib/matrix";
import type { MatrixSample } from "@/lib/matrix";
import { controlRows } from "@/lib/targets";
import { PLAIN_VIEW, withRelative } from "@/lib/view";
import { describeView, viewBounds } from "@/lib/view";
import type { MatrixView } from "@/lib/view";
import { MessageView } from "@/components/MessageView";
import { PromptPreview } from "@/components/PromptPreview";
import { JudgeCardDialog } from "@/components/JudgeCard";
import {
  adversaryPreview,
  awarenessPreview,
  fidelityPreview,
  judgePreview,
} from "@/lib/prompt-preview";
import { served, toolsFor, writesWorld } from "@/lib/tools";
import {
  cellStyle,
  distribution,
  formatMean,
  formatValue,
  heatPosition,
  heatStyle,
  sortedRubric,
} from "@/lib/rubric";
import type { PublicJudge, PublicRun, PublicRunDetail, PublicRunJudgeView } from "@/lib/public-run";
import type {
  EvalSample,
  EvalScenario,
  JudgeVerdictEntry,
  RubricLevel,
  SampleStatus,
} from "@/lib/types";

// --- Multiple judges: reading -----------------------------------------------
//
// The components below are shared by the private page (`RunDetail`, whole
// judges) and the public page (`PublicRunDetail`, `created_by` removed from each
// judge): they therefore take the more restricted of the two types,
// `PublicRunJudgeView`/`PublicJudge` — a whole `RunJudgeView` satisfies it
// structurally already. `JudgeVerdictEntry` (`lib/types.ts`), for its part, does
// not tell the two apart: none of its values names anybody.

/** Waiting: neither graded, nor fallen over. The same default `loadRuns` already
 *  returns for a conversation with no living principal (`principalVerdictsByRun`,
 *  `runs.ts`) — an absence of data is no different, for display, from a judge
 *  that has not yet been through. */
const PENDING_VERDICT: JudgeVerdictEntry = {
  status: "pending",
  score: null,
  justification: "",
  error: null,
};

/** The list's living principal, or `undefined` — `judges` not loaded yet, or an
 *  improbable list with no principal. At most one living principal is guaranteed
 *  in the database (design invariant 1): this function therefore never has to
 *  choose between several candidates. */
export function principalJudge(
  judges: PublicRunJudgeView[] | undefined,
): PublicRunJudgeView | undefined {
  return judges?.find((judge) => judge.is_principal);
}

/** This judge's verdict on this conversation, or the default waiting state if the
 *  judge is absent (`judges` not loaded) or does not have this row yet —
 *  a secondary judge whose identity alone was brought back, without its grades,
 *  included (see `attachJudges`, `lib/runs.ts`). */
export function verdictOf(
  judge: PublicRunJudgeView | undefined,
  sampleId: string,
): JudgeVerdictEntry {
  return judge?.scores[sampleId] ?? PENDING_VERDICT;
}

/** One entry per scenario, for `PromptPreview`'s selector.
 *
 * A judge's prompt opens with the scenario's own system prompt, and the
 * adversary's carries the scenario's own opening message. On a run already
 * played those texts exist, so there is no reason to stand in for them, and
 * every reason not to show one row's prompt as though it were every row's. */
function perScenario(
  scenarios: EvalScenario[],
  build: (scenario: EvalScenario) => ReturnType<typeof judgePreview>,
) {
  return scenarios.map((scenario, index) => ({
    key: `${index}`,
    label: scenario.title || `Scenario ${index + 1}`,
    preview: build(scenario),
  }));
}

/** A short label for a judge, in the list of "other judges".
 *
 * The judge's own name, since it has one. Two screens naming the same judge two
 * different ways would make the library useless as a place to look something
 * up: what is called one thing on `/judges` has to be called that here.
 *
 * The fallbacks below are what the name is derived FROM, kept for a row read
 * before the library existed — a judge whose label never got written, which the
 * `NOT NULL` column makes impossible for anything created since. A system judge
 * keeps its scale in the label here, which the library shows in a column of its
 * own. */
function judgeLabel(judge: PublicJudge): string {
  if (judge.label?.trim()) {
    if (judge.system_type === AWAKE_TYPE) return `${judge.label} (built-in, 1–10)`;
    if (judge.system_type === "faithful_adversary")
      return `${judge.label} (built-in, 1–5)`;
    return judge.label;
  }
  if (judge.system_type === AWAKE_TYPE) return "Eval awareness (built-in, 1–10)";
  if (judge.system_type === "faithful_adversary")
    return "Adversary fidelity (built-in, 1–5)";
  const text = (judge.criterion ?? "").trim();
  if (!text) return "(no criterion)";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** How many attempts each scenario × model pair already has: the fewest, the
 *  most.
 *
 * A completed run does not advance at the same pace everywhere — a model added
 * along the way has fewer attempts than the first ones, and a cell's average then
 * rests on fewer conversations than the one beside it. Saying so is the price of
 * a matrix one can enlarge. */
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

/** A judge's grade on an attempt, with the meaning the scale gives it.
 *
 * The number alone says nothing: it is the sentence written beside it that
 * carries the judgement, and rereading it here saves going back up to the scale
 * on every attempt.
 *
 * Since the multiple judges, the grade no longer lives on the attempt
 * (`EvalSample`) but in a row of `judge_scores`, one per judge — hence `status`
 * (the execution) and `verdict` (THIS judge) kept apart: an attempt that has
 * finished playing may very well have no grade at all from a given judge.
 * `executionError` stays the attempt's, never the judge's — see `EvalSample.error`
 * in `lib/types.ts` for that distinction. */
export function ScoreBadge({
  status,
  verdict,
  rubric,
  higherIsBetter = true,
  executionError,
}: {
  status: SampleStatus;
  verdict: JudgeVerdictEntry;
  rubric: RubricLevel[];
  /** Which end of this judge's scale is the good one — see
   *  `Judge.higher_is_better`. A grade from the awareness judge is coloured the
   *  other way round, and a reader must not have to remember that. */
  higherIsBetter?: boolean;
  executionError?: string | null;
}) {
  if (status === "pending" || status === "running") {
    return (
      <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
        {status === "running" ? "running…" : "queued"}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-900"
        title={executionError ?? undefined}
      >
        failed
      </span>
    );
  }
  if (status === "cancelled") {
    // Not red: we decided not to do it, it did not break.
    return (
      <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700">
        not run
      </span>
    );
  }
  if (verdict.status === "error") {
    // The judge fell over on an otherwise valid conversation — never confused
    // with `status === "error"` above, which is the execution.
    return (
      <span
        className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-900"
        title={verdict.error ?? undefined}
      >
        judge failed
      </span>
    );
  }
  if (verdict.status === "pending" || verdict.score === null) {
    return (
      <span className="rounded border border-dashed border-zinc-400 px-2 py-0.5 text-xs text-zinc-500">
        not judged
      </span>
    );
  }

  const level = rubric.find((one) => one.value === verdict.score);
  const meaning = level?.meaning;

  if (level?.excluded) {
    // The judge answered, but its answer stays out of the average: neither a
    // grade, nor an absence of grade.
    return (
      <span
        className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600"
        title={meaning}
      >
        n/a — {meaning}
      </span>
    );
  }
  // The matrix ramp, on a single grade. A reader who has just clicked through
  // from a green cell must not find its attempts in another set of colours.
  // Always the plain reading: this is one judge's raw grade, and neither a
  // remap nor a deviation applies to it.
  const style = heatStyle(
    heatPosition(verdict.score, rubric, PLAIN_VIEW, higherIsBetter),
  );
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${style}`} title={meaning}>
      {formatValue(verdict.score)}
      {meaning ? ` — ${meaning}` : ""}
    </span>
  );
}

/** The run's tools, as they were presented to the model.
 *
 * Word for word, description included: without it one cannot reread a decision to
 * call, since it is the only text the model had before its eyes at the moment of
 * deciding. The count of real calls is there because a tool defined and never
 * called is a result, not an oversight. */
export function ToolsBlock({ detail }: { detail: PublicRunDetail }) {
  const { config } = detail.run;
  const tools = config.tools ?? [];
  if (tools.length === 0) return null;

  const callCount = (name: string) =>
    detail.samples.reduce(
      (total, sample) =>
        total +
        sample.messages.filter((message) =>
          (message.tool_calls ?? []).some((call) => call.name === name),
        ).length,
      0,
    );

  // Counted here, like `offert` below: a row whose world is nothing but
  // whitespace comes from a field somebody opened and left, and teaches
  // nothing to whoever reads the matrix.
  const ownWorlds = config.scenarios.filter((scenario) =>
    scenario.world?.trim(),
  ).length;

  return (
    <Collapsible
      className="space-y-3 rounded border border-zinc-300 p-4"
      bodyClassName="space-y-3"
      startOpen={false}
      title={<h2 className="eyebrow">Tools the evaluated model could call</h2>}
      aside={
        <span className="text-xs text-zinc-500">
          nothing was executed, up to{" "}
          {config.max_tool_calls_per_turn ?? 5} consecutive calls per turn
        </span>
      }
    >
      {/* The world before the tools that read it, and not elsewhere on the
          page: the three things that only make sense together — what exists,
          the model that serves it, the tools that query it — are read in one
          place. The serving model used to live in the judge block, for want of
          anywhere better; it comes from there. */}
      {config.world?.trim() && (
        <div className="space-y-1 border-b border-zinc-200 pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              The world{" "}
              <span className="font-normal text-zinc-500">
                — what the served tools read
              </span>
            </span>
            {config.models.world?.trim() && (
              <span className="font-mono text-xs text-zinc-500">
                served by {shortModel(config.models.world)}
              </span>
            )}
          </div>
          <pre className="max-h-64 overflow-auto rounded border border-zinc-200 bg-paper p-3 text-xs whitespace-pre-wrap">
            {config.world}
          </pre>
          {/* Without this line the run's world reads as the last word, while
              one row in three corrects it. */}
          {ownWorlds > 0 && (
            <p className="text-xs text-zinc-500">
              {ownWorlds} of {config.scenarios.length} scenario
              {config.scenarios.length > 1 ? "s" : ""}{" "}
              {/* The verb follows how many of them there are, not how many
                  scenarios the run holds: "1 of 12 scenarios adds". Agreeing
                  it with the wrong number of the two reads as a typo. */}
              {ownWorlds > 1 ? "add to or correct" : "adds to or corrects"} this
              world — open a scenario to read its own.
            </p>
          )}
        </div>
      )}

      {tools.map((tool) => {
        const offeredTo = config.scenarios.filter((scenario) =>
          toolsFor(config, scenario).some((entry) => entry.name === tool.name),
        ).length;
        return (
          <div key={tool.name} className="space-y-1 border-t border-zinc-200 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <code className="text-sm font-medium">{tool.name}</code>
              <span className="text-xs text-zinc-500">
                offered to {offeredTo} of {config.scenarios.length} scenarios,
                called {callCount(tool.name)}×
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
            {/* `served(tool)`, never raw `tool.retrieval_rules`: a blank field
                is truthy there. Without this distinction a served tool — whose
                `result` is empty by construction, the exclusion `served` names
                — announced "returns: (empty)" while it had in fact answered
                from the world on every call. */}
            {served(tool) ? (
              <p className="text-xs text-zinc-500">
                reads the world:{" "}
                <span className="font-mono whitespace-pre-wrap">
                  {tool.retrieval_rules}
                </span>
              </p>
            ) : (
              <p className="text-xs text-zinc-500">
                returns: <span className="font-mono">{tool.result || "(empty)"}</span>
              </p>
            )}
            {/* The second axis, beside the first and never in its place: a fixed
                tool that writes shows both lines, and that is the ordinary form of
                the writing tools. */}
            {writesWorld(tool) && (
              <p className="text-xs text-zinc-500">
                changes the world:{" "}
                <span className="font-mono whitespace-pre-wrap">
                  {tool.world_effect}
                </span>
              </p>
            )}
          </div>
        );
      })}
    </Collapsible>
  );
}

/** What defines a row of the matrix, gathered together.
 *
 * "Why this row" is the question one asks in front of a matrix, and the title
 * alone does not answer it — especially over twelve scenarios whose titles
 * resemble one another because they vary on one axis alone. The note answers it;
 * the rest is there to check that it tells the truth.
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
            className="cursor-pointer rounded-full border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
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
              {/* A laboratory note, not an instruction: the model and the judge
                  never see it. Saying so here keeps it from one day being written
                  as if it counted. */}
              Note — for whoever reads the matrix. Neither the model nor the
              judge saw this.
            </p>
            <p className="whitespace-pre-wrap text-sm text-teal-950">
              {scenario.note}
            </p>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
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

        {scenario.world?.trim() && (
          <div>
            <p className="mb-1 text-xs text-zinc-500">
              This row&rsquo;s world — added to the run&rsquo;s, and winning
              over it where the two disagree
            </p>
            <pre className="overflow-x-auto rounded border border-zinc-200 p-3 text-xs whitespace-pre-wrap">
              {scenario.world}
            </pre>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs text-zinc-500">System prompt</p>
          <pre className="overflow-x-auto rounded border border-zinc-200 p-3 text-xs whitespace-pre-wrap">
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
          <pre className="overflow-x-auto rounded border border-zinc-200 p-3 text-xs whitespace-pre-wrap">
            {scenario.opening_message}
          </pre>
        </div>
      </div>
    </Dialog>
  );
}

/** A row for a secondary or system judge, in the list of "other judges" — never
 *  the principal, already shown by the block surrounding it.
 *
 * `onUnlink`/`onView` absent: pure reading, which is what keeps this component
 * usable from the public page — see `JudgeBlock`. "View" never appears for a
 * system judge: its question does not come from the user and its scale is fixed
 * (see the design, section « Les juges système ») — showing it would have the
 * matrix read on a question nobody wrote. The button that writes — "Make
 * principal" — has migrated into `JudgeBlock`, onto the judge shown rather than
 * onto each row: see its comment. */
/** What unlinking costs, said once for both paths — the secondary judge right
 *  here, the principal in `PrincipalUnlink`.
 *
 * The three sentences are checked, not assumed:
 *
 * - **No way back**: `run_judges_unlink` sets `deleted_at`, and nothing puts it
 *   back to null — neither the application, nor the MCP. The row stays in the
 *   database so that one knows this run was judged by that judge, but no gesture
 *   brings it back.
 * - **The grades do not come back**: they are not erased either (the
 *   `on delete cascade` foreign key exists and never fires, see the comment on
 *   `run_judges.deleted_at`), but nothing shows them any more — the reading
 *   filters on the living bindings. Laying the same judge down again creates a
 *   FRESH binding, whose verdicts start out waiting and are paid for over.
 * - **A copy does not carry it**: duplicating a run derives its configuration
 *   from the living bindings (`withLiveJudges`, called by `app/page.tsx`), so an
 *   unlinked judge no longer figures there. */
function UnlinkConsequences() {
  return (
    <ul className="bullets space-y-1">
      <li>This cannot be undone — there is no way to link it back.</li>
      <li>
        Its grades stop showing anywhere: the matrix, the trajectories, the
        export, the MCP. Adding the same judge again starts a fresh one, whose
        verdicts have to be paid for over.
      </li>
      <li>A new run duplicated from this one will not carry this judge.</li>
    </ul>
  );
}

function OtherJudgeRow({
  judge,
  scenarios,
  adversaryPrompt,
  onOpenJudge,
  viewing,
  isPrincipal = false,
  onUnlink,
  onView,
}: {
  judge: PublicRunJudgeView;
  /** The run's scenarios, so a system judge can show the prompt it really
   *  received. An ordinary judge shows its own through `JudgeBlock`, on being
   *  viewed; a system judge can never be viewed, so this row is the only place
   *  its prompt can be read at all. */
  scenarios: EvalScenario[];
  /** The run's adversary objective, for the fidelity judge's prompt. Empty on a
   *  single-turn run, which never carries that judge. */
  adversaryPrompt: string;
  /** Opens the judge's own card. Absent on a surface with no window to open it
   *  in. */
  onOpenJudge?: (judgeId: string) => void;
  /** This judge is the one being looked at right now — a purely local choice (see
   *  `JudgeBlock`), never written to the database. */
  viewing: boolean;
  /** The principal figures in this list like the others, so that one can COME BACK
   *  to it after having looked at another: without it, once gone off to a
   *  secondary, nothing brought one back — it left the screen entirely. It has no
   *  "Unlink" button here: unlinking it demands designating a replacement, which
   *  `PrincipalUnlink` does above, with its selector. */
  isPrincipal?: boolean;
  onUnlink?: (runJudgeId: string) => Promise<void>;
  onView?: (runJudgeId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Unlinking cannot be taken back, and the button was one click away: ask first.
  // The principal already has a step of its own — see `PrincipalUnlink`, which
  // says the same consequences through the same function.
  const [asking, setAsking] = useState(false);

  const unlink = async () => {
    if (!onUnlink) return;
    setBusy(true);
    setFailed(null);
    try {
      await onUnlink(judge.run_judge_id);
      setAsking(false);
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 py-2 text-sm first:border-t-0">
      <div className="space-y-1">
        <span className="font-mono text-xs text-zinc-500">
          {shortModel(judge.model)}
        </span>{" "}
        {/* The name opens the judge itself: the question, the scale, the exact
            prompt, and every other run it grades. This row used to give a
            criterion and a model, with no name and no handle, so a judge read
            about in the library was not recognisable as the same object. */}
        <button
          onClick={() => onOpenJudge?.(judge.judge.id)}
          className="cursor-pointer text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900"
        >
          {judgeLabel(judge.judge)}
        </button>
        {judge.system_type !== "ordinary" && (
          <span className="ml-1 rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500">
            system
          </span>
        )}
        {/* Which way this judge's scale runs, on the row that lists it. Said
            only when it is the unusual answer: a badge on every judge would
            teach a setting where there is nothing to notice, and the point here
            is that one judge of this run reads upside down from the others. */}
        {judge.judge.higher_is_better === false && (
          <span
            className="ml-1 rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500"
            title="Higher is worse on this judge: the top of its scale is what should worry you, and the matrix paints it rust."
          >
            higher is worse
          </span>
        )}
        {isPrincipal && (
          <span className="ml-1 rounded bg-zinc-900 px-1 py-0.5 text-[10px] text-paper">
            principal
          </span>
        )}
        {judge.system_type === AWAKE_TYPE && (
          // The one judge whose question nobody on this run wrote. It cannot be
          // selected for display, so without this link its prompt is readable
          // nowhere at all.
          <div>
            <PromptPreview
              label="See the exact prompt this judge received"
              note="This judge's question and its 1 to 10 scale come from the tool and are the same in every run."
              variants={perScenario(scenarios, (scenario) =>
                awarenessPreview(
                  judge.judge.sees_system_prompt !== false,
                  scenario.system_prompt,
                ),
              )}
            />
          </div>
        )}
        {judge.system_type === "faithful_adversary" && (
          // The only judge that receives the adversary's objective. Somebody
          // reading a fidelity grade cannot tell what it was compared against
          // without this.
          <div>
            <PromptPreview
              label="See the exact prompt this judge received"
              note="This judge grades the adversary, not the evaluated model. It is the only judge given the adversary's objective, on a 1 to 5 scale that comes from the tool."
              variants={perScenario(scenarios, (scenario) =>
                fidelityPreview(
                  adversaryPrompt,
                  judge.judge.sees_system_prompt !== false,
                  scenario.system_prompt,
                ),
              )}
            />
          </div>
        )}
      </div>
      {(onUnlink || onView) && (
        <div className="flex items-center gap-2">
          {/* Every judge, built-in ones included: what stopped them was that
              nobody knew which end of their scale was the good one, and the
              judge itself now says (`higher_is_better`). */}
          {onView && (
            viewing ? (
              <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-paper">
                Viewing
              </span>
            ) : (
              <button
                onClick={() => onView(judge.run_judge_id)}
                className="cursor-pointer rounded-full border px-2 py-0.5 text-xs hover:bg-zinc-100"
              >
                View
              </button>
            )
          )}
          {onUnlink && !isPrincipal && (
            <button
              onClick={() => setAsking(true)}
              disabled={busy}
              className="cursor-pointer rounded-full border border-red-300 px-2 py-0.5 text-xs text-red-800 hover:bg-red-50 disabled:opacity-50"
            >
              {busy ? "Working…" : "Unlink"}
            </button>
          )}
        </div>
      )}
      {failed && (
        <p role="alert" className="w-full text-xs text-red-700">
          {failed}
        </p>
      )}
      <ConfirmDialog
        open={asking}
        // A short, fixed title: a criterion often ends with a question mark, and
        // pasting it into the title produced two.
        // The question this judge puts is in the body, where it has the room.
        title="Unlink this judge?"
        confirmLabel="Unlink this judge"
        tone="warning"
        busy={busy}
        onConfirm={unlink}
        onCancel={() => setAsking(false)}
      >
        <p className="mb-2">
          <span className="font-mono text-xs text-zinc-500">
            {shortModel(judge.model)}
          </span>{" "}
          <span className="text-zinc-700">{judgeLabel(judge.judge)}</span>
        </p>
        <UnlinkConsequences />
      </ConfirmDialog>
    </div>
  );
}

/** The button that makes the shown judge the principal — this file's only write
 *  on that subject, see the `.../judges/[id]/principal` route (`lib/runs.ts`,
 *  `designatePrincipal`). Appears only in `JudgeBlock`, and only when one is
 *  already looking at a judge that is not the principal: looking is not deciding,
 *  but this button is the explicit gesture that moves from one to the other. A
 *  refusal from the database (the base of an already unlinked judge, by somebody
 *  else in the meantime for instance) arrives already translated into readable
 *  English — see `designatePrincipal`, which classifies the Postgres refusal
 *  through `run-judges-refusal.ts` before it reaches this route. */
function MakePrincipalButton({
  runJudgeId,
  onDesignatePrincipal,
}: {
  runJudgeId: string;
  onDesignatePrincipal: (runJudgeId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await onDesignatePrincipal(runJudgeId);
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="cursor-pointer rounded-full border border-amber-400 bg-paper px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
      >
        {busy ? "Working…" : "Make principal"}
      </button>
      {failed && (
        <p role="alert" className="text-xs text-red-700">
          {failed}
        </p>
      )}
    </div>
  );
}

/** Unlink the principal — always an ordinary judge — with the replacement the
 *  database trigger demands in the same gesture. The replacement must itself be
 *  ordinary: a system judge (the awareness one) cannot become principal, its
 *  question and its scale not belonging to the user (see `judgeLabel`) —
 *  offering it would preselect a choice that silently breaks the screen.
 *
 * A run always keeps at least one living ordinary judge: unlinking the last one
 * is not allowed, neither here nor in the database. With no other ORDINARY judge
 * to take over, this component therefore offers nothing to click — only the
 * explanation; the only path is to add an ordinary judge first.
 *
 * Appears only if `onUnlink` is provided — never on the public page. */
function PrincipalUnlink({
  principal,
  others,
  onUnlink,
}: {
  principal: PublicRunJudgeView;
  others: PublicRunJudgeView[];
  onUnlink: (runJudgeId: string, replacementRunJudgeId?: string) => Promise<void>;
}) {
  const ordinaryOthers = others.filter((judge) => judge.system_type === "ordinary");

  const [open, setOpen] = useState(false);
  const [replacement, setReplacement] = useState(ordinaryOthers[0]?.run_judge_id ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Nothing to click: say why rather than greying out with no explanation.
  if (ordinaryOthers.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        This is the run&apos;s only ordinary judge — a run always keeps at
        least one. Add another ordinary judge before unlinking this one.
      </p>
    );
  }

  const confirm = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await onUnlink(principal.run_judge_id, replacement);
      setOpen(false);
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="cursor-pointer text-xs link-underline"
      >
        Unlink this judge…
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
      <p className="text-xs text-amber-900">
        {/* The deferred trigger refuses to unlink the principal with no replacement
            as long as other living judges remain — see the comment on
            `unlinkJudge`, `lib/runs.ts`. Choosing one here is therefore compulsory,
            not a mere convenience. */}
        This judge is the principal — the matrix follows it. Choose who
        takes over before unlinking it.
      </p>
      <div className="text-xs text-amber-900">
        <UnlinkConsequences />
      </div>
      <select
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
        className="rounded border border-olive bg-paper p-1 text-xs"
      >
        {ordinaryOthers.map((other) => (
          <option key={other.run_judge_id} value={other.run_judge_id}>
            {shortModel(other.model)} — {judgeLabel(other.judge)}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <button
          onClick={confirm}
          disabled={busy}
          className="cursor-pointer rounded-full bg-zinc-900 px-2 py-1 text-xs text-paper hover:bg-chartreuse hover:text-ink disabled:opacity-50"
        >
          {busy ? "Working…" : "Unlink and hand over"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="cursor-pointer text-xs link-underline"
        >
          cancel
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-xs text-red-700">
          {failed}
        </p>
      )}
    </div>
  );
}

/** What a run says about itself, under its matrix.
 *
 * Three checks on whether the numbers above can be read at all, and not one of
 * them a result: whether the models sensed the setting, whether the adversary
 * pushed the way it was told to, and whether the served tools answered
 * faithfully. Each keeps quiet when it has nothing to say, because a run that
 * never asked for a check must not show a reassuring zero for it.
 *
 * Under the matrix, and no longer inside "What the judge was asked". They are
 * about the run rather than about the judge, and that box arrives folded now: a
 * validity warning behind a chevron is a validity warning nobody reads. */
export function RunSignals({ detail }: { detail: PublicRunDetail }) {
  const judges = detail.judges;
  // The eval-awareness indicator: one figure for the whole run, computed here
  // rather than in a separate header so that it shows the same way on the private
  // page and on the public page, which share this component but do not have the
  // same header. When it sounds, one goes down into the conversations — hence the
  // fact that it does not say which. The run's `awake` binding, if the run has one
  // — see `findAwakeJudge`, `lib/awareness.ts`, whose generic constraint no longer
  // accepts `RunJudgeView`: `AWAKE_TYPE` alone, as `lib/runs.ts` already does for
  // the same reason.
  const awake = judges?.find((judge) => judge.system_type === AWAKE_TYPE);

  const awareness = awarenessSummary(awake ? Object.values(awake.scores) : []);
  const awarenessPhrase = awarenessSentence(awareness);

  // The adversary-fidelity indicator, beside it and read the same way. Silent
  // on the runs that did not ask for this judge, which is most of them. Its
  // scale runs the other way from the awareness one: low is the alarm, see
  // `lib/fidelity.ts`.
  const fidelityLink = findFidelityJudge(judges ?? []);
  const fidelity = fidelitySummary(
    fidelityLink ? Object.values(fidelityLink.scores) : [],
  );
  const fidelityPhrase = fidelitySentence(fidelity);

  // The served-results indicator, right beside the awareness one — and crossed
  // with it, which is its whole point. A high awareness grade is otherwise a dead
  // end: one knows the model sensed something, one does not know what. Silent on a
  // run that served no tool.
  const toolResults = detail.tool_results ?? [];
  const served = servedSummary(toolResults);
  // The transcripts are loaded on demand only. Without them, one does not know
  // which conversation saw which result: the crossing keeps quiet rather than
  // announcing zero, which would read as "none" instead of "we do not know".
  const canCrossCheck = detail.samples.some(
    (sample) => (sample.messages ?? []).length > 0,
  );
  const servedJoin = awarenessJoin(
    detail.samples.map((sample) => ({
      scenario_index: sample.scenario_index,
      transcript: sample.messages ?? [],
      awake: Boolean(
        awake && awake.scores[sample.id] && isAwarenessFlagged(awake.scores[sample.id]),
      ),
    })),
    toolResults,
  );
  const servedPhrase = servedSentence(served, canCrossCheck ? servedJoin : null);

  return (
    <div className="space-y-1">
      {awarenessPhrase && (
        <p
          className={
            awareness.flagged > 0
              ? "text-sm font-medium text-amber-700"
              : "text-sm text-zinc-500"
          }
        >
          {awarenessPhrase}
        </p>
      )}

      {fidelityPhrase && (
        <p
          className={
            fidelity.drifted > 0
              ? "text-sm font-medium text-amber-700"
              : "text-sm text-zinc-500"
          }
        >
          {fidelityPhrase}
        </p>
      )}

      {servedPhrase && (
        <p
          className={
            served.unfaithful > 0 || served.couldNotCheck > 0
              ? "text-sm font-medium text-amber-700"
              : "text-sm text-zinc-500"
          }
        >
          {servedPhrase}
        </p>
      )}
    </div>
  );
}

/** What the SHOWN judge was charged with looking at — the principal by default,
 *  another ordinary judge if one chose to look at it — and access to the run's
 *  other undeleted judges.
 *
 * Looking is not deciding: `displayedRunJudgeId`/`onSelectDisplayed` change what
 * this screen shows, never what the database holds as principal. It is
 * `onDesignatePrincipal` that writes, and only when one asks for it explicitly —
 * see `MakePrincipalButton`, which appears only when the shown judge is not the
 * principal.
 *
 * `onUnlink`/`onDesignatePrincipal`/`onSelectDisplayed`: present only on the
 * private screen (`app/eval/[runId]/page.tsx`) — the public page, through
 * `SharedRunView.tsx`, calls this component without them: no selector and no
 * write button, exactly like the rest of this file (see its header). It therefore
 * never shows anything but the principal.
 *
 * `detail.judges` absent (see this file's header): this block falls back on
 * `config.criterion`/`config.rubric`/`config.models.judge` and shows no other
 * judge — the behaviour from before the multiple judges, to the letter. */
export function JudgeBlock({
  detail,
  onUnlink,
  onDesignatePrincipal,
  displayedRunJudgeId,
  onSelectDisplayed,
}: {
  detail: PublicRunDetail;
  onUnlink?: (runJudgeId: string, replacementRunJudgeId?: string) => Promise<void>;
  onDesignatePrincipal?: (runJudgeId: string) => Promise<void>;
  /** The judge being looked at right now. `undefined`, or an identifier that no
   *  longer designates a living ordinary judge of this run (unlinked in the
   *  meantime, or never valid), falls back on the principal — never a blank page. */
  displayedRunJudgeId?: string;
  /** Changes `displayedRunJudgeId` at the caller's. Absent: no selector, and this
   *  block then never shows anything but the principal. */
  onSelectDisplayed?: (runJudgeId: string) => void;
}) {
  const { config } = detail.run;
  const [showOthers, setShowOthers] = useState(false);

  const judges = detail.judges;
  const principal = principalJudge(judges);
  const others = (judges ?? []).filter(
    (judge) => judge.run_judge_id !== principal?.run_judge_id,
  );

  // The shown judge: the one chosen locally if it still lives and stays ordinary,
  // otherwise the principal. A reading choice, never a write — it is lost on
  // reload and changes nothing for anybody else.
  // A system judge may be viewed like any other since it carries the direction
  // of its own scale (`higher_is_better`). It still cannot become principal:
  // the banner below drops that offer rather than the whole banner.
  //
  // A run always keeps at least one living ordinary judge — `PrincipalUnlink`
  // further down refuses to unlink the last one — so `principal` should never be
  // missing. If it is missing all the same (an inconsistency, a run migrated from
  // the old world), fall back on the first living ordinary judge rather than on
  // nothing: that is what lets the banner below stay actionable rather than
  // disappearing along with the one gesture that repairs the situation.
  const displayedJudge =
    others.find((judge) => judge.run_judge_id === displayedRunJudgeId) ??
    principal ??
    others.find((judge) => judge.system_type === "ordinary");
  // True only if a principal exists AND it is the one being looked at.
  // A principal should always exist (see above): the `principal === undefined`
  // case is not supposed to happen, but if it does arise it must show — never
  // silently pass for "we are already looking at the principal", which would hide
  // precisely the "Make principal" banner that lets one get out of it.
  const viewingPrincipal =
    principal !== undefined && displayedJudge?.run_judge_id === principal.run_judge_id;

  // The shown judge is authoritative once attached — it may differ from `config`
  // if another judge has taken over the title since the launch, or if one chose to
  // look at another. Without it, `config` stays the only source, as before the
  // Which judge's card is open, if any. One window for the whole block: the
  // list below can hold a dozen rows, and one dialog each would mount a dozen
  // to show one.
  const [openJudge, setOpenJudge] = useState<string | null>(null);

  // multiple judges.
  const judgeModel = displayedJudge?.model ?? config.models.judge;
  const criterion = displayedJudge?.judge.criterion ?? config.criterion;
  const rubric = displayedJudge?.judge.rubric ?? config.rubric;
  // Which end of that judge's scale is the good one. Absent on a judge read
  // back from a run recorded before the column existed: `true`, the convention
  // it was written under.
  const higherIsBetter = displayedJudge?.judge.higher_is_better !== false;

  return (
    <>
      <Collapsible
        className="space-y-3 rounded border border-zinc-300 p-4"
        bodyClassName="space-y-3"
        startOpen={false}
        title={<h2 className="eyebrow">What the judge was asked</h2>}
        aside={
          <span className="font-mono text-xs text-zinc-500">
            {viewingPrincipal ? "judged by " : "viewing "}
            {shortModel(judgeModel)}
            {!viewingPrincipal && " — not the principal"}
            {detail.run.rejudged_at && ", re-judged since the run"}
            {detail.run.awareness_judged_at && ", eval-awareness added after the run"}
          </span>
        }
      >
        {/* The model serving the world was announced here for want of
            anywhere better — under a grading criterion, where nothing said
            what it was doing. It has moved next to the world it serves, in
            `ToolsBlock`, and this block now speaks only of the judge. */}
        <p className="whitespace-pre-wrap text-sm text-zinc-800">{criterion}</p>

        <table className="text-sm">
          <tbody>
            {sortedRubric(rubric).map((level) => (
              <tr key={level.value}>
                <td className="py-0.5 pr-3 text-right align-top font-mono text-xs text-zinc-500">
                  {formatValue(level.value)}
                </td>
                <td className="py-0.5 align-top">{level.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Said in words, and not only in colour. This judge is now one you can
            view as a matrix, and the awareness one reads upside down: without
            this line its 10 looks like a good result to anyone who has not
            noticed the ramp running the other way. */}
        {!higherIsBetter && (
          <p className="text-xs text-zinc-500">
            On this judge the top of the scale is what should worry you, so the
            matrix paints it rust and its bottom olive.
          </p>
        )}

        {/* The whole text this judge was handed, and not only the part
            somebody typed. It is what answers "why did it grade like that" six
            months later, when the criterion on screen looks unimpeachable and
            the prompt around it turns out to be where the answer was. */}
        <PromptPreview
          label="See the exact prompt this judge received"
          note={
            (displayedJudge?.judge.sees_system_prompt === false
              ? "This judge was not shown the scenario's system prompt. "
              : "") +
            "The criterion and the scale sit inside a prompt that already tells the judge to grade the assistant and not the user. The transcript is stood in for; the rest is word for word."
          }
          variants={perScenario(config.scenarios, (scenario) =>
            judgePreview(
              {
                criterion: criterion ?? "",
                rubric: rubric ?? [],
                sees_system_prompt:
                  displayedJudge?.judge.sees_system_prompt ?? true,
              },
              scenario.system_prompt,
            ),
          )}
        />

        {/* Looking is not deciding: this banner says nothing as long as one is
            looking at the principal, but as soon as one looks at another judge it
            says which of the two gestures is being made — and that the export and
            the MCP tools, for their part, follow the principal alone, never what one
            chose to look at here. */}
        {!viewingPrincipal && displayedJudge && (
          <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <p>
              You are viewing {shortModel(displayedJudge.model)}, not
              this run&apos;s principal — the matrix below follows what you
              view, but the export and the MCP tools still follow the
              principal.
            </p>
            {/* Not offered on a built-in judge: its question is not the
                user's, and the database refuses it as principal. */}
            {onDesignatePrincipal && displayedJudge.system_type === "ordinary" && (
              <MakePrincipalButton
                runJudgeId={displayedJudge.run_judge_id}
                onDesignatePrincipal={onDesignatePrincipal}
              />
            )}
          </div>
        )}

        {onUnlink && principal && (
          <PrincipalUnlink principal={principal} others={others} onUnlink={onUnlink} />
        )}

        {/* By default one sees only the principal, as before the multiple judges —
            see the design, section « L'écran ». `others` empty (no other judge, or
            `detail.judges` not provided yet): nothing behind the button, so it
            serves no purpose. It is here that the display selector lives — an
            ordinary judge of this list becomes the shown judge on clicking "View",
            writing nothing. */}
        {/* The list carries ALL the run's judges, the principal at the head.
            Excluding it was a dead end: "View" existed only for the others, so that
            once gone off to a secondary nothing brought one back to the principal —
            it left the screen entirely. It therefore figures there like the others,
            marked, with its own "View"; what it does not have here is "Unlink",
            which demands a replacement and lives above in `PrincipalUnlink`. */}
        {others.length > 0 && (
          <div className="border-t border-zinc-200 pt-2">
            <button
              onClick={() => setShowOthers((visible) => !visible)}
              className="cursor-pointer text-xs link-underline"
            >
              {showOthers ? "Hide" : "Show all"} {judges?.length ?? 0} judge
              {(judges?.length ?? 0) > 1 ? "s" : ""}
            </button>
            {showOthers && (
              <div className="mt-2 space-y-1">
                {(principal ? [principal, ...others] : others).map((judge) => (
                  <OtherJudgeRow
                    key={judge.run_judge_id}
                    judge={judge}
                    scenarios={config.scenarios}
                    adversaryPrompt={config.adversary_prompt ?? ""}
                    onOpenJudge={setOpenJudge}
                    viewing={displayedJudge?.run_judge_id === judge.run_judge_id}
                    isPrincipal={judge.run_judge_id === principal?.run_judge_id}
                    onUnlink={onUnlink}
                    onView={onSelectDisplayed}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Collapsible>

      <JudgeCardDialog judgeId={openJudge} onClose={() => setOpenJudge(null)} />
    </>
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
  // The principal is authoritative for this window's scale — the same fallback as
  // `JudgeBlock` when `detail.judges` is not provided yet.
  const rubric = principalJudge(detail.judges)?.judge.rubric ?? detail.run.config.rubric;

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
        className="w-full max-w-3xl space-y-5 rounded border border-olive bg-paper p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{scenario?.title}</h2>
            <p className="text-sm text-zinc-600">
              {shortModel(target)}, {attempts.length} attempt
              {attempts.length > 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm link-underline"
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

        {/* What this cell really had to hand: a scenario may have received no tool
            when the others have them all, and that is often the comparison one is
            after. With the description, without which one cannot reread a decision
            to call. */}
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
            {/* The objective above is what somebody typed. What left is that
                text wrapped, before and after, in a confidentiality notice and
                three realism rules nobody on the form wrote, and closed with
                this scenario's opening message. Reading an adversary's turns
                without knowing that is reading half the instructions. */}
            <div className="mt-2">
              <PromptPreview
                dark
                label="See the exact prompt the adversary received"
                note="The objective above sits inside a confidentiality notice, repeated before and after it, followed by three realism rules and this scenario's opening message."
                preview={adversaryPreview(
                  detail.run.config.adversary_prompt,
                  scenario?.opening_message,
                )}
              />
            </div>
          </div>
        )}

        {loading && (
          <p className="text-sm text-zinc-500">Loading the transcripts…</p>
        )}

        {attempts.map((attempt) => (
          <AttemptView
            key={attempt.id}
            attempt={attempt}
            judges={detail.judges}
            rubric={rubric}
            runTurns={detail.run.config.turns}
          />
        ))}
      </div>
    </div>
  );
}

export function AttemptView({
  attempt,
  judges,
  rubric,
  runTurns,
}: {
  attempt: EvalSample;
  /** All the run's living judges, with their verdict on each conversation — see
   *  `RunJudgeView` (`lib/types.ts`). `undefined` when the caller did not ask for
   *  that join (see `loadRun`'s `withJudges`): this view then falls back on the
   *  default waiting state for the principal, and shows no other judge. */
  judges: PublicRunJudgeView[] | undefined;
  rubric: RubricLevel[];
  /** The depth the run asked for, so as to flag only the attempts that depart from
   *  it — see the comment on `turns_done` further down. */
  runTurns: number;
}) {
  // Folded by default: ten repetitions of ten turns would make a wall of text
  // where one no longer finds the attempt one was after.
  const [open, setOpen] = useState(false);

  const principal = principalJudge(judges);
  const principalVerdict = verdictOf(principal, attempt.id);
  const awake = judges?.find((judge) => judge.system_type === AWAKE_TYPE);
  const awakeVerdict = awake ? verdictOf(awake, attempt.id) : null;
  // This run's undeleted judges, except the principal (already shown above) and
  // the awareness one (dealt with apart, with its own visibility threshold) — it
  // is that list an unfolded conversation must still show so as to hold the
  // design's "all the undeleted judges".
  const others = (judges ?? []).filter(
    (judge) => judge.run_judge_id !== principal?.run_judge_id && judge !== awake,
  );

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
        <ScoreBadge
          status={attempt.status}
          verdict={principalVerdict}
          rubric={rubric}
          executionError={attempt.error}
        />
        {/* Two different things, and they used to wear the same badge.
            Worse, it fired on any assistant turn without text, which is the
            ordinary shape of a turn that calls a tool: every agentic run
            announced a censorship that never happened.

            `blocked` mirrors what the engine decides (`blocking_reason`,
            `scoring.py`): no turn ever produced text or a tool call, so there
            is nothing to grade and no judge was called.

            `filtered` is a turn the provider stopped in a conversation that
            carried on afterwards. The attempt is graded, and it still matters:
            the model was cut off at a point that may be the one you were
            measuring. */}
        {(() => {
          const answered = attempt.messages.some(
            (m) =>
              m.role === "assistant" &&
              (m.content.trim() !== "" || (m.tool_calls ?? []).length > 0),
          );
          const filtered = attempt.messages.filter(
            (m) => m.role === "assistant" && m.stop_reason === "content_filter",
          ).length;
          if (!answered && filtered > 0) {
            return (
              <span
                className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900"
                title="The provider's content filter stopped every response. The model neither refused nor gave in, so no judge was called on this attempt."
              >
                blocked
              </span>
            );
          }
          if (filtered > 0) {
            return (
              <span
                className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600"
                title={`The provider's content filter stopped ${filtered} response${filtered > 1 ? "s" : ""}, and the conversation carried on. This attempt was graded; read it before quoting it, since the model was cut off somewhere.`}
              >
                filtered ×{filtered}
              </span>
            );
          }
          return null;
        })()}
        {attempt.temperature !== null && (
          <span className="text-xs text-zinc-500">
            temperature {attempt.temperature.toFixed(2)}
          </span>
        )}
        {attempt.turns_done !== null && attempt.turns_done !== runTurns && (
          // A piece of information, not a reservation: this attempt settled before
          // the run's depth, and pushing it further would have taught nothing — it
          // is even the question one puts to a run of this kind. Silent when the
          // attempt went as far as the run: the run's header says so already, and
          // repeating it teaches nothing.
          <span className="text-xs text-zinc-500">
            settled at {attempt.turns_done} turn
            {attempt.turns_done > 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto text-xs text-zinc-500">
          {attempt.cost_usd !== null && attempt.cost_usd > 0 && (
            <>${attempt.cost_usd.toFixed(4)}, </>
          )}
          {attempt.messages.length} message
          {attempt.messages.length > 1 ? "s" : ""}
        </span>
      </button>

      {/* The principal judge's justification stays visible when folded: it is what
          says whether this attempt is worth opening. */}
      {principalVerdict.justification && (
        <p className="px-3 pb-3 text-sm text-zinc-700">
          <span className="font-medium">Judge:</span> {principalVerdict.justification}
        </p>
      )}
      {principalVerdict.error && (
        <p className="px-3 pb-3 text-sm text-red-800">{principalVerdict.error}</p>
      )}

      {/* Folded, the awareness grade shows only above the visibility threshold, and
          the judge's failure in grey: in the vast majority of attempts there is
          nothing to say, and writing it everywhere would drown the one case that
          counts. Unfolded, the judge's answer shows whatever the grade — a 1
          included, which means "no sign at all": it is an answer the user asked to
          be able to read, not only those that raise the alarm. Below the alarm
          threshold, the grade stays readable but in a neutral tone — it is the band
          the review judged too vague to assert anything; the amber stays reserved
          for the grades that made the run's indicator sound. */}
      {awakeVerdict?.error ? (
        <p className="px-3 pb-3 text-xs text-zinc-400">
          Eval-awareness judge failed: {awakeVerdict.error}
        </p>
      ) : typeof awakeVerdict?.score === "number" &&
        (open || awakeVerdict.score >= AWARENESS_VISIBLE) ? (
        <p
          className={
            awakeVerdict.score >= AWARENESS_ALARM
              ? "px-3 pb-3 text-sm font-medium text-amber-700"
              : "px-3 pb-3 text-sm text-zinc-600"
          }
        >
          <span className="font-semibold">
            Eval awareness {awakeVerdict.score}/10:
          </span>{" "}
          {awakeVerdict.justification}
        </p>
      ) : null}

      {/* An unfolded conversation shows the verdict of ALL the undeleted judges —
          the principal and the awareness one are already above, whatever the state
          of opening; the secondary judges appear only here, once unfolded, like the
          rest of the conversation. */}
      {open && others.length > 0 && (
        <div className="space-y-2 border-t border-zinc-200 p-3">
          <p className="text-xs font-medium text-zinc-500">Other judges</p>
          {others.map((judge) => {
            const verdict = verdictOf(judge, attempt.id);
            return (
              <div key={judge.run_judge_id} className="space-y-0.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-zinc-500">
                    {shortModel(judge.model)}
                  </span>
                  <ScoreBadge
                    status={attempt.status}
                    verdict={verdict}
                    rubric={judge.judge.rubric ?? []}
                    higherIsBetter={judge.judge.higher_is_better}
                  />
                </div>
                {verdict.justification && (
                  <p className="text-zinc-700">{verdict.justification}</p>
                )}
                {verdict.error && <p className="text-red-800">{verdict.error}</p>}
              </div>
            );
          })}
        </div>
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

/** The matrix, as one reads it — and as one opens it.
 *
 * The same table on the private page and on the public page: clicking a title
 * opens the scenario, clicking a cell opens its attempts. The reading settings
 * (average, median, folded scale) write nothing and therefore follow both.
 *
 * `view` stays the caller's: the private page needs it elsewhere, so as to export
 * the table as it is read. */
export function RunMatrix({
  detail,
  view,
  onViewChange,
  onOpenScenario,
  onOpenCell,
  displayedRunJudgeId,
}: {
  detail: PublicRunDetail;
  view: MatrixView;
  onViewChange: (next: MatrixView) => void;
  onOpenScenario: (index: number) => void;
  onOpenCell: (scenario: number, target: string) => void;
  /** The judge one chose to look at — see `JudgeBlock`, which carries the
   *  selector. `undefined`, or an identifier that no longer designates a living
   *  ordinary judge of this run, falls back on the principal: that is what this
   *  matrix shows by default, and what the public caller (`SharedRunView.tsx`,
   *  which never passes this prop) always shows. */
  displayedRunJudgeId?: string;
}) {
  const { run, progress } = detail;
  const principal = principalJudge(detail.judges);
  // The shown judge is authoritative for the scale: two judges may have written
  // different scales, and a cell only reads in the light of the one belonging to
  // the judge whose grade it shows. The same fallback as `JudgeBlock` as long as
  // `detail.judges` is not provided yet, or `displayedRunJudgeId` no longer
  // designates anything living.
  const displayedJudge =
    detail.judges?.find((judge) => judge.run_judge_id === displayedRunJudgeId) ??
    principal;
  const rubric = displayedJudge?.judge.rubric ?? run.config.rubric;
  // Which end of that judge's scale is the good one. `!== false` rather than a
  // plain read: a judge stored before the column existed carries nothing, and
  // it was written under the convention this defaults to.
  const higherIsBetter = displayedJudge?.judge.higher_is_better !== false;
  const targets = run.config.models.targets;
  // The run's `awake` binding, for the cells' awareness badge — the same inline
  // search as `JudgeBlock` (see its comment on `findAwakeJudge`).
  const awake = detail.judges?.find((judge) => judge.system_type === AWAKE_TYPE);
  // The matrix follows the SHOWN judge — the principal by default, or the one
  // chosen in `JudgeBlock` — never another undeleted judge one did not ask to see.
  // A reading choice, never a write: nothing here changes what the database holds
  // as principal, nor what the export or the MCP tools will read — see the design,
  // section « L'écran », and the head comment of `lib/matrix.ts`, which does not
  // have to know that this field may now carry a judge other than the real
  // principal. `awake` travels apart: it is a different judge on the same
  // conversation, and each cell's awareness badge does not depend on what the shown
  // judge decided.
  const matrixSamples: MatrixSample[] = detail.samples.map((sample) => ({
    scenario_index: sample.scenario_index,
    target_model: sample.target_model,
    status: sample.status,
    cost_usd: sample.cost_usd,
    principal: verdictOf(displayedJudge, sample.id),
    awake: awake ? verdictOf(awake, sample.id) : undefined,
  }));
  // The DISPLAYED judge's targets, like the scale just above: the same row can
  // be a control for the principal and an ordinary row for another judge, and a
  // distance only reads in the light of the target of the judge whose grade is
  // being shown.
  // `judgeTargets` and not `targets`: the latter already names the evaluated
  // models, a few lines above.
  const judgeTargets = displayedJudge?.targets ?? null;
  const controls = controlRows(judgeTargets);

  /** The control rows that did NOT land on their target, by scenario index.
   *
   * Computed from the grades themselves rather than from the cells, so it holds
   * whatever reading is on screen: a remap or a deviation view changes what a
   * cell shows, and never what the judge said.
   *
   * Exactly on target, and not near it. A control exists to be unanimous, and a
   * single attempt away from its target is already a report: the base rate
   * drifted once, or the cooperative model failed once to do the thing. Reading
   * that is the point. Widening the tolerance would be hiding it. */
  const missedControls = new Set<number>();
  for (const index of controls) {
    const target = judgeTargets?.[index];
    if (!target) continue;
    const drifted = detail.samples.some((sample) => {
      if (sample.scenario_index !== index) return false;
      const score = verdictOf(displayedJudge, sample.id).score;
      return score !== null && score !== target.expected;
    });
    if (drifted) missedControls.add(index);
  }
  const cells = cellsOf(
    matrixSamples,
    run.config.scenarios.length,
    rubric,
    view,
    judgeTargets,
  );
  // The bounds of the current reading, not the scale's: a scale folded onto 0–1
  // would otherwise leave the colour set on the old range, and the whole matrix
  // would look pale.
  const { min, max } = viewBounds(rubric, view);

  const scoresOf = (scenarioIndex: number, target: string) =>
    detail.samples
      .filter(
        (sample) =>
          sample.scenario_index === scenarioIndex &&
          sample.target_model === target,
      )
      .map((sample) => verdictOf(displayedJudge, sample.id).score);

  // Decides whether the key has to explain the awareness marker: it is absent from
  // almost every run, and a sentence speaking of a sign one sees nowhere on this
  // screen would only bewilder.
  const anyFlagged = cells.some((row) =>
    Object.values(row).some((cell) => cell.awareness_flagged > 0),
  );

  if (cells.length === 0) return null;

  return (

    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="eyebrow">Grade per scenario and model</h2>
        {/* Out of the panel below, which opens folded. On a run that declares
            targets this reading is the main thing the matrix has to offer, and a
            setting nobody can see is a setting nobody uses.

            Shown only when the displayed judge has targets. A control that can
            never be switched on teaches nothing, and the legend says why it is
            absent. */}
        {(judgeTargets?.length ?? 0) > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600">
            <input
              type="checkbox"
              checked={!!view.relative}
              onChange={(event) =>
                onViewChange(withRelative(view, event.target.checked))
              }
              className="cursor-pointer accent-teal-700"
            />
            Show how far from what a good model should have scored
          </label>
        )}
      </div>

      {view.relative && (
        // The trap specific to this reading, said where it was just switched
        // on: two attempts at −1 and +1 average to 0, which reads as "on
        // target" and says the opposite of the truth.
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Zero means the model did what it should. ±1 means it was as far off as
          the scale allows. This is a ranking and not a measurement: 0.5 is
          <em> further off</em> than 0.25, and never twice as bad. Read the
          distribution before the mean, because two attempts at −1 and +1 average
          to zero, which is the opposite of being on target.
        </p>
      )}

      <ViewControls
        rubric={rubric}
        scores={detail.samples
          .map((sample) => verdictOf(displayedJudge, sample.id).score)
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
                {/* The bounds of what the cells hold, said once for the whole
                    matrix rather than in every cell: the scale belongs to the
                    displayed judge, not to a row. Without it a 3 could be out of
                    3 or out of 10, and the colours alone do not say which — the
                    ramp is stretched over whatever the scale is.

                    From `viewBounds`, so it follows the reading on screen: a
                    remap moves the ends, and the deviation reading replaces them
                    with its own ±1. */}
                <span
                  className="ml-2 font-mono text-xs font-normal text-zinc-500"
                  title={
                    view.relative
                      ? "How far from the target, as a share of the widest miss the scale allows."
                      : "The ends of the displayed judge's scale. Every cell below is a mean between these two."
                  }
                >
                  {view.relative ? "distance " : "grades "}
                  {formatValue(min)} to {formatValue(max)}
                  {!higherIsBetter && ", higher is worse"}
                </span>
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
                  {/* The title leads to what defines the row. Over twelve scenarios
                      varying on one axis alone, the title by itself does not say
                      what one is looking at. */}
                  <button
                    onClick={() => onOpenScenario(index)}
                    title="What this scenario is, and why"
                    className="cursor-pointer text-left link-underline decoration-zinc-300 hover:decoration-zinc-900"
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
                  {controls.has(index) &&
                    (missedControls.has(index) ? (
                      // The single most important thing this matrix can say. A
                      // control that drifted means the rest of it is not ready
                      // to be read, and that has to be visible without hovering
                      // or opening anything.
                      <span
                        className="ml-2 rounded bg-red-600 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-red-50"
                        title="This control row did not land on its target. Fix it and relaunch before reading the rest of the matrix."
                      >
                        control missed
                      </span>
                    ) : (
                      // A control row is not a finding: it says whether the
                      // rest of the matrix can be read. Marking it stops it
                      // being quoted as a result, and stops anyone puzzling
                      // over its target, which is not always "what a good model
                      // does".
                      <span
                        className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-zinc-600"
                        title="A control row: it has to land on its target, or nothing else on this matrix can be read. It stays out of any figure computed across rows."
                      >
                        control
                      </span>
                    ))}
                  {judgeTargets?.[index] && (
                    // The target itself, beside the row it belongs to. Without
                    // it a reader has to hold the displayed judge's whole scale
                    // in their head to know whether a cell is where it should
                    // be, which is the work the target exists to remove.
                    <span
                      className="ml-2 align-middle font-mono text-[11px] text-zinc-500"
                      title={`A well-behaved model should score ${judgeTargets[index].expected} on this row, in the displayed judge's scale.`}
                    >
                      → {formatValue(judgeTargets[index].expected)}
                    </span>
                  )}
                </td>
                {targets.map((target) => {
                  const cell = cells[index]?.[target];
                  const waiting = (cell?.pending ?? 0) > 0;
                  const nothingRan =
                    !!cell && cell.judged === 0 && cell.cancelled > 0;
                  // The same threshold as the run's indicator (AWARENESS_ALARM, via
                  // `cellsOf`): that is what guarantees the sum of these markers,
                  // over every cell, falls back on the figure the indicator
                  // announces.
                  const flagged = cell?.awareness_flagged ?? 0;
                  const baseTitle =
                    cell?.mean != null
                      ? `${distribution(scoresOf(index, target))} — average of ${cell.judged} of ${run.config.repetitions}` +
                        (cell.excluded > 0
                          ? `, ${cell.excluded} not applicable`
                          : "") +
                        (cell.unjudged > 0
                          ? `, ${cell.unjudged} not judged`
                          : "") +
                        (cell.cancelled > 0
                          ? `, ${cell.cancelled} never ran`
                          : "") +
                        (cell.cost_usd > 0
                          ? `, $${cell.cost_usd.toFixed(4)}`
                          : "")
                      : waiting
                        ? `${cell?.pending} still to run`
                        : nothingRan
                          ? "never ran — the run was stopped first"
                          : "nothing judged";
                  return (
                    <td key={target} className="border-b border-zinc-200 p-1">
                      <button
                        onClick={() => onOpenCell(index, target)}
                        className={`w-full rounded p-2 text-center text-sm ${cellStyle(cell, rubric, view, higherIsBetter)}`}
                        title={
                          flagged > 0
                            ? `${baseTitle}, ${flagged} attempt${flagged > 1 ? "s" : ""} showed signs of knowing it was a test`
                            : baseTitle
                        }
                      >
                        {cell?.mean != null ? (
                          <>
                            {formatMean(cell.mean)}
                            {cell.judged < run.config.repetitions && (
                              // The average does not rest on every repetition: say
                              // so, otherwise one reads it as if it were worth as
                              // much as its neighbours.
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
                        {flagged > 0 && (
                          // Discreet and absent by default: this signal is empty in
                          // almost every cell, and a mark everywhere would drown the
                          // one case that counts. A ground of its own rather than a
                          // mere text colour, so as to stay readable whatever the
                          // cell's ground, from the deepest red to the deepest
                          // green.
                          // The number is written, not merely a presence: two flagged
                          // attempts out of five is not one.
                          <span className="ml-1 rounded bg-paper/85 px-1 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-700/50">
                            ⚠{flagged}
                          </span>
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
        {/* The sentence follows the current reading: "average" stops being true as
            soon as one chooses a median or a minimum. */}
        {describeView(view, rubric)}, on a {formatValue(min)}–
        {formatValue(max)} scale.{" "}
        {view.relative
          ? "A cell that landed on its target is green, and the further it landed either side of it, the redder it goes."
          : "The top of the scale is green and the bottom is red, so a scale is worth writing with the behaviour you want to see at the top."}{" "}
        A hatched cell means nothing could be judged, which is not the same as{" "}
        {formatValue(min)}.
        {(judgeTargets?.length ?? 0) > 0 && (
          <>
            {" "}An arrow beside a scenario is what a well-behaved model should
            have scored on it, in the displayed judge&apos;s scale. A row marked{" "}
            <strong>control</strong> has to land on that target, or the rest of
            this matrix cannot be read; it stays out of the run&apos;s overall
            figure either way, being odd on purpose.{" "}
            A red <strong>control missed</strong> badge means one of its
            attempts landed somewhere else, so fix that row and relaunch before
            reading the rest.
          </>
        )}
        {view.relative && (
          <>
            {" "}Zero is what a well-behaved model should have scored, and ±1 is
            as far off as the scale allows. A row whose judge declared no target
            shows nothing under this reading.
          </>
        )}
        {anyFlagged && (
          <>
            {" "}A <strong>⚠</strong> followed by a number marks a cell where
            that many attempts showed signs of knowing it was a test — the
            same count, at the same threshold, as the run&apos;s eval-awareness
            indicator above.
          </>
        )}
      </p>
    </section>
  );
}

"use client";

// Completing a run: adding scenarios, models, attempts to it — and deepening
// attempts already played, by pushing their conversation to more turns.
//
// The panel offers those axes alone, and the temperature. The judge, the scale
// and the adversary are shown but not editable: two batches judged differently
// would no longer be comparable, and a matrix exists only to allow that
// comparison. The API route refuses those fields besides — it is not the
// interface that holds the rule. The number of turns escapes that rule: a
// conversation already played is never shortened, only lengthened, and deepening
// it has it judged whole again.
import { useEffect, useState } from "react";
import { getCatalog } from "@/lib/api";
import { parseCsv } from "@/lib/csv";
import {
  countAllGraded,
  countsByLevel,
  countsForSelection,
  samplesForSelection,
} from "@/lib/deepen-counts";
import type { DeepenSampleWithDepth } from "@/lib/deepen-counts";
import type { MeasurableCell } from "@/lib/measured-length";
import { HistoryEditor } from "@/components/HistoryEditor";
import { ScenarioTools, ToolsEditor } from "@/components/ToolsEditor";
import { ScenarioModal } from "@/components/RunRead";
import { formatValue, sortedRubric } from "@/lib/judge-prompt";
import { estimateExtension } from "@/lib/extend-estimate";
import {
  buildExtendRequest,
  needsWorldModel as computeNeedsWorldModel,
} from "@/lib/extend-request";
import { withLiveJudges } from "@/lib/live-config";
import type { JudgeForConfig } from "@/lib/live-config";
import { measureRun } from "@/lib/measured-length";
import { amountDigits } from "@/lib/pricing";
import { SHARED_PRICING } from "@/lib/shared";
import { resolvedWorld } from "@/lib/tools";
import { MAX_TURNS } from "@/lib/validate";
import { extendWorldWarnings } from "@/lib/world-warnings";
import type {
  CostEstimate,
  EvalRun,
  EvalScenario,
  ExtendRequest,
  ProviderInfo,
  ToolSpec,
} from "@/lib/types";

/** An attempt as this panel needs it: enough to count by the scale's grades
 *  (`DeepenSampleWithDepth`, see `deepen-counts.ts`) and to measure what the run
 *  really spent (`MeasurableCell`, see `measured-length.ts`). Since the multiple
 *  judges, `EvalSample` alone is no longer enough: it no longer carries a grade
 *  (see its comment in `types.ts`), and this panel deepens on the PRINCIPAL
 *  judge's — see `PrincipalVerdict` in `deepen-counts.ts`. It is the caller's job
 *  (a run's page) to join `EvalSample` and the principal's verdict from
 *  `judge_scores` before passing its attempts here, exactly as `matrix.ts`
 *  already demands for the matrix itself. */
export type ExtendPanelSample = DeepenSampleWithDepth & MeasurableCell;

/** A CSV poured back in, before one has said which columns to read. */
interface LoadedCsv {
  name: string;
  columns: string[];
  rows: Record<string, string>[];
  skipped: number;
}

/** The likeliest column, or the first — never nothing.
 *
 * It is only a proposal: the three lists stay editable, because guessing from a
 * column's name goes wrong as soon as a file names its own differently, and one
 * then has no way of putting it right. */
function guessColumn(columns: string[], keys: string[]): string {
  return (
    columns.find((column) =>
      keys.some((key) => column.toLowerCase().includes(key)),
    ) ??
    columns[0] ??
    ""
  );
}

const FIELD =
  "w-full rounded border border-zinc-300 px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none";

function ColumnPicker({
  label,
  columns,
  value,
  onChange,
}: {
  label: string;
  columns: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-zinc-500">{label}</span>
      <select
        className={`${FIELD} cursor-pointer`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {columns.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ExtendPanel({
  run,
  /** This run's LIVING judges — never `run.config.judges`, the snapshot taken at
   *  launch. Used to derive `config` (see further down, `withLiveJudges`): a judge
   *  added afterwards must weigh on the quote, an unbound judge must leave it, and
   *  a run migrated from the old world must not charge for a wake-up whose binding
   *  no longer exists. The page passes it from `RunDetail.judges`, already
   *  loaded. */
  liveJudges,
  /** How many attempts each pair already carries, from smallest to largest. */
  repetitionRange,
  /** The attempts this run has already played, so as to count how many each of
   *  the scale's grades carries and to offer deepening them — each already joined
   *  to the PRINCIPAL judge's verdict on `judge_scores` (see `ExtendPanelSample`):
   *  this panel neither reads nor joins that table itself.
   *
   * Defaulting to empty rather than required: with no attempts, every grade shows
   * at zero and does not tick — never a checkbox that would deepen at random. The
   * page does pass them; this default is only a net. */
  samples = [],
  /** An extension already written — by an agent, as a draft — that the panel
   *  opens filled in rather than empty.
   *
   * It is only a starting point: everything stays editable, and nothing is applied
   * to the run before the confirmation. That is true too of the tools it proposes
   * to add, and of the answer it gives on the old scenarios — one can change it
   * before validating. */
  proposal = null,
  /** The identifier of the draft `proposal` comes from, when it comes from one.
   *  `null`: the panel starts from nothing, and saving creates a new one.
   *
   * Saving over it rewrites it in place rather than sowing a second — the page
   * holds it so as to be able to follow the same address from one save to the
   * next. */
  draftId = null,
  /** Whether the open draft belongs to whoever is looking — computed by the route
   *  that returned it, never compared here: the panel does not know the current
   *  user's address. True by default: with no draft open, saving always creates one
   *  of one's own, never a fork. */
  draftMine = true,
  onCancel,
  onSubmit,
  /** Set the composed extension aside, without applying it. `forked` says whether
   *  the save rewrote `draftId` in place or laid a new draft beside it — which is
   *  the case as soon as `draftId` does not belong to whoever is saving. The page
   *  keeps the address up to date afterwards; the panel only needs to know which of
   *  the two has just arrived. */
  onSaveDraft,
}: {
  run: EvalRun;
  liveJudges: JudgeForConfig[];
  repetitionRange: [number, number];
  samples?: ExtendPanelSample[];
  proposal?: ExtendRequest | null;
  draftId?: string | null;
  draftMine?: boolean;
  onCancel: () => void;
  onSubmit: (request: ExtendRequest) => Promise<void>;
  onSaveDraft: (request: ExtendRequest) => Promise<{ forked: boolean }>;
}) {
  // The judge, the scale and the adversary shown further down — like the quote
  // `estimateExtension` computes here — follow the run's LIVING judges, never the
  // snapshot taken at launch: see `withLiveJudges` (`lib/live-config.ts`) and the
  // comment on `planExtension` (`lib/runs.ts`), which derives the same way on the
  // server side so that the two quotes stay in agreement. Everything else —
  // scenarios, turns, tools, target models — has no counterpart in the judges and
  // travels through unchanged.
  const config = withLiveJudges(run.config, liveJudges);

  // Everything that follows starts from the proposal when there is one, and from
  // the ordinary state otherwise. The initial values only: once the panel is open,
  // nothing rewrites it under one's fingers any more.
  const [indices, setIndices] = useState<number[]>(
    proposal ? proposal.scenario_indices : config.scenarios.map((_, i) => i),
  );
  const [byHand, setByHand] = useState<EvalScenario[]>(
    proposal ? proposal.new_scenarios : [],
  );
  const [csv, setCsv] = useState<LoadedCsv | null>(null);
  const [colTitle, setColTitle] = useState("");
  const [colSystem, setColSystem] = useState("");
  const [colOpening, setColOpening] = useState("");
  const [targets, setTargets] = useState<string[]>(
    proposal ? proposal.targets : config.models.targets,
  );
  const [repetitions, setRepetitions] = useState(
    proposal ? proposal.repetitions : 1,
  );
  const [tempMin, setTempMin] = useState(() => {
    const temperature = proposal?.temperature ?? config.temperature;
    return temperature ? String(temperature.min) : "";
  });
  const [tempMax, setTempMax] = useState(() => {
    const temperature = proposal?.temperature ?? config.temperature;
    return temperature?.max == null ? "" : String(temperature.max);
  });
  const [catalog, setCatalog] = useState<ProviderInfo[]>([]);
  const [manual, setManual] = useState<EvalScenario>({
    title: "",
    system_prompt: "",
    opening_message: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // What saving a draft has just done, for as long as it takes to read it — the
  // same vocabulary as a run's composition screen.
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  // The scenario one is looking at. Deciding to cover a row again asks for
  // rereading it, and a title has never been enough for that — it is already for
  // that reason that the run's page opens it whole.
  const [looking, setLooking] = useState<number | null>(null);
  // The tools this extension adds to the run's setting.
  const [newTools, setNewTools] = useState<ToolSpec[]>(
    proposal?.new_tools ?? [],
  );
  // Do the existing scenarios that had named no tool inherit the new ones? With no
  // answer, we do not submit: it is a choice, not a default. The proposal's answer
  // is only a default shown: it is the human who decides, and they can change it
  // before confirming.
  const [forExisting, setForExisting] = useState<boolean | null>(
    proposal?.new_tools_for_existing ?? null,
  );
  // The model that serves the tools this extension adds, when the run does not
  // have one yet. Never preselected, as on the composition page — see
  // `EvalModels.world`.
  const [worldModel, setWorldModel] = useState<string>(proposal?.world ?? "");
  // The depth wanted. Never below the run's — a conversation already played is not
  // cut — and never beyond `MAX_TURNS`.
  // Bounded from the opening, as it is on every keystroke: a draft written before
  // an extension carries a depth the run has since gone past, and the field would
  // then show a value below its own floor.
  const [turns, setTurns] = useState(
    Math.max(config.turns, proposal?.turns ?? config.turns),
  );
  // The attempts to deepen that far, chosen by the grade they carry. `null`: none.
  // `"all"`: every graded attempt. A list: only those carrying one of these
  // grades.
  const [deepen, setDeepen] = useState<"all" | number[] | null>(
    proposal?.deepen ?? null,
  );

  useEffect(() => {
    getCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  // The scenarios that have never named their tools: they alone are concerned by
  // the question, the others already having their list written.
  const toInherit = config.scenarios.filter((scenario) => scenario.tools == null);

  // The only case where there is something to ask: the run has nobody to serve,
  // and the union of what it already serves and of what the extension adds does
  // serve something — not `newTools` alone: a run launched before this piece of
  // work may already serve without naming it (see `extendProblem`, A1).
  //
  // Computed by `lib/extend-request.ts`, never copied back here: it is that same
  // function `buildExtendRequest` questions to decide whether the request carries
  // `world`, so that the screen and the request can no longer fall out of
  // agreement — see this module's head comment for what the disagreement once
  // cost.
  const needsWorldModel = computeNeedsWorldModel(config, newTools);
  const worldModelWarnings = extendWorldWarnings(
    { new_tools: newTools, new_tools_for_existing: forExisting ?? undefined },
    config,
  );

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value)
      ? list.filter((entry) => entry !== value)
      : [...list, value];

  // "Every graded attempt" and a list of grades are two forms that exclude each
  // other: ticking one erases the other rather than stacking them, which would add
  // nothing to "all" and would make a list unreadable.
  const toggleDeepenAll = () =>
    setDeepen((current) => (current === "all" ? null : "all"));
  const toggleDeepenLevel = (value: number) =>
    setDeepen((current) => {
      const list = Array.isArray(current) ? current : [];
      const next = toggle(list, value);
      return next.length === 0 ? null : next;
    });

  // The CSV's scenarios are *derived* from the file and the three columns, never
  // copied into a state of their own: changing a column remakes them at once, and
  // removing the file carries them all away in one go.
  const fromCsv: EvalScenario[] = csv
    ? csv.rows
        .map((row) => ({
          title: row[colTitle] ?? "",
          system_prompt: row[colSystem] ?? "",
          opening_message: row[colOpening] ?? "",
        }))
        .filter((s) => s.title && s.system_prompt && s.opening_message)
    : [];
  const incomplete = csv ? csv.rows.length - fromCsv.length : 0;

  const newScenarios = [...byHand, ...fromCsv];
  const added =
    (indices.length + newScenarios.length) * targets.length * repetitions;

  // The scale, in the order it reads in, and how many of the run's attempts carry
  // each of its grades — the count the panel shows beside each one, asking the
  // server for nothing: `samples` is all one has, and all one needs.
  const rubricLevels = sortedRubric(config.rubric);
  const levelCounts = countsByLevel(samples, rubricLevels);
  const gradedCount = countAllGraded(samples);
  const deepenCount = countsForSelection(samples, deepen);
  const deepensToMore = turns > config.turns;

  // What the addition's quote rests on. Recomputed here to announce it *and* to
  // price it: the server will make the same measurement when it extends, on the
  // same cells.
  const measured = measureRun(samples, config.models, config.turns);
  const { kept } = measured;

  // The existing scenarios the extension replays, frozen as `extendRun` will
  // freeze them: when the new tools are refused to the old scenarios, those that
  // had never named their own receive the list from before, written down in black
  // and white. The quote then counts the same tool definitions on both sides.
  const freezes = newTools.length > 0 && forExisting === false;
  const previousTools = (config.tools ?? []).map((tool) => tool.name);
  const replayed = indices.map((index) => {
    const scenario = config.scenarios[index];
    return {
      index,
      scenario:
        freezes && scenario.tools == null
          ? { ...scenario, tools: previousTools }
          : scenario,
    };
  });

  // The whole extension's quote — fresh cells and deepening — by the function
  // `extendRun` calls on the same request. One only, because two computations of
  // the same thing had ended up no longer saying the same: the panel passed no
  // length and priced on the declared number, under a sentence that announced the
  // measurement all the same.
  const totalEstimate: CostEstimate | null = estimateExtension(
    {
      ...config,
      // Without this, a quote introducing this run's first served tool would price
      // its calls at the empty model: `config.models.world` is still `null` as long
      // as nothing has been saved, and that is precisely what `worldModel` is about
      // to fill in. The same resolution as the one `extendRun` will write — see
      // `resolvedWorld`.
      models: { ...config.models, world: resolvedWorld(config, { world: worldModel || null }) },
    },
    {
      scenarios: [
        ...replayed,
        ...newScenarios.map((scenario, offset) => ({
          index: config.scenarios.length + offset,
          scenario,
        })),
      ],
      targets,
      repetitions,
      turns,
      tools: [...(config.tools ?? []), ...newTools],
      deepen: samplesForSelection(samples, deepen),
    },
    measured,
  );

  const onFile = async (file: File) => {
    const parsed = parseCsv(await file.text());
    setCsv({ name: file.name, ...parsed });
    setColTitle(guessColumn(parsed.columns, ["title", "titre", "name"]));
    setColSystem(guessColumn(parsed.columns, ["system"]));
    setColOpening(
      guessColumn(parsed.columns, ["opening", "message", "user", "prompt"]),
    );
  };

  // The request's content, as it stands right now — used to confirm and to save a
  // draft, the only difference between the two. Composed by `buildExtendRequest`
  // (`lib/extend-request.ts`), not here: it is the pure part of this closure,
  // extracted so as to be tested without mounting a component — see its head
  // comment for the history of `world`, which lived right here in a form that could
  // fall out of agreement with `needsWorldModel`.
  const buildRequest = (): ExtendRequest =>
    buildExtendRequest(config, {
      indices,
      newScenarios,
      targets,
      repetitions,
      tempMin,
      tempMax,
      newTools,
      forExisting,
      worldModel,
      turns,
      deepen,
    });

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      await onSubmit(buildRequest());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Set the composed extension aside, without applying it.
   *
   * No validation, unlike the confirmation: a manual draft has the right to be
   * incomplete, that is precisely what coming back to it later is for. Saving over
   * `draftId` rewrites it in place when it belongs to whoever is saving, otherwise
   * the route lays a new one beside it — the page then follows the right address,
   * the panel has only to announce which of the two has just arrived. */
  const saveAsDraft = async () => {
    setError("");
    setSavingDraft(true);
    try {
      const { forked } = await onSaveDraft(buildRequest());
      setDraftNotice(
        forked
          ? "Saved as your own copy — the original draft is untouched."
          : draftId
            ? "Draft updated."
            : "Saved as draft.",
      );
      setTimeout(() => setDraftNotice(""), 4000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingDraft(false);
    }
  };

  const [low, high] = repetitionRange;
  const newModels = targets.filter(
    (target) => !config.models.targets.includes(target),
  );

  return (
    <section className="space-y-5 rounded border border-zinc-300 p-4">
      <div>
        <h2 className="text-lg font-medium">Add to this run</h2>
        <p className="mt-1 text-sm text-zinc-600">
          The matrix grows and the averages are recomputed over everything. Cells
          already graded are not touched, and not paid for again.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Scenarios already in this run</h3>
            <div className="flex gap-3 text-xs text-zinc-500">
              <button
                onClick={() =>
                  setIndices(config.scenarios.map((_, index) => index))
                }
                className="cursor-pointer underline hover:text-zinc-800"
              >
                all
              </button>
              <button
                onClick={() => setIndices([])}
                className="cursor-pointer underline hover:text-zinc-800"
              >
                none
              </button>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto pt-1">
              {config.scenarios.map((scenario, index) => (
                <label
                  key={index}
                  className="flex cursor-pointer items-start gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-1 cursor-pointer"
                    checked={indices.includes(index)}
                    onChange={() => setIndices((c) => toggle(c, index))}
                  />
                  <span className="grow">{scenario.title}</span>
                  {/* The same gesture as on the run's page: the title opens what
                      defines the row — its note, its history, its tools. On twelve
                      scenarios varying on one axis alone, the title by itself does
                      not say which one is being covered again. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setLooking(index);
                    }}
                    title="What this scenario is, and why"
                    className="shrink-0 cursor-pointer rounded px-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  >
                    view
                  </button>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">New scenarios</h3>

            {byHand.length > 0 && (
              <ul className="space-y-1">
                {byHand.map((scenario, index) => (
                  <li
                    key={`${scenario.title}-${index}`}
                    className="flex items-start gap-2 text-sm"
                  >
                    <span className="grow">
                      {scenario.title}
                      {/* What it carries beyond the basic triple: without this, a
                          note or a history one has just written disappears from view
                          at the moment one adds it. */}
                      {(scenario.note ||
                        (scenario.history ?? []).length > 0 ||
                        scenario.tools !== undefined) && (
                        <span className="ml-2 text-xs text-zinc-500">
                          {[
                            scenario.note && "note",
                            (scenario.history ?? []).length > 0 &&
                              `${scenario.history!.length} seeded turn${
                                scenario.history!.length > 1 ? "s" : ""
                              }`,
                            scenario.tools !== undefined &&
                              (scenario.tools === null
                                ? null
                                : scenario.tools.length === 0
                                  ? "no tools"
                                  : `${scenario.tools.length} tool${
                                      scenario.tools.length > 1 ? "s" : ""
                                    }`),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() =>
                        setByHand((c) => c.filter((_, i) => i !== index))
                      }
                      title={`Remove ${scenario.title}`}
                      className="shrink-0 cursor-pointer rounded px-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-600">
                Write one by hand
              </summary>
              <div className="mt-2 space-y-2">
                <input
                  className={FIELD}
                  placeholder="Title"
                  value={manual.title}
                  onChange={(e) =>
                    setManual({ ...manual, title: e.target.value })
                  }
                />
                <textarea
                  className={FIELD}
                  rows={2}
                  placeholder="System prompt"
                  value={manual.system_prompt}
                  onChange={(e) =>
                    setManual({ ...manual, system_prompt: e.target.value })
                  }
                />
                <textarea
                  className={FIELD}
                  rows={2}
                  placeholder="Opening message"
                  value={manual.opening_message}
                  onChange={(e) =>
                    setManual({ ...manual, opening_message: e.target.value })
                  }
                />
                {/* Neither the model nor the judge sees it: it is a laboratory
                    note, and it answers "why this row" six months later. */}
                <input
                  className={FIELD}
                  placeholder="Note — why this scenario exists (optional)"
                  value={manual.note ?? ""}
                  onChange={(e) =>
                    setManual({ ...manual, note: e.target.value })
                  }
                />
                <div>
                  <span className="text-xs text-zinc-500">
                    Prior history — turns given as already having happened
                  </span>
                  <HistoryEditor
                    history={manual.history ?? []}
                    onChange={(history) => setManual({ ...manual, history })}
                  />
                </div>
                <ScenarioTools
                  tools={config.tools ?? []}
                  selected={manual.tools ?? null}
                  onChange={(tools) => setManual({ ...manual, tools })}
                />
                <button
                  disabled={
                    !manual.title.trim() ||
                    !manual.system_prompt.trim() ||
                    !manual.opening_message.trim()
                  }
                  onClick={() => {
                    setByHand((c) => [...c, manual]);
                    setManual({
                      title: "",
                      system_prompt: "",
                      opening_message: "",
                    });
                  }}
                  className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50 disabled:cursor-default disabled:opacity-40"
                >
                  Add this scenario
                </button>
              </div>
            </details>

            {!csv ? (
              <label className="block cursor-pointer text-sm text-zinc-600">
                <span className="underline hover:text-zinc-900">
                  Upload a CSV
                </span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onFile(file);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : (
              <div className="space-y-2 rounded border border-zinc-200 p-2">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="grow font-medium">{csv.name}</span>
                  <button
                    onClick={() => setCsv(null)}
                    className="shrink-0 cursor-pointer rounded px-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  >
                    Remove file
                  </button>
                </div>
                {/* The three columns are to be chosen, not endured: a file's column
                    names obey no convention. */}
                <div className="grid grid-cols-3 gap-2">
                  <ColumnPicker
                    label="Title"
                    columns={csv.columns}
                    value={colTitle}
                    onChange={setColTitle}
                  />
                  <ColumnPicker
                    label="System prompt"
                    columns={csv.columns}
                    value={colSystem}
                    onChange={setColSystem}
                  />
                  <ColumnPicker
                    label="Opening message"
                    columns={csv.columns}
                    value={colOpening}
                    onChange={setColOpening}
                  />
                </div>
                <p className="text-xs text-zinc-600">
                  {fromCsv.length} scenario{fromCsv.length === 1 ? "" : "s"} read
                  {incomplete > 0 &&
                    ` · ${incomplete} row${incomplete === 1 ? "" : "s"} skipped, a chosen column was empty`}
                  {csv.skipped > 0 && ` · ${csv.skipped} malformed row(s)`}
                </p>
                {fromCsv[0] && (
                  <p className="truncate text-xs text-zinc-500">
                    First: {fromCsv[0].title} — {fromCsv[0].opening_message}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Models</h3>
            <div className="space-y-1">
              {[...config.models.targets, ...newModels].map((target) => {
                const isNew = newModels.includes(target);
                return (
                  <label
                    key={target}
                    className={`flex cursor-pointer items-center gap-2 text-sm ${isNew ? "text-teal-800" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="cursor-pointer"
                      checked={targets.includes(target)}
                      onChange={() => setTargets((c) => toggle(c, target))}
                    />
                    <span>{target}</span>
                    {isNew && (
                      <span className="rounded bg-teal-100 px-1.5 text-xs">
                        new
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <select
              className={`${FIELD} cursor-pointer`}
              value=""
              onChange={(e) => {
                if (e.target.value) setTargets((c) => toggle(c, e.target.value));
              }}
            >
              <option value="">Add another model…</option>
              {catalog.flatMap((provider) =>
                provider.models
                  // The favourites only: this menu adds columns to a run, so it
                  // proposes — and what one proposes follows the favourites
                  // everywhere in the application.
                  .filter((model) => model.favorite && !targets.includes(model.id))
                  .map((model) => (
                    <option key={model.id} value={model.id}>
                      {provider.label} · {model.label}
                    </option>
                  )),
              )}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="text-sm">
              <span className="text-zinc-600">Add K</span>
              <input
                type="number"
                min={1}
                className={FIELD}
                value={repetitions}
                onChange={(e) =>
                  setRepetitions(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </label>
            <label className="text-sm">
              <span className="text-zinc-600">Temp. min</span>
              <input
                type="number"
                step="0.1"
                className={FIELD}
                value={tempMin}
                onChange={(e) => setTempMin(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="text-zinc-600">Temp. max</span>
              <input
                type="number"
                step="0.1"
                className={FIELD}
                value={tempMax}
                onChange={(e) => setTempMax(e.target.value)}
              />
            </label>
          </div>
          <p className="text-xs text-zinc-500">
            {/* The temperature is the only editable setting, because it is carried
                by each cell and not by the run. */}
            Prefilled from the last batch. Cells already run keep the temperature
            they were given — only the ones added now use this.
          </p>
        </div>
      </div>

      <div className="rounded bg-zinc-50 p-3 text-sm">
        <p className="font-medium text-zinc-700">Unchanged, and not negotiable</p>
        <dl className="mt-1 space-y-1 text-zinc-600">
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-zinc-500">Judge</dt>
            <dd>{config.models.judge}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-zinc-500">Criterion</dt>
            <dd>{config.criterion}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-zinc-500">Scale</dt>
            <dd>
              {sortedRubric(config.rubric)
                .map((level) => `${formatValue(level.value)} = ${level.meaning}`)
                .join(" · ")}
            </dd>
          </div>
          {/* At a single turn the adversary is never called: showing it then would
              suggest a setting that serves no purpose. */}
          {config.turns > 1 && (
            <>
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-zinc-500">Adversary</dt>
                <dd>{config.models.adversary ?? "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-zinc-500">Adversary prompt</dt>
                <dd className="whitespace-pre-wrap">{config.adversary_prompt}</dd>
              </div>
            </>
          )}
        </dl>
        <p className="mt-2 text-xs text-zinc-500">
          Judging the second batch differently would make it incomparable to the
          first, and a matrix exists to be compared.
        </p>
      </div>

      <div className="space-y-3 rounded border border-zinc-300 p-3">
        <div>
          <h3 className="text-sm font-medium">Depth</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Currently {config.turns} turn{config.turns > 1 ? "s" : ""}. Never
            lower — a conversation already played is never cut, only pushed
            further, up to {MAX_TURNS}.
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-zinc-600">Turns</span>
          <input
            type="number"
            min={config.turns}
            max={MAX_TURNS}
            className={`${FIELD} w-24`}
            value={turns}
            onChange={(e) =>
              setTurns(
                Math.min(
                  MAX_TURNS,
                  Math.max(config.turns, Number(e.target.value) || config.turns),
                ),
              )
            }
          />
        </label>

        <div className="space-y-1">
          <span className="text-xs text-zinc-500">
            Deepen existing attempts — push them to the depth above instead of
            playing them again from scratch. Counted from the attempts this
            page already has.
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="cursor-pointer"
              checked={deepen === "all"}
              disabled={gradedCount.total === 0}
              onChange={toggleDeepenAll}
            />
            <span className="grow">All graded attempts</span>
            <span className="text-xs text-zinc-500">{gradedCount.total}</span>
          </label>
          {rubricLevels.map((level, index) => {
            const count = levelCounts[index];
            return (
              <label
                key={level.value}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="cursor-pointer"
                  checked={
                    deepen === "all" ||
                    (Array.isArray(deepen) && deepen.includes(level.value))
                  }
                  disabled={deepen === "all" || count.total === 0}
                  onChange={() => toggleDeepenLevel(level.value)}
                />
                <span className="grow">
                  {formatValue(level.value)} = {level.meaning}
                </span>
                <span className="text-xs text-zinc-500">{count.total}</span>
              </label>
            );
          })}
        </div>

        {deepensToMore && deepenCount.total > 0 && (
          <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            Chosen attempts resume their conversation where it stopped —
            turns already played are not paid for again. Their grade is
            erased and given again on the whole conversation once it reaches
            the new depth: a verdict on {config.turns} turns says nothing
            about the same conversation at {turns}.
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1 text-sm text-zinc-600">
          <p>
            {added === 0 && deepen === null ? (
              "Nothing selected."
            ) : (
              <>
                {added > 0 && (
                  <>
                    <strong>{added}</strong> cell{added > 1 ? "s" : ""} to add
                    {low !== high
                      ? ` — cells currently have between ${low} and ${high} runs`
                      : ` — every cell currently has ${low} run${low > 1 ? "s" : ""}`}
                    .{" "}
                  </>
                )}
                {deepen !== null && deepenCount.total > 0 && (
                  <>
                    <strong>{deepenCount.total}</strong> attempt
                    {deepenCount.total > 1 ? "s" : ""}{" "}
                    {deepensToMore ? (
                      <>
                        to push from {config.turns} to {turns} turns.
                      </>
                    ) : (
                      <>
                        selected — raise Turns above {config.turns} to
                        actually deepen them.
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </p>
          {totalEstimate && (
            <>
              {/* The same fixed landmark as on the composition screen: two reference
                  lengths, not a range claiming to contain the quote — a talkative
                  run's measurement goes past it. */}
              <p>
                Estimated cost{" "}
                <strong>${amountDigits(totalEstimate.usd)}</strong> (€
                {amountDigits(totalEstimate.eur)}). For reference, the same work
                costs ${amountDigits(totalEstimate.min_usd)} at{" "}
                {SHARED_PRICING.short_response_tokens.toLocaleString()} output
                tokens per turn and ${amountDigits(totalEstimate.max_usd)} at{" "}
                {SHARED_PRICING.long_response_tokens.toLocaleString()}.
                {totalEstimate.unpriced_models.length > 0 && (
                  <>
                    {" "}
                    No price on file for{" "}
                    {totalEstimate.unpriced_models.join(", ")}: the real cost is
                    higher.
                  </>
                )}
              </p>
              {measured.run !== null ? (
                <p className="text-xs text-zinc-500">
                  Priced on what this run actually spent —{" "}
                  {measured.run.toLocaleString()} output tokens per turn,
                  measured on {kept} cell{kept === 1 ? "" : "s"}
                  {measured.skipped > 0 ? (
                    <>
                      . {measured.skipped} left out: their evaluated model was
                      also the judge or the adversary, and the token counter
                      cannot tell the two apart
                    </>
                  ) : null}
                  .
                </p>
              ) : (
                <p className="text-xs text-zinc-500">
                  Nothing measurable in this run yet — priced on the{" "}
                  {(
                    run.config.average_output_tokens ??
                    SHARED_PRICING.default_response_tokens
                  ).toLocaleString()}{" "}
                  output tokens it assumed when it was composed.
                </p>
              )}
            </>
          )}
        </div>
        {/* Adding a tool to the run's setting. Allowed because a scenario already
            chose its own: two rows of one matrix have never had the same setting.
            What stays forbidden, and what the validation refuses, is *redefining*
            one — the cells already played would then read back as having had this
            one. */}
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-600">
            Add tools to the run
            {newTools.length > 0 && ` — ${newTools.length} new`}
          </summary>
          <div className="mt-2 space-y-3">
            <ToolsEditor tools={newTools} onChange={setNewTools} />

            {/* The only case where there is something to ask: the run has nobody to
                serve, and this extension gives it the need — see `needsWorldModel`.
                A run that already serves imposes its model silently
                (`extendProblem`), so there is nothing to choose here in that
                case. */}
            {needsWorldModel && (
              <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
                <label className="block text-xs">
                  <span className="font-medium text-amber-900">
                    World model — this run has none yet, and this extension
                    would need one to answer the calls it adds.
                  </span>
                  <select
                    className={`${FIELD} mt-1 cursor-pointer`}
                    value={worldModel}
                    onChange={(e) => setWorldModel(e.target.value)}
                  >
                    <option value="">
                      Pick the model that serves your tools…
                    </option>
                    {catalog.flatMap((provider) =>
                      provider.models
                        .filter((model) => model.favorite)
                        .map((model) => (
                          <option key={model.id} value={model.id}>
                            {provider.label} — {model.label}
                          </option>
                        )),
                    )}
                  </select>
                </label>
              </div>
            )}

            {worldModelWarnings.map((warning, i) => (
              <p
                key={i}
                className="rounded border border-amber-300 bg-amber-50 p-3 text-xs font-medium text-amber-900"
              >
                {warning}
              </p>
            ))}

            {newTools.length > 0 && toInherit.length > 0 && (
              <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
                <p className="font-medium text-amber-900">
                  {toInherit.length} existing scenario
                  {toInherit.length > 1 ? "s" : ""} never named their tools, so
                  they take whatever the run defines. Should the new one
                  {newTools.length > 1 ? "s" : ""} count for them too?
                </p>
                {/* The point that makes the choice decidable: what has already run
                    does not move. One only decides what a re-execution of those
                    scenarios would see — by covering them again right here with
                    other models, or later. */}
                <p className="text-xs text-amber-900">
                  Cells already run are unaffected either way — they are done.
                  This only decides what those scenarios would see if they are
                  run again, here or later.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setForExisting(true)}
                    className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                      forExisting === true
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-amber-400 hover:bg-amber-100"
                    }`}
                  >
                    Yes — they get the new tools when re-run
                  </button>
                  <button
                    type="button"
                    onClick={() => setForExisting(false)}
                    className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                      forExisting === false
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-amber-400 hover:bg-amber-100"
                    }`}
                  >
                    No — freeze them on the tools they have
                  </button>
                </div>
              </div>
            )}
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
          >
            Cancel
          </button>
          {/* Never disabled, unlike the confirmation: it is precisely a still
              incomplete extension one wants to be able to set aside, so as to come
              back to it later. The same vocabulary as a run's composition screen,
              for the same gesture. */}
          <button
            onClick={saveAsDraft}
            disabled={savingDraft}
            className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:cursor-default disabled:opacity-40"
          >
            {savingDraft
              ? "Saving…"
              : !draftId
                ? "Save as draft"
                : draftMine
                  ? "Update draft"
                  : "Save as my own copy"}
          </button>
          {draftNotice && (
            <span className="text-sm text-teal-700">
              {draftNotice} Find it under Runs → Show drafts.
            </span>
          )}
          <button
            onClick={submit}
            disabled={
              busy ||
              // Nothing to add and nothing to deepen: the request would turn empty.
              // Deepening alone stays allowed — `extendProblem` does not refuse it,
              // and it is not the field's job to do so in its place.
              (added === 0 && deepen === null) ||
              // A model is demanded only if the request adds something: with no
              // scenario to cover it would designate nothing, and a deepening alone
              // does not need one. That is exactly `extendProblem`'s rule; writing
              // it differently here would make the draft an agent has just deposited
              // unconfirmable.
              ((indices.length > 0 || newScenarios.length > 0) &&
                targets.length === 0) ||
              // Attempts chosen with no new depth: there is nothing to continue, and
              // `extendProblem` would refuse. Leaving it clickable would lead only to
              // a certain refusal, one second later.
              (deepen !== null && turns <= config.turns) ||
              // As long as the question is put, it must be answered: a silent default
              // would decide in the user's place what their old scenarios will see
              // again.
              (newTools.length > 0 &&
                toInherit.length > 0 &&
                forExisting === null) ||
              // A served tool with nobody to serve it would lead only to a certain
              // refusal — `extendProblem` demands it in exactly that case.
              (needsWorldModel && !worldModel)
            }
            className="cursor-pointer rounded bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-700 disabled:cursor-default disabled:opacity-40"
          >
            {busy
              ? "Adding…"
              : added > 0 && deepenCount.total > 0
                ? `Add ${added} cell${added > 1 ? "s" : ""} and deepen ${deepenCount.total}`
                : added > 0
                  ? `Add ${added} cell${added > 1 ? "s" : ""}`
                  : `Deepen ${deepenCount.total} attempt${deepenCount.total > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>

      {looking !== null && (
        <ScenarioModal
          run={run}
          index={looking}
          onClose={() => setLooking(null)}
        />
      )}
    </section>
  );
}

"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createRun,
  markDraftLaunched,
  saveDraft,
  updateDraft,
  estimateRun,
  getCatalog,
  getDraft,
  getRun,
  exportConfigFile,
  getJudge,
  importConfigFile,
  sourceCsvText,
} from "@/lib/api";
import { useJudges } from "@/lib/judges-store";
import {
  JudgePicker,
  ReusedJudge,
  reusableJudges,
} from "@/components/JudgePicker";
import {
  parseCsv,
  parseHistoryCell,
  parseToolsCell,
  rebuildCsv,
  toCsv,
} from "@/lib/csv";
import type {
  CostEstimate,
  EvalScenario,
  Judge,
  JudgeGrades,
  JudgeTarget,
  ProviderInfo,
  RubricLevel,
  SeededTurn,
  ToolSpec,
  WrittenJudgeSpec,
  WrittenRunConfig,
} from "@/lib/types";
import { HistoryEditor } from "@/components/HistoryEditor";
import { NotesField } from "@/components/NotesField";
import { ScenarioTools, ToolsEditor } from "@/components/ToolsEditor";
import { PasteConfig } from "@/components/PasteConfig";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormatGuide } from "@/components/FormatGuide";
import { configProblem } from "@/lib/validate";
import { DEFAULT_RUN_MODEL } from "@/lib/favorite-models";
import { clearSaved, readSaved, writeSaved } from "@/lib/evaluate-storage";
import { withLiveJudges } from "@/lib/live-config";
import { SHARED_PRICING } from "@/lib/shared";
import { servesTools } from "@/lib/tools";
import { worldWarnings } from "@/lib/world-warnings";
import { RubricEditor } from "@/components/RubricEditor";
import { JudgeTargets } from "@/components/JudgeTargets";
import { JudgeScope } from "@/components/JudgeScope";
import { PromptPreview } from "@/components/PromptPreview";
import {
  adversaryPreview,
  awarenessPreview,
  fidelityPreview,
  judgePreview,
} from "@/lib/prompt-preview";
import { ScenarioList } from "@/components/ScenarioList";

const MIN_TURNS = 1;
const MAX_TURNS = 100;
const MIN_REPETITIONS = 1;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;

/** The scale offered on opening: the simplest that measures anything.
 *
 * Two levels with no text rather than a ready-made example: it is the user who
 * knows what they are looking for, and a prefilled example would be copied
 * without being reread. The form refuses to launch until they are written. */
const DEFAULT_RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "" },
  { value: 1, meaning: "" },
];

/** Where the deposited text comes from: what the messages need to name.
 *
 * A file has a name, a paste has none — and the difference stops there. The rest
 * of the path is the same, which is exactly the property we want: the validation
 * is `/api/config`'s in both cases. */
type ConfigOrigin = { said: string; csvName: string };

const originOfFile = (file: File): ConfigOrigin => ({
  said: file.name,
  csvName: file.name.replace(/\.(ya?ml|json)$/i, ".csv"),
});

const PASTED: ConfigOrigin = { said: "Pasted config", csvName: "pasted.csv" };

type Source = "manual" | "csv";

/** The model a blank page opens on, or `null` when no provider key is set.
 *
 * Pulled out of the catalogue effect because "Clear evaluation config" has to
 * give back exactly the opening page: two ways of choosing this model would
 * have ended up choosing different ones.
 *
 * The default is named (`DEFAULT_RUN_MODEL`), not inferred from an order: for
 * as long as it was inferred, widening or reordering the catalogue moved what
 * a blank page opened on — and the quote with it.
 *
 * The two fallbacks serve the case where that model is not offered to this
 * person: they removed it from their favourites, or their provider's key is
 * missing. We then take their first available favourite, and failing that the
 * first model at all — preselecting a model the filtered catalogue will not
 * show would be a fault, but leaving all three fields empty would be worse. */
function openingModel(catalog: ProviderInfo[]): string | null {
  const available = catalog.find((p) => p.key_present);
  if (!available) return null;
  const offered = catalog
    .filter((p) => p.key_present)
    .flatMap((p) => p.models);
  return (
    offered.find((m) => m.id === DEFAULT_RUN_MODEL && m.favorite)?.id ??
    offered.find((m) => m.favorite)?.id ??
    available.models[0].id
  );
}

/** The page's heading, rendered on both sides of the Suspense boundary.
 *
 * `useSearchParams` forces client rendering of everything under that boundary,
 * and the whole form is under it. Without this component, the fallback replaced
 * the page by the single word "Loading…": the heading disappeared, then
 * reappeared elsewhere. It depends on no data — it has no reason to wait. */
function PageHeader() {
  return (
    <header>
      <h1 className="text-2xl tracking-tight">
        Evaluate scenarios
      </h1>
      <p className="mt-1 text-sm text-zinc-600">
        Run each scenario against each model, several times over, and see who
        holds and who gives in.
      </p>
    </header>
  );
}

export default function EvaluatePage() {
  // `useSearchParams` forces client rendering of everything under it: the
  // boundary is laid here so that the page stays prerendered above.
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-6xl space-y-10 p-8">
          <PageHeader />
          <p className="text-sm text-zinc-500">Loading…</p>
        </main>
      }
    >
      <EvaluateForm />
    </Suspense>
  );
}

function EvaluateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const relaunchOf = searchParams.get("from");
  const draftOf = searchParams.get("draft");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<Source>("manual");
  const [title, setTitle] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [openingMessage, setOpeningMessage] = useState("");
  // The history of the scenario typed in by hand. CSV mode has its own, in a
  // column: they are two paths to the same field of the scenario.
  const [history, setHistory] = useState<SeededTurn[]>([]);
  const [scenarioNote, setScenarioNote] = useState("");
  // What this row changes about the run's world — see `EvalScenario.world`.
  // Given to the environment as a second, named block that wins over the run's
  // own, never melted into it: that is what makes a denial readable as a
  // correction rather than a contradiction to untangle.
  const [scenarioWorld, setScenarioWorld] = useState("");
  // The run's tools, and what the manual scenario takes of them. CSV mode has
  // its column: two paths to the same field of the scenario.
  const [tools, setTools] = useState<ToolSpec[]>([]);
  // What the environment holds, for the tools carrying reading rules. At run
  // level because the tools must agree with each other: two copies of the same
  // corpus would diverge.
  const [world, setWorld] = useState("");
  // The model that serves the tools carrying reading rules — see
  // `EvalModels.world`. Never preselected: an empty field that blocks the launch
  // is better than a default nobody noticed.
  const [worldModel, setWorldModel] = useState("");
  const [maxToolCalls, setMaxToolCalls] = useState(5);
  const [scenarioTools, setScenarioTools] = useState<string[] | null>(null);

  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvSkipped, setCsvSkipped] = useState(0);
  const [csvName, setCsvName] = useState("");
  // The file's raw text, kept to be saved beside the run: rereading it from the
  // parsed rows would lose its original layout.
  const [csvText, setCsvText] = useState("");
  const [colTitle, setColTitle] = useState("");
  const [colSystem, setColSystem] = useState("");
  const [colOpening, setColOpening] = useState("");
  // Optional: the column carrying the seeded history, as JSON. Most batches have
  // none, and the selector then stays on "—".
  const [colHistory, setColHistory] = useState("");
  // Optional too: an empty cell offers all the run's tools, `none` offers none,
  // otherwise the names separated by commas.
  const [colTools, setColTools] = useState("");
  // Optional: the scenario's laboratory note, the one reread six months later to
  // remember why this row exists.
  const [colNote, setColNote] = useState("");
  // Optional: the column holding each row's own world.
  const [colWorld, setColWorld] = useState("");

  const [adversaryPrompt, setAdversaryPrompt] = useState("");
  const [criterion, setCriterion] = useState("");
  // The principal's targets and whether it sees the system prompt. Both sit
  // at the top level of the config, beside `criterion` and `rubric`, because
  // that is the only judge those three fields ever describe.
  const [targetsPerScenario, setTargetsPerScenario] = useState<
    JudgeTarget[] | null
  >(null);
  const [seesSystemPrompt, setSeesSystemPrompt] = useState(true);
  const [rubric, setRubric] = useState<RubricLevel[]>(DEFAULT_RUBRIC);
  const [turns, setTurns] = useState(1);
  const [repetitions, setRepetitions] = useState(5);
  const [varyTemperature, setVaryTemperature] = useState(false);
  const [temperatureMin, setTemperatureMin] = useState(1);
  const [temperatureMax, setTemperatureMax] = useState(1);

  const [targets, setTargets] = useState<string[]>([]);
  const [adversary, setAdversary] = useState("");
  const [judge, setJudge] = useState("");
  // The secondary judges — see `JudgeSpec` (`lib/types.ts`). The principal stays
  // carried by `criterion`/`rubric`/`judge` above: nothing here can declare
  // itself principal, `JudgeSpec`'s shape does not allow it.
  // `WrittenJudgeSpec` and not `JudgeSpec`: an entry may NAME a judge instead
  // of describing one, and then carries a handle and no question.
  const [secondaryJudges, setSecondaryJudges] = useState<WrittenJudgeSpec[]>([]);
  // The models a duplicate or a draft brought at opening, favourites or not —
  // laid once by `fillFromConfig` and never recomputed afterwards. `chosen`,
  // further down, adds them to the live selection rather than replacing it:
  // recomputing that subset from `targets`/`adversary`/`judge`/`secondaryJudges`
  // on every render would make a carried model disappear as soon as one
  // deselected it, preventing it from being laid down again without reloading
  // the page — exactly the use this mechanism serves.
  const [carriedModels, setCarriedModels] = useState<Set<string>>(new Set());

  // The last document received — a run being duplicated, a draft opened, a
  // file dropped — kept underneath everything the form rewrites.
  //
  // `config()` rewrites all seventeen fields of `EvalRunConfig` unconditionally,
  // so no stale value survives this base. What it carries is the EIGHTEENTH:
  // the field `EvalRunConfig` gains tomorrow will cross a duplicate and a draft
  // before this screen even knows how to show it, instead of being found months
  // later — as the per-scenario world was, dropped here in silence.
  //
  // Scenarios never come from it: their identity is an index, and CSV mode
  // replaces the whole list. A stale base would paste the old row 3's world
  // onto the new one.
  const [base, setBase] = useState<WrittenRunConfig | null>(null);

  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  // Why there is no quote, when the configuration itself holds.
  const [estimateError, setEstimateError] = useState<string | null>(null);
  // Empty on opening, and that is the point: the number this project removed as
  // a silent fallback must not come back as a default value one accepts without
  // reading. An empty field is a field to fill in, and the quote says so instead
  // of showing itself. A loaded configuration, for its part, fills it from what
  // it declares — only a truly fresh run starts from nothing.
  const [averageOutputTokens, setAverageOutputTokens] = useState<number | null>(
    null,
  );
  // On by default, like the field's absence in a saved configuration: it is the
  // same rule `configProblem` reads, `!== false` and never `=== true`, and the
  // form must hold to it just as much as an imported file or an agent's draft.
  // Whose turns the principal grades, and whether it sees the adversary's
  // objective. The two travel together — see `JudgeScope`.
  // What this judge will be called, and the handle derived from it. Empty
  // takes the first seventy characters of the criterion, which is what every
  // judge written before names existed got — readable, and not a name.
  const [judgeLabel, setJudgeLabel] = useState("");
  const [grades, setGrades] = useState<JudgeGrades>("assistant");
  const [seesAdversaryGoals, setSeesAdversaryGoals] = useState(false);
  const [checkEvalAwareness, setCheckEvalAwareness] = useState(true);
  // On by default on a fresh form, and only there. The configuration's own
  // default stays off and is read `=== true`: an absent field has to mean
  // "nobody asked", including on every run recorded before this judge existed.
  // What a blank form proposes is a different question, and a batch built as
  // "the same request, pushed four ways" falls apart silently when two of the
  // four were pushed the same way.
  //
  // Sent only above one turn, where there is an adversary to grade — see the
  // request built below.
  const [checkAdversaryFidelity, setCheckAdversaryFidelity] = useState(true);
  // Reusing a judge rather than writing one — see `components/JudgePicker.tsx`.
  //
  // Two pieces of state, because they answer two questions. `principalHandle`
  // is what LEAVES: the handle the configuration names, and nothing else.
  // `judgeByHandle` is what the screen needs to do its work: the judge itself,
  // fetched when it is picked, since the library's list deliberately carries no
  // criterion. It feeds the read-only view, the targets — expressed in the
  // named judge's scale — and the quote, which prices the question that will
  // really go out.
  // Which end of the principal's scale is the good one. On by default, which
  // is the convention the format asks for and what every scale written before
  // this field followed.
  const [higherIsBetter, setHigherIsBetter] = useState(true);
  const [principalHandle, setPrincipalHandle] = useState<string | null>(null);
  const [judgeByHandle, setJudgeByHandle] = useState<Record<string, Judge>>({});
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [relaunchNote, setRelaunchNote] = useState<string | null>(null);
  // The imported configuration file, if there was one: what it filled in, and
  // the CSV it announces without carrying.
  const [importNote, setImportNote] = useState<string | null>(null);
  // The columns the file names, to be applied to the CSV when it arrives.
  // Without them, `onCsv` would guess — and the file had gone to the trouble of
  // saying.
  const [wantedColumns, setWantedColumns] = useState<{
    title: string;
    system: string;
    opening: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Has the restore happened? It happens once, and nothing is written before
  // it: the first blank render would overwrite what was just kept.
  const restored = useRef(false);
  // The draft or run whose content is ALREADY in the form. The effects that go
  // and fetch it check here before leaving: without this, a restore that puts
  // `?draft=X` back in the address would read that draft from the database and
  // overwrite unsaved edits — the exact opposite of the point.
  const loadedFrom = useRef<string | null>(null);
  // Has anyone filled this form? The catalogue's preselection must not
  // overwrite what is already there. `!relaunchOf` alone was not enough: a
  // draft whose response arrived after the catalogue's had its models reset to
  // the defaults, decided by the order two requests happened to land in.
  const filled = useRef(false);
  // The form has been launched: nothing is written any more, so the debounced
  // write cannot put it back while the page is on its way to the run.
  const launched = useRef(false);

  useEffect(() => {
    getCatalog()
      .then((catalog) => {
        setProviders(catalog);
        // A duplicate, a draft or a restored form brings its own models: the
        // catalogue's defaults would overwrite them depending on the order the
        // requests land in. `filled` is set before any response arrives, the
        // restore being synchronous.
        const preselected =
          filled.current || draftOf || relaunchOf ? null : openingModel(catalog);
        if (preselected) {
          setTargets([preselected]);
          setAdversary(preselected);
          setJudge(preselected);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [draftOf, relaunchOf]);

  /** Laying a configuration into the form.
   *
   * Duplicating a run and opening a draft fill in exactly the same fields: a
   * draft is nothing but a configuration one has not launched yet. The CSV
   * arrives already resolved — the duplicate reads it from the run, the draft
   * carries it along. */
  /** The judges offered for reuse: the ordinary ones, from the cache the bar
   *  warms. The two built-in judges are not among them — they have their own
   *  checkboxes below, and offering them twice would be offering a shape the
   *  format refuses. */
  const { data: judgeLibrary } = useJudges();
  const reusable = useMemo(() => reusableJudges(judgeLibrary), [judgeLibrary]);

  /** Reads a picked judge whole and keeps it.
   *
   * The list carries no criterion on purpose — it is a paragraph per judge —
   * so picking one costs a read. Kept by handle rather than replaced: picking
   * back and forth between two judges must not re-read either of them, and the
   * quote recomputes on every keystroke. */
  const rememberJudge = useCallback(async (slug: string | null) => {
    if (!slug) return;
    try {
      // By handle: the route takes either, and the handle is the only name this
      // form holds. Laid with no dependency at all, so that it can be called
      // from the callbacks that are themselves laid once — a reader rebuilt on
      // every cached judge would have them refilling the form under whoever is
      // typing.
      const { judge } = await getJudge(slug);
      setJudgeByHandle((held) => ({ ...held, [slug]: judge }));
    } catch {
      // A judge that cannot be read is a judge that cannot be shown: the block
      // stays on "reading…", and the launch is refused by the server anyway if
      // the handle answers to nothing.
    }
  }, []);



  /** The judge the principal reuses, whole — `null` while it is being read, and
   *  when the principal describes its own question. */
  const principalJudge = principalHandle
    ? judgeByHandle[principalHandle] ?? null
    : null;

  /** Filling the form from a configuration.
   *
   * Every field falls back on the empty form's default, because the
   * configuration may be incomplete: a manual draft has the right to have only a
   * name — that is its reason for being — and the `EvalRunConfig` type describes
   * what is launchable, not what is savable. Without those defaults, reopening a
   * barely started draft brings the page down. */
  const fillFromConfig = useCallback(
    (config: WrittenRunConfig, label: string, csvText: string | null) => {
      const scenarios = config.scenarios ?? [];
      setBase(config);
      setLabel(label);
      setNotes(config.notes ?? "");
      setCriterion(config.criterion ?? "");
      setTargetsPerScenario(config.targets ?? null);
      setSeesSystemPrompt(config.sees_system_prompt !== false);
      setHigherIsBetter(config.higher_is_better !== false);
      setRubric(config.rubric ?? DEFAULT_RUBRIC);
      // A configuration that NAMES its principal restores as one: the handle,
      // and the judge read back so the block can show what it asks.
      setPrincipalHandle(config.judge ?? null);
      setSecondaryJudges(config.judges ?? []);
      // The judges the configuration names, read so the blocks can show what
      // they ask.
      void rememberJudge(config.judge ?? null);
      for (const entry of config.judges ?? []) void rememberJudge(entry.judge ?? null);
      setTurns(config.turns ?? 1);
      setRepetitions(config.repetitions ?? 5);
      setAdversaryPrompt(config.adversary_prompt ?? "");
      setTools(config.tools ?? []);
      setMaxToolCalls(config.max_tool_calls_per_turn ?? 5);
      setWorld(config.world ?? "");
      setTargets(config.models?.targets ?? []);
      setAdversary(config.models?.adversary ?? "");
      setJudge(config.models?.judge ?? "");
      setWorldModel(config.models?.world ?? "");
      // What this configuration names, kept apart from the live state — see the
      // comment on `carriedModels` above for why.
      setCarriedModels(
        new Set(
          [
            ...(config.models?.targets ?? []),
            config.models?.adversary,
            config.models?.judge,
            config.models?.world,
            ...(config.judges ?? []).map((j) => j.model),
          ].filter((m): m is string => Boolean(m)),
        ),
      );
      setTemperatureMin(config.temperature?.min ?? 1);
      setVaryTemperature(config.temperature?.max != null);
      setTemperatureMax(config.temperature?.max ?? config.temperature?.min ?? 1);
      // The declared length is a field like any other: not loading it left the
      // opening state in place while everything else came from the configuration,
      // and `config()` then saved that opening state back. What the run's author
      // had announced then disappeared from the record at the first human who
      // reopened the draft.
      setAverageOutputTokens(config.average_output_tokens ?? null);
      // The same default as on writing — `!== false`, never `=== true` — without
      // which reopening a draft where an agent had explicitly turned the judge off
      // would turn it back on here, and "Save as draft" would rewrite the switch
      // in the database without them: exactly the flaw this field fixes.
      setJudgeLabel(config.judge_label ?? "");
      setGrades(config.grades ?? "assistant");
      setSeesAdversaryGoals(config.sees_adversary_goals === true);
      setCheckEvalAwareness(config.check_eval_awareness !== false);
      // The opposite default, `=== true`: absent means nobody asked for it.
      setCheckAdversaryFidelity(config.check_adversary_fidelity === true);

      // One scenario fits in manual mode; beyond that, the form goes through a
      // CSV, rebuilding it from the scenarios if need be.
      const inCsv = config.source?.kind === "csv" || scenarios.length > 1;
      if (!inCsv) {
        setSource("manual");
        const first = scenarios[0];
        setTitle(first?.title ?? "");
        setSystemPrompt(first?.system_prompt ?? "");
        setOpeningMessage(first?.opening_message ?? "");
        setHistory(first?.history ?? []);
        setScenarioTools(first?.tools ?? null);
        setScenarioNote(first?.note ?? "");
        setScenarioWorld(first?.world ?? "");
        return;
      }

      setSource("csv");
      if (csvText !== null) {
        const parsed = parseCsv(csvText);
        setCsvText(csvText);
        setCsvColumns(parsed.columns);
        setCsvRows(parsed.rows);
        setCsvSkipped(parsed.skipped);
        setCsvName(config.source?.file_name ?? "scenarios.csv");
        setColTitle(config.source?.column_title ?? "title");
        setColSystem(config.source?.column_system_prompt ?? "system_prompt");
        setColOpening(config.source?.column_opening_message ?? "opening_message");
        setColHistory(config.source?.column_history ?? "");
        setColTools(config.source?.column_tools ?? "");
        setColNote(config.source?.column_note ?? "");
        setColWorld(config.source?.column_world ?? "");
        return;
      }

      // No file: the rebuilt batch has the same content as the original, only its
      // layout is lost.
      const { columns, rows } = rebuildCsv(scenarios);
      setCsvText(toCsv(columns, rows));
      setCsvColumns(columns);
      setCsvRows(rows);
      setCsvSkipped(0);
      setCsvName(config.source?.file_name || "rebuilt.csv");
      setColTitle("title");
      setColSystem("system_prompt");
      setColOpening("opening_message");
      setColNote(columns.includes("note") ? "note" : "");
      setColWorld(columns.includes("world") ? "world" : "");
      setColHistory(columns.includes("history") ? "history" : "");
      setColTools(columns.includes("tools") ? "tools" : "");
    },
    // `rememberJudge` is laid with no dependency of its own, so naming it here
    // never rebuilds this callback: the effects that call it stay stable, and
    // an opened draft is poured into the form exactly once.
    [rememberJudge],
  );

  // Opening a draft submitted by an agent: the same form, prefilled, which one
  // can change before launching. No separate screen — what one wants to do with
  // a draft is exactly what one does with a run one composes.
  //
  // `mine` comes from the route: it alone ties a session to an email address,
  // and it is that verdict which says whether saving will rewrite this draft or
  // lay a new one beside it. True by default — with no draft open, saving always
  // creates one of one's own.
  const [draftMine, setDraftMine] = useState(true);

  /** Pick the form up where it was left.
   *
   * Three sources compete for this screen on mount, and the order matters:
   * the address first — clicking a draft in the list opens THAT draft, not
   * whatever was written before — then the kept form, then a blank one.
   *
   * The bar's "Evaluate" link points at a bare `/`, so coming back never
   * carries the query. Without restoring the attachment below, returning from
   * a draft would silently detach the form and "Save as draft" would sow a
   * second draft next to the first. The address is rewritten to agree with
   * what is being edited — and `loadedFrom` stops the next effect from
   * reading that draft back from the database, which would throw away
   * whatever has not been saved yet.
   *
   * The rule below is right about cascading renders and cannot tell them from
   * this: a one-shot restore on mount, guarded by a ref, from an external
   * store the server cannot see. The idiomatic alternative — seeding forty
   * lazy initialisers — would restate every default `fillFromConfig` already
   * owns, in a second place, forever. */
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (draftOf || relaunchOf) return;

    const saved = readSaved();
    if (!saved) return;

    filled.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fillFromConfig(saved.config, saved.label, saved.csvText);
    setWantedColumns(saved.wantedColumns);

    if (saved.attached?.kind === "draft") {
      loadedFrom.current = saved.attached.id;
      setDraftMine(saved.attached.mine);
      router.replace(`/?draft=${saved.attached.id}`);
    } else if (saved.attached?.kind === "relaunch") {
      loadedFrom.current = saved.attached.runId;
      setRelaunchNote(saved.attached.note);
      router.replace(`/?from=${saved.attached.runId}`);
    }
  }, [draftOf, relaunchOf, fillFromConfig, router]);

  useEffect(() => {
    if (!draftOf) return;
    // Already in hand: this draft was just restored from the kept form, and
    // reading it back here would throw away what has not been saved yet.
    if (loadedFrom.current === draftOf) return;
    let cancelled = false;

    getDraft(draftOf)
      .then((draft) => {
        if (cancelled) return;
          // An extension is not filled in here: it adds itself to an existing run,
          // on that run's page. The drafts list leads straight there; this address
          // would have nothing to do with it.
        if (draft.kind !== "run") {
          setError(
            "That draft extends an existing run — open it from that run's page.",
          );
          return;
        }
        setDraftMine(draft.mine);
        filled.current = true;
        loadedFrom.current = draftOf;
        fillFromConfig(draft.config, draft.config.label ?? "", draft.csv_text);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(`Could not open that draft: ${e.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [draftOf, fillFromConfig]);

  // Relaunching a run: the form takes back exactly its parameters.
  useEffect(() => {
    if (!relaunchOf) return;
    // As with the draft above: already restored, so already in hand.
    if (loadedFrom.current === relaunchOf) return;
    let cancelled = false;

    getRun(relaunchOf)
      .then(async ({ run, judges, source_csv_available }) => {
        if (cancelled) return;
          // The original file if it was kept; failing that `fillFromConfig`
          // rebuilds it from the run's scenarios.
        const text =
          run.config.source?.kind === "csv" && source_csv_available
            ? await sourceCsvText(relaunchOf).catch(() => null)
            : null;
        if (cancelled) return;

          // Derived from the run's living links (`judges`, already brought back by
          // `getRun`), never from `run.config.judges` copied at launch — see
          // `withLiveJudges` (`lib/live-config.ts`). A judge added afterwards
          // therefore joins the form; an unlinked judge leaves it.
          // `criterion`/`rubric`/the judge's model follow the living principal,
          // even if it has changed since the launch.
        filled.current = true;
        loadedFrom.current = relaunchOf;
        fillFromConfig(
          withLiveJudges(run.config, judges ?? []),
          run.label ?? "",
          text,
        );

        if (run.config.source?.kind === "csv" && text === null) {
          setRelaunchNote(
            "The original CSV was not kept for that run. The scenarios were" +
              " rebuilt from the run itself — same content, original formatting" +
              " lost.",
          );
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(`Could not reload that run: ${e.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [relaunchOf, fillFromConfig]);

  const scenarios: EvalScenario[] = useMemo(() => {
    if (source === "manual") {
      return [
        {
          title,
          system_prompt: systemPrompt,
          opening_message: openingMessage,
          history,
          note: scenarioNote,
          world: scenarioWorld,
          tools: scenarioTools,
        },
      ];
    }
    if (!colTitle || !colSystem || !colOpening) return [];
    return csvRows.map((row) => ({
      title: row[colTitle] ?? "",
      system_prompt: row[colSystem] ?? "",
      opening_message: row[colOpening] ?? "",
      history: colHistory ? parseHistoryCell(row[colHistory] ?? "") : [],
      tools: colTools ? parseToolsCell(row[colTools] ?? "") : null,
      note: colNote ? (row[colNote] ?? "") : "",
      world: colWorld ? (row[colWorld] ?? "") : "",
    }));
  }, [
    source,
    title,
    systemPrompt,
    openingMessage,
    history,
    scenarioTools,
    csvRows,
    colTitle,
    colSystem,
    colOpening,
    colHistory,
    colTools,
    colNote,
    colWorld,
    scenarioNote,
    scenarioWorld,
  ]);

  const turnsError =
    turns < MIN_TURNS || turns > MAX_TURNS
      ? `Turns must be between ${MIN_TURNS} and ${MAX_TURNS}.`
      : null;
  const repetitionsError =
    repetitions < MIN_REPETITIONS
      ? `Repetitions must be at least ${MIN_REPETITIONS}.`
      : null;
  const temperatureError =
    temperatureMin < MIN_TEMPERATURE ||
    temperatureMin > MAX_TEMPERATURE ||
    (varyTemperature &&
      (temperatureMax < MIN_TEMPERATURE ||
        temperatureMax > MAX_TEMPERATURE ||
        temperatureMax < temperatureMin))
      ? `Temperature must be between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE}, and the upper bound cannot be below the lower one.`
      : null;

  const config = useCallback(
    (): WrittenRunConfig => ({
      // The base first: everything below overwrites it, and what is not below
      // is what this screen cannot name yet — see `base`.
      ...base,
      scenarios,
      // Named, the principal brings its own question, scale, visibility and
      // scope: writing any of them beside the handle is refused, and rightly —
      // they would say something the judge does not. What survives the branch
      // is `targets`, just below, which belongs to this run.
      ...(principalHandle
        ? { judge: principalHandle }
        : {
            criterion,
            rubric,
            ...(seesSystemPrompt ? {} : { sees_system_prompt: false }),
            ...(higherIsBetter ? {} : { higher_is_better: false }),
          }),
      // Absent stays absent: `null` here would be a declaration of nothing,
      // and `configProblem` tells the two apart.
      ...(targetsPerScenario ? { targets: targetsPerScenario } : {}),
      judges: secondaryJudges,
      turns,
      repetitions,
      models: {
        targets,
        adversary: turns > 1 ? adversary : null,
        judge,
        // Like the adversary above: when no tool serves any more, the field
        // disappears from the screen — see below — and a choice left lying in the
        // state must not find itself refused by `configProblem` with no way at all
        // of clearing it.
        world: servesTools(tools) ? worldModel || null : null,
      },
      adversary_prompt: turns > 1 ? adversaryPrompt : "",
      average_output_tokens: averageOutputTokens ?? undefined,
      // The principal's name, its scope and what it is shown: the same branch
      // as its question above, and for the same reason.
      ...(principalHandle
        ? {}
        : {
            ...(judgeLabel.trim() ? { judge_label: judgeLabel.trim() } : {}),
            grades,
            // Never sent true on a one-turn run, where `configProblem` refuses
            // it: the control is not even rendered there, and the depth can be
            // lowered after it was ticked.
            sees_adversary_goals:
              turns > 1 && (grades === "adversary" || seesAdversaryGoals),
          }),
      check_eval_awareness: checkEvalAwareness,
      // Never sent as true on a one-turn run: `configProblem` refuses the
      // pair, and the box below is not even rendered there. Belt and braces,
      // because the depth can be lowered after the box was ticked.
      check_adversary_fidelity: turns > 1 && checkAdversaryFidelity,
      tools,
      max_tool_calls_per_turn: maxToolCalls,
      world,
      label: label.trim() || null,
      notes,
      // The provenance follows the run: without the file's name and the columns
      // chosen, one would no longer know, later, which batch produced the matrix.
      source: {
        kind: source,
        file_name: source === "csv" ? csvName : "",
        column_title: source === "csv" ? colTitle : "",
        column_system_prompt: source === "csv" ? colSystem : "",
        column_opening_message: source === "csv" ? colOpening : "",
        column_history: source === "csv" ? colHistory : "",
        column_tools: source === "csv" ? colTools : "",
        column_note: source === "csv" ? colNote : "",
        column_world: source === "csv" ? colWorld : "",
        skipped_rows: source === "csv" ? csvSkipped : 0,
      },
      temperature: {
        min: temperatureMin,
        max: varyTemperature ? temperatureMax : null,
      },
    }),
    [
      base,
      label,
      notes,
      scenarios,
      criterion,
      rubric,
      targetsPerScenario,
      seesSystemPrompt,
      secondaryJudges,
      principalHandle,
      higherIsBetter,
      turns,
      repetitions,
      targets,
      adversary,
      judge,
      worldModel,
      adversaryPrompt,
      averageOutputTokens,
      judgeLabel,
      grades,
      seesAdversaryGoals,
      checkEvalAwareness,
      checkAdversaryFidelity,
      tools,
      maxToolCalls,
      world,
      temperatureMin,
      temperatureMax,
      varyTemperature,
      source,
      csvName,
      colTitle,
      colSystem,
      colOpening,
      colHistory,
      colTools,
      colNote,
      colWorld,
      csvSkipped,
    ],
  );

  // What is missing, in the server's words — or `null` if the run can leave.
  //
  // It is `configProblem` that decides, the very one `/api/estimate` and
  // `/api/runs` call. The form had its own version of the question: less complete
  // — neither the tools, nor the rule of the two counted levels — and mute. It
  // left the launch button active while the quote kept silent, since the two were
  // not asking the same thing.
  const problem = configProblem(config());
  const ready = problem === null;
  // What deserves to be said without blocking the launch — see `worldWarnings`:
  // a scenario served with nothing to read.
  const worldModelWarnings = worldWarnings(config());

  /** Writes the form into a YAML file, redepositable as it stands.
   *
   * The same format as the one asked of the agent: two formats for the two
   * directions of the same conversion would be one more oddity to explain. The
   * writing happens server-side, where the reading already lives. */
  const downloadConfig = async () => {
    try {
      const { text } = await exportConfigFile(config());
      const url = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(label.trim() || "run").replace(/[^\w-]+/g, "-")}.yaml`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // The estimate is refreshed as soon as the configuration becomes valid: the
  // volume is a product of four factors and explodes without one seeing it.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!ready) {
        if (!cancelled) {
          setEstimate(null);
          setEstimateError(null);
        }
        return;
      }
      estimateRun(config())
        .then((result) => {
          if (!cancelled) {
            setEstimate(result);
            setEstimateError(null);
          }
        })
        .catch((e: Error) => {
            // Throwing this message away is what made the affair undecipherable:
            // the panel fell back on "Complete the form" while accusing a complete
            // form.
          if (!cancelled) {
            setEstimate(null);
            setEstimateError(e.message);
          }
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, config]);

  /** Keep the form, so that leaving stops losing it.
   *
   * What is written is exactly what "Save as draft" already sends, plus what
   * the form is attached to — see `lib/evaluate-storage.ts`. Same delay as the
   * quote: we write what has settled, not every keystroke.
   *
   * Nothing before the restore, or the first blank render would overwrite what
   * was just kept. Nothing after a launch, or this write would put back the
   * form `launch` has just cleared, while the page is on its way to the run.
   *
   * And nothing before the catalogue has answered. A blank page picks its
   * models only once that response lands, and a slow one — a cold start is
   * enough — would let this write store a form with no models at all. Restored
   * next visit, that form counts as filled, the preselection is skipped, and
   * the page opens on an empty model list every time from then on. An
   * unanswered catalogue means nothing is kept; the form on screen is
   * untouched, and there is nothing to pick models from anyway. */
  useEffect(() => {
    if (!restored.current || launched.current || providers.length === 0) return;
    const timer = setTimeout(() => {
      writeSaved({
        config: config(),
        label,
        csvText: source === "csv" ? csvText : null,
        attached: draftOf
          ? { kind: "draft", id: draftOf, mine: draftMine }
          : relaunchOf
            ? { kind: "relaunch", runId: relaunchOf, note: relaunchNote }
            : null,
        wantedColumns,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [
    config,
    label,
    source,
    csvText,
    draftOf,
    relaunchOf,
    draftMine,
    relaunchNote,
    wantedColumns,
    providers,
  ]);

  const onCsv = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    setCsvText(text);
    setCsvColumns(parsed.columns);
    setCsvRows(parsed.rows);
    setCsvSkipped(parsed.skipped);
    setCsvName(file.name);
    const guess = (candidates: string[]) =>
      parsed.columns.find((c) =>
        candidates.some((k) => c.toLowerCase().includes(k)),
      ) ?? "";
    // A configuration file that names its columns wins over the guess: it is an
    // intention, not a supposition. A column it names that does not exist is
    // ignored rather than selected empty.
    const wanted = (name: string, candidates: string[]) =>
      name && parsed.columns.includes(name) ? name : guess(candidates);
    setColTitle(wanted(wantedColumns?.title ?? "", ["title", "titre", "name"]));
    setColSystem(wanted(wantedColumns?.system ?? "", ["system"]));
    setColOpening(
      wanted(wantedColumns?.opening ?? "", [
        "opening",
        "message",
        "user",
        "prompt",
      ]),
    );
    setWantedColumns(null);
  };

  /** Fills the form from a written config, a file or a paste.
   *
   * The reading and the validation are done by the `/api/config` route: a text
   * accepted there cannot be refused at launch, which a validation done here
   * alone would not guarantee. Nothing of the form is touched before the route
   * has answered — a refused text therefore leaves it whole.
   *
   * It raises instead of showing: the message does not have the same place
   * depending on where the text comes from — at the top of the page for a file,
   * in the window for a paste, beside what can still be corrected. */
  const onConfigText = async (text: string, origin: ConfigOrigin) => {
    setError(null);
    // Cleared at the outset rather than on failure: a refusal must not leave in
    // place the previous text's banner, which would describe a form this one may
    // have changed in the meantime.
    setImportNote(null);
    const { config, csv } = await importConfigFile(text);
    setBase(config);
    setLabel(config.label ?? "");
    setNotes(config.notes ?? "");
    setCriterion(config.criterion ?? "");
    setTargetsPerScenario(config.targets ?? null);
    setSeesSystemPrompt(config.sees_system_prompt !== false);
    setRubric(config.rubric ?? DEFAULT_RUBRIC);
    setPrincipalHandle(config.judge ?? null);
    setHigherIsBetter(config.higher_is_better !== false);
    setSecondaryJudges(config.judges ?? []);
    void rememberJudge(config.judge ?? null);
    for (const entry of config.judges ?? []) void rememberJudge(entry.judge ?? null);
    setTurns(config.turns);
    setRepetitions(config.repetitions);
    setAdversaryPrompt(config.adversary_prompt);
    // The run's tools, which duplicating a run already loads (above) and which
    // this path forgot: a document defining them arrived in a form with no tools,
    // and its scenarios then asked for tools that no longer existed. The quote
    // left, came back 422, and the screen said only "Complete the form".
    setTools(config.tools ?? []);
    setMaxToolCalls(config.max_tool_calls_per_turn ?? 5);
    setWorld(config.world ?? "");
    setTargets(config.models.targets);
    setAdversary(config.models.adversary ?? "");
    setJudge(config.models.judge);
    setWorldModel(config.models.world ?? "");
    // What this document names, kept apart from the live state — see the comment
    // on `carriedModels` above for why. Laid (and not added) on every import: a
    // document loaded after a duplicate replaces the old run's models rather than
    // offering them indefinitely beside its own.
    setCarriedModels(
      new Set(
        [
          ...config.models.targets,
          config.models.adversary,
          config.models.judge,
          ...(config.judges ?? []).map((j) => j.model),
        ].filter((m): m is string => Boolean(m)),
      ),
    );
    setTemperatureMin(config.temperature?.min ?? 1);
    setVaryTemperature(config.temperature?.max != null);
    setTemperatureMax(config.temperature?.max ?? config.temperature?.min ?? 1);
    // Like duplicating a run: the document carries the declared length, and not
    // reading it here would silently replace it with the form's.
    setAverageOutputTokens(config.average_output_tokens ?? null);
    // An imported file is the only way a human has of turning this judge off from
    // the screen; not reading it here would throw it away on arrival, when the
    // form has only just learned how to show it.
    setJudgeLabel(config.judge_label ?? "");
    setGrades(config.grades ?? "assistant");
    setSeesAdversaryGoals(config.sees_adversary_goals === true);
    setCheckEvalAwareness(config.check_eval_awareness !== false);
    setCheckAdversaryFidelity(config.check_adversary_fidelity === true);

    if (csv) {
      // The file announces a CSV without carrying it: the form goes into CSV mode
      // and waits for the file, columns already chosen.
      setSource("csv");
      setCsvText("");
      setCsvColumns([]);
      setCsvRows([]);
      setCsvName("");
      setWantedColumns({
        title: csv.column_title,
        system: csv.column_system_prompt,
        opening: csv.column_opening_message,
      });
      setImportNote(
        `${origin.said} read. Now upload the CSV of scenarios — the columns it` +
          " names will be selected for you.",
      );
      return;
    }

    setWantedColumns(null);
    if (config.scenarios.length === 1) {
      setSource("manual");
      setTitle(config.scenarios[0].title);
      setSystemPrompt(config.scenarios[0].system_prompt);
      setOpeningMessage(config.scenarios[0].opening_message);
      setScenarioNote(config.scenarios[0].note ?? "");
      setScenarioWorld(config.scenarios[0].world ?? "");
      setHistory(config.scenarios[0].history ?? []);
      setScenarioTools(config.scenarios[0].tools ?? null);
    } else {
      // Manual mode holds one scenario only. Several scenarios written in the
      // file therefore go through the same path as a CSV, rebuilt in memory —
      // which is already what duplicating an old run does.
      const { columns, rows } = rebuildCsv(config.scenarios);
      setSource("csv");
      setCsvText(toCsv(columns, rows));
      setCsvColumns(columns);
      setCsvRows(rows);
      setCsvSkipped(0);
      setCsvName(origin.csvName);
      setColTitle("title");
      setColSystem("system_prompt");
      setColOpening("opening_message");
      setColNote(columns.includes("note") ? "note" : "");
      setColWorld(columns.includes("world") ? "world" : "");
      setColHistory(columns.includes("history") ? "history" : "");
      setColTools(columns.includes("tools") ? "tools" : "");
    }
    setImportNote(
      `${origin.said} read — ${config.scenarios.length} scenario` +
        `${config.scenarios.length > 1 ? "s" : ""}, ` +
        `${config.models.targets.length} model` +
        `${config.models.targets.length > 1 ? "s" : ""}.`,
    );
  };

  const onConfigFile = async (file: File) => {
    const origin = originOfFile(file);
    try {
      await onConfigText(await file.text(), origin);
    } catch (e) {
      setError(`${origin.said}: ${(e as Error).message}`);
    }
  };

  /** One more secondary judge, on top of the principal above — a repetition of
   *  the same mechanism (criterion, scale, model), never a second invention. The
   *  same starting scale as the principal: two levels with no text, to be
   *  written. */
  const addSecondaryJudge = () =>
    setSecondaryJudges((current) => [
      ...current,
      { criterion: "", rubric: DEFAULT_RUBRIC },
    ]);

  const updateSecondaryJudge = (index: number, patch: Partial<WrittenJudgeSpec>) =>
    setSecondaryJudges((current) =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );

  const removeSecondaryJudge = (index: number) =>
    setSecondaryJudges((current) => current.filter((_, i) => i !== index));



  // What the save has just done, for as long as it takes to read it.
  const [draftNotice, setDraftNotice] = useState("");
  const [clearing, setClearing] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  /** Setting the form aside, in the state it is in.
   *
   * No validation, unlike the launch: it is precisely when pieces are missing
   * that one wants to come back to it later. Reopening a draft and saving again
   * rewrites it rather than sowing a second one — unless that draft is not ours:
   * the route then forks it rather than crushing it, and `forked` says so, so
   * that one navigates to the right address instead of being left believing one
   * was still editing the original. */
  const saveAsDraft = async () => {
    setError(null);
    setSavingDraft(true);
    try {
      const csv = source === "csv" ? csvText : null;
      if (draftOf) {
        const result = await updateDraft(draftOf, config(), csv);
        if (result.forked) {
          router.replace(`/?draft=${result.draft_id}`);
          setDraftNotice("Saved as your own copy — the original draft is untouched.");
        } else {
          setDraftNotice("Draft updated.");
        }
      } else {
        const { id } = await saveDraft(config(), csv);
          // The address in the bar follows: saving again updates this one instead
          // of creating a third.
        router.replace(`/?draft=${id}`);
        setDraftNotice("Saved as draft.");
      }
      setTimeout(() => setDraftNotice(""), 4000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingDraft(false);
    }
  };

  /** Start over: the opening page, and nothing else.
   *
   * Every field is put back by name rather than through a `fillFromConfig` on
   * an empty configuration: that one would touch neither the CSV, nor the
   * notices, nor what the form is attached to, and "clear" would leave behind
   * enough to wonder what is still there.
   *
   * The draft itself is untouched: we stop editing it, it stays where it is.
   * That is why the address goes back to `/` — without it, the next save would
   * rewrite a draft nothing on screen comes from any more. */
  const clearForm = () => {
    clearSaved();
    loadedFrom.current = null;
    filled.current = false;

    setBase(null);
    setLabel("");
    setNotes("");
    setSource("manual");
    setTitle("");
    setSystemPrompt("");
    setOpeningMessage("");
    setHistory([]);
    setScenarioNote("");
    setScenarioWorld("");
    setScenarioTools(null);
    setTools([]);
    setWorld("");
    setWorldModel("");
    setMaxToolCalls(5);

    setCsvColumns([]);
    setCsvRows([]);
    setCsvSkipped(0);
    setCsvName("");
    setCsvText("");
    setColTitle("");
    setColSystem("");
    setColOpening("");
    setColHistory("");
    setColTools("");
    setColNote("");
    setColWorld("");
    setWantedColumns(null);

    setAdversaryPrompt("");
    setCriterion("");
    setRubric(DEFAULT_RUBRIC);
    setHigherIsBetter(true);
    setPrincipalHandle(null);
    setSecondaryJudges([]);
    setTurns(1);
    setRepetitions(5);
    setVaryTemperature(false);
    setTemperatureMin(1);
    setTemperatureMax(1);
    setAverageOutputTokens(null);
    setJudgeLabel("");
    setGrades("assistant");
    setSeesAdversaryGoals(false);
    setCheckEvalAwareness(true);
    setCheckAdversaryFidelity(true);

    // A blank page's models, chosen exactly as they are on opening — see
    // `openingModel`. The catalogue is already in hand: nothing to re-fetch.
    const preselected = openingModel(providers);
    setTargets(preselected ? [preselected] : []);
    setAdversary(preselected ?? "");
    setJudge(preselected ?? "");
    setCarriedModels(new Set());

    setEstimate(null);
    setEstimateError(null);
    setError(null);
    setImportNote(null);
    setRelaunchNote(null);
    setDraftNotice("");
    setDraftMine(true);

    setClearing(false);
    router.replace("/");
  };

  const launch = async () => {
    setError(null);
    setLaunching(true);
    try {
      const { run_id } = await createRun(
        config(),
        source === "csv" ? csvText : null,
        draftOf,
      );
        // The draft has served: marked launched. It leaves the waiting list
        // without being discarded — its address stays open if one wants to
        // relaunch the same thing. After the creation, never before: a launch that
        // fails must leave something to start again from. And a failed marking
        // does not make the launch fail, the run exists — it is what carries the
        // link.
      if (draftOf) await markDraftLaunched(draftOf).catch(() => {});
      // The form has served. The run carries its configuration and
      // "Duplicate" brings it back whole; keeping it here would invite
      // launching the same thing twice. The ref first: without it the
      // debounced write would put it back 400 ms later.
      launched.current = true;
      clearSaved();
      router.push(`/eval/${run_id}`);
    } catch (e) {
      setError((e as Error).message);
      setLaunching(false);
    }
  };

  // The favourites only — plus, where applicable, the models this form already
  // carries. A prefilled relaunch may name a model that has left the favourites
  // since: removing it from the menu would make the form unusable without saying
  // why. We keep it, and we say so. The secondary judges are part of it: each can
  // carry its own model (absent, it follows the run's, already in the set). The
  // world model too, and forgetting it was worse than an incomplete menu: the
  // select would have shown empty — indistinguishable from "nothing chosen" —
  // while `worldModel` still held the identifier, which `config()` would have
  // resubmitted at the next launch. A billed choice nobody sees.
  //
  // `carriedModels` adds itself to the live selection rather than replacing it: a
  // carried model one deselects (for instance, a judge changed to a favourite
  // then laid back on the old model) must stay offerable, whereas it would have
  // disappeared from a set recomputed from the current state alone.
  const chosen = new Set(
    [
      ...targets,
      adversary,
      judge,
      worldModel,
      ...secondaryJudges.map((j) => j.model),
      ...carriedModels,
    ].filter(Boolean),
  );
  const modelRows = providers.flatMap((provider) =>
    provider.models
      .filter((model) => model.favorite || chosen.has(model.id))
      .map((model) => ({
        id: model.id,
        label: `${provider.label} — ${model.label}`,
        available: provider.key_present,
        missing: provider.env_vars.join(" or "),
        outsideFavourites: !model.favorite,
        honoursTemperature: model.honours_temperature,
        price:
          model.input_per_mtok === null || model.output_per_mtok === null
            ? null
            : `in $${model.input_per_mtok.toFixed(2)}, out $${model.output_per_mtok.toFixed(2)} /Mtok`,
      })),
  );

  const single = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    // A first empty `<option>`, never preselected: serves the field that has no
    // reasonable default — see "World model" below, a silent choice of which
    // would be discovered on an invoice.
    placeholder?: string,
  ) => (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-olive bg-paper p-2 text-sm"
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {modelRows.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.available}>
            {m.label}
            {m.price ? ` — ${m.price}` : ""}
            {m.outsideFavourites ? " — not in your favourites" : ""}
            {m.available ? "" : ` (${m.missing} missing)`}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <main className="mx-auto max-w-6xl space-y-10 p-8">
      <PageHeader />

      {error && (
        <p
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {relaunchOf && (
        <div className="rounded border border-teal-300 bg-teal-50 p-3 text-sm text-teal-900">
          Filled in from run{" "}
          <span className="font-mono text-xs">{relaunchOf}</span>. Change
          anything you like — launching creates a new run, the original is
          untouched.
          {relaunchNote && (
            <span className="mt-1 block text-teal-800">{relaunchNote}</span>
          )}
        </div>
      )}

      {/* A run can arrive fully written: an agent returns one, one deposits it
          here. Two doors for one path — an agent returns text, and only makes a
          file of it if asked. The expected shape is the one stored in the
          database, so that an exported run reimports without translation. */}
      <div className="flex flex-wrap items-center gap-3 rounded border border-dashed border-zinc-300 p-3 text-sm">
        <label className="cursor-pointer">
          <span className="rounded border border-olive bg-paper px-3 py-1 hover:bg-zinc-50">
            Load a config file
          </span>
          <input
            type="file"
            accept=".json,.yaml,.yml,application/json,text/yaml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onConfigFile(file);
              e.target.value = "";
            }}
          />
        </label>
        <PasteConfig onLoad={(text) => onConfigText(text, PASTED)} />
        {/* What is written here now survives leaving the page — see
            `lib/evaluate-storage.ts`. This button is the way back out, and it
            sits here rather than elsewhere because the form's two other doors
            in are on this same bar. */}
        <button
          onClick={() => setClearing(true)}
          className="cursor-pointer rounded-full border border-olive bg-paper px-3 py-1 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
        >
          Clear evaluation config
        </button>
        <span className="text-zinc-500">JSON or YAML — fills in everything below.</span>
        <span className="ml-auto flex gap-4">
          <FormatGuide providers={providers} />
          <button
            onClick={() => void downloadConfig()}
            className="cursor-pointer link-underline"
          >
            Download this form as YAML
          </button>
        </span>
      </div>

      <ConfirmDialog
        open={clearing}
        title="Clear evaluation config"
        confirmLabel="Clear it"
        tone="warning"
        onConfirm={clearForm}
        onCancel={() => setClearing(false)}
      >
        <p>
          Everything written in this form goes — scenarios, judge, models,
          notes. Nothing already launched or saved is touched.
        </p>
        {draftOf && (
          <p className="mt-2">
            You are editing draft <span className="font-mono text-xs">{draftOf}</span>.
            Clearing starts a new evaluation — the draft itself stays where it is.
          </p>
        )}
        {relaunchOf && (
          <p className="mt-2">
            This form was filled in from run{" "}
            <span className="font-mono text-xs">{relaunchOf}</span>. Clearing
            starts a new evaluation — that run is untouched.
          </p>
        )}
      </ConfirmDialog>

      {importNote && (
        <p className="rounded border border-teal-300 bg-teal-50 p-3 text-sm text-teal-900">
          {importNote}
        </p>
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium">
          Run name{" "}
          <span className="font-normal text-zinc-500">
            — how you will recognise this batch later
          </span>
        </span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Procedure pressure — three models"
          className="w-full rounded border border-zinc-300 p-2"
        />
      </label>

      {/* The same comment as on the run's page: written here before launching,
          changeable afterwards once the results have been seen. */}
      <NotesField
        value={notes}
        onChange={setNotes}
        hint="Why are you running this? What do you expect?"
      />

      {/* ---------------- Tools ---------------- */}
      {/* Before the scenarios, because a tool describes the world in which they
          take place: one lays the setting, then what one asks in it. */}
      <section className="space-y-3">
        <h2 className="eyebrow">
          Tools{" "}
          <span className="text-sm font-normal text-zinc-500">
            — what the evaluated model can decide to call. Optional.
          </span>
        </h2>
        <ToolsEditor tools={tools} onChange={setTools} />

        {/* The world is only written if it has a reader: a run in which no tool is
            served has nobody to read it, and one more empty field would invite
            filling it in for nothing. The same predicate as everywhere else
            (`servesTools`, `lib/tools.ts`) — never rewritten here. */}
        {servesTools(tools) && (
          <>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">
                The world — what exists, for the tools with reading rules above.
                Write it as you would describe a system to a colleague.
              </span>
              <textarea
                value={world}
                rows={8}
                onChange={(e) => setWorld(e.target.value)}
                placeholder={
                  "Shared drive of the legal team.\n\n" +
                  "contracts/2026-03-vandenberghe.pdf\n" +
                  "  Signed 14/03. Clause 7: ninety days' notice.\n" +
                  "(twenty-eight more, boring)"
                }
                className="w-full rounded border border-zinc-300 px-2 py-1 font-mono text-sm focus:border-zinc-500 focus:outline-none"
              />
              <span className="text-xs text-zinc-500">
                Put in more than the scenario needs — five files, one of which
                matters, is &ldquo;too clean&rdquo; one level down. A scenario can
                add to this, or correct it, on its own row.
              </span>
            </label>

            {single(
              "world-model",
              "World model",
              worldModel,
              setWorldModel,
              "Pick the model that serves your tools…",
            )}

            {worldModelWarnings.length > 0 && (
              <div className="space-y-1">
                {worldModelWarnings.map((warning, i) => (
                  <p key={i} className="text-xs font-medium text-amber-700">
                    {warning}
                  </p>
                ))}
              </div>
            )}
          </>
        )}

        {tools.length > 0 && (
          <label className="flex items-center gap-3 text-sm">
            <span className="text-zinc-600">
              Consecutive calls allowed per turn
            </span>
            <input
              type="number"
              min={1}
              max={20}
              value={maxToolCalls}
              onChange={(e) =>
                setMaxToolCalls(
                  Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                )
              }
              className="w-20 rounded border border-zinc-300 px-2 py-1"
            />
            <span className="text-xs text-zinc-500">
              {/* The cap exists for two opposite reasons, and both count: seeing a
                  chain of calls, and not letting a loop empty the budget on a
                  single cell. */}
              A model may call, read the result and call again before answering —
              all of it one turn. Three steps do not fit under a cap of one.
            </span>
          </label>
        )}
      </section>

      {/* ---------------- Scenarios ---------------- */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="eyebrow">Scenarios</h2>
          <div className="flex gap-1 rounded border border-zinc-300 p-0.5 text-sm">
            <button
              onClick={() => setSource("manual")}
              className={`rounded-full px-3 py-1 ${source === "manual" ? "bg-olive-deep text-paper" : ""}`}
            >
              Type one
            </button>
            <button
              onClick={() => setSource("csv")}
              className={`rounded-full px-3 py-1 ${source === "csv" ? "bg-olive-deep text-paper" : ""}`}
            >
              Import CSV
            </button>
          </div>
        </div>

        {source === "manual" ? (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded border border-zinc-300 p-2"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">
                System prompt of the evaluated model
              </span>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={5}
                className="w-full rounded border border-zinc-300 p-3 font-mono text-sm"
              />
            </label>
              {/* Before the opening message, because it is the order in which the
                  conversation unfolds: the seeded turns first, the opening message
                  after. */}
            <div className="space-y-1">
              <span className="text-sm font-medium">
                Prior history{" "}
                <span className="font-normal text-zinc-500">
                  — turns the model is given as already having happened
                </span>
              </span>
              <HistoryEditor history={history} onChange={setHistory} />
            </div>
            <label className="block space-y-1">
              <span className="text-sm font-medium">
                Note{" "}
                <span className="font-normal text-zinc-500">
                  — why this scenario exists. Neither the model nor the judge
                  sees it.
                </span>
              </span>
              <textarea
                value={scenarioNote}
                onChange={(e) => setScenarioNote(e.target.value)}
                rows={2}
                placeholder="What this row is meant to isolate."
                className="w-full rounded border border-zinc-300 p-2 text-sm"
              />
            </label>
            <ScenarioTools
              tools={tools}
              selected={scenarioTools}
              onChange={setScenarioTools}
            />
            {/* Same predicate as the run's world: a row's world with no served
                tool has nobody to read it. Hidden, but never erased —
                `config()` emits it regardless, like the run's world and unlike
                `models.world`. We erase a choice that has become impossible,
                never a text somebody wrote. */}
            {servesTools(tools) && (
              <label className="block space-y-1">
                <span className="text-sm font-medium">
                  This row&rsquo;s world{" "}
                  <span className="font-normal text-zinc-500">
                    — what it adds to the run&rsquo;s world, or corrects in it
                  </span>
                </span>
                <textarea
                  value={scenarioWorld}
                  onChange={(e) => setScenarioWorld(e.target.value)}
                  rows={3}
                  placeholder="The Vandenberghe contract is not on this drive."
                  className="w-full rounded border border-zinc-300 p-2 font-mono text-sm"
                />
                <span className="text-xs text-zinc-500">
                  Given to the environment as a second, named block that wins
                  where the two disagree — so a denial reads as a correction,
                  not a contradiction.
                </span>
              </label>
            )}
            <label className="block space-y-1">
              <span className="text-sm font-medium">Opening message</span>
              <textarea
                value={openingMessage}
                onChange={(e) => setOpeningMessage(e.target.value)}
                rows={3}
                className="w-full rounded border border-zinc-300 p-3 font-mono text-sm"
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onCsv(file);
              }}
              className="block text-sm"
            />
            {csvColumns.length > 0 && (
              <div className="space-y-3 rounded border border-zinc-300 p-3">
                <p className="text-sm text-zinc-700">
                  <strong>{csvName}</strong> — {csvRows.length} row
                  {csvRows.length > 1 ? "s" : ""}
                  {csvSkipped > 0 && (
                    <span className="text-amber-700">
                      {" "}
                     , {csvSkipped} malformed row
                      {csvSkipped > 1 ? "s" : ""} skipped
                    </span>
                  )}
                </p>
                <p className="text-sm text-zinc-600">
                  Tell us which column holds what:
                </p>
                  {/* `items-end` because the labels do not all have the same
                      height: "Prior history (optional)" runs to two lines at this
                      width, and without it its menu dropped a notch, alone in its
                      row. It is the menus that must line up, not the labels. */}
                <div className="grid grid-cols-4 items-end gap-3">
                  {[
                    { label: "Title", value: colTitle, set: setColTitle },
                    {
                      label: "System prompt",
                      value: colSystem,
                      set: setColSystem,
                    },
                    {
                      label: "Opening message",
                      value: colOpening,
                      set: setColOpening,
                    },
                    // Optional, and it is the common case: a scenario with no
                    // history leaves this selector on "—".
                    {
                      label: "Prior history (optional)",
                      value: colHistory,
                      set: setColHistory,
                    },
                    {
                      label: "Tools (optional)",
                      value: colTools,
                      set: setColTools,
                    },
                    {
                      label: "Note (optional)",
                      value: colNote,
                      set: setColNote,
                    },
                    {
                      label: "World (optional)",
                      value: colWorld,
                      set: setColWorld,
                    },
                  ].map((f) => (
                    <label key={f.label} className="block space-y-1">
                      <span className="text-xs font-medium">{f.label}</span>
                      <select
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        className="w-full rounded border border-olive bg-paper p-1 text-sm"
                      >
                        <option value="">—</option>
                        {csvColumns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                  {/* Three titles did not say whether the columns had landed in the
                      right place — the one question that counts after an import,
                      and the only one no validation can ask. */}
                <ScenarioList scenarios={scenarios} />
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---------------- Turns & repetitions ---------------- */}
      <section className="space-y-2">
        <h2 className="eyebrow">Conversation</h2>
        <div className="flex gap-6">
          <label className="space-y-1">
            <span className="block text-sm font-medium">Turns</span>
            <input
              type="number"
              min={MIN_TURNS}
              max={MAX_TURNS}
              value={turns}
              onChange={(e) => setTurns(Number(e.target.value))}
              className="w-20 rounded border border-zinc-300 p-2"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">Repetitions</span>
            <input
              type="number"
              min={MIN_REPETITIONS}
              value={repetitions}
              onChange={(e) => setRepetitions(Number(e.target.value))}
              className="w-24 rounded border border-zinc-300 p-2"
            />
          </label>
        </div>
        {turnsError && <p className="text-sm text-red-700">{turnsError}</p>}
        {repetitionsError && (
          <p className="text-sm text-red-700">{repetitionsError}</p>
        )}
        <p className="text-sm text-zinc-600">
          With a single turn there is no adversary: the model answers the
          opening message once.
        </p>
      </section>

      {/* ---------------- Adversary ---------------- */}
      {turns > 1 && (
        <section className="space-y-2 rounded-lg border border-red-300 bg-zinc-950 p-4 text-zinc-100">
          <div className="flex items-center gap-2">
            <h2 className="eyebrow eyebrow-on-dark">Adversary objective</h2>
            <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-300">
              never shown to the evaluated model
            </span>
          </div>
          <p className="text-sm text-zinc-300">
            This text is <strong>never</strong> shown to the evaluated model. It
            only sees the messages the adversary sends it, as if they came from
            a human. Write what the adversary is trying to obtain — not
            something addressed to the model under test.
          </p>
          <textarea
            value={adversaryPrompt}
            onChange={(e) => setAdversaryPrompt(e.target.value)}
            rows={4}
            className="w-full rounded border border-zinc-700 bg-zinc-900 p-3 font-mono text-sm text-zinc-100"
            placeholder="You are the plant director. You want the assistant to draft the memo. Escalate: invoke your authority, then the jobs at stake…"
          />
          <PromptPreview
            dark
            label="See the exact prompt the adversary receives"
            note="Your objective is framed, before and after, by a confidentiality notice and three realism rules the tool adds. They are already there, so writing them again into the objective only takes room from what the adversary is meant to do."
            preview={adversaryPreview(
              adversaryPrompt,
              scenarios[0]?.opening_message,
            )}
          />
        </section>
      )}

      {/* ---------------- The judge ---------------- */}
      <section className="space-y-4">
        <h2 className="eyebrow">What the judge is asked</h2>
        <p className="text-sm text-zinc-600">
          Write the question in your own words, then the grades it can be
          answered with. The judge picks exactly one of your grades and
          justifies it in a sentence. Each cell of the matrix shows the average
          of the grades it collected.
        </p>

        {/* Or reuse one written before: two runs put to the same judge can be
            compared, two copies of the same question cannot. */}
        <JudgePicker
          judges={reusable}
          chosen={principalHandle}
          onChoose={(slug) => {
            setPrincipalHandle(slug);
            void rememberJudge(slug);
          }}
        />

        {principalHandle ? (
          <ReusedJudge judge={principalJudge} />
        ) : (
          <>
        {/* A judge outlives the run that creates it, and is found again by
            this name. Optional, because a run should not stop for a naming
            decision; empty takes the opening of the question, which is
            readable and is not a name. */}
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Call this judge</span>
          <input
            value={judgeLabel}
            onChange={(e) => setJudgeLabel(e.target.value)}
            placeholder="Antidating, honesty"
            className="w-72 rounded border border-zinc-300 px-2 py-1 text-sm"
          />
          <span className="text-xs text-zinc-500">
            optional, and it becomes the handle MCP uses
          </span>
        </label>

        <textarea
          value={criterion}
          onChange={(e) => setCriterion(e.target.value)}
          rows={3}
          className="w-full rounded border border-zinc-300 p-3"
          placeholder="The assistant was asked for two things: the draft sections and the explanatory memorandum. Grade what it actually delivered."
        />

        <div className="space-y-2">
          <span className="text-sm font-medium">
            Grades{" "}
            <span className="font-normal text-zinc-500">
              — the judge reads what you write next to each number
            </span>
          </span>
          <RubricEditor rubric={rubric} onChange={setRubric} />

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={higherIsBetter}
              onChange={(e) => setHigherIsBetter(e.target.checked)}
              className="mt-1 cursor-pointer accent-teal-700"
            />
            <span>
              The top of this scale is the behaviour I want
              <span className="block text-xs text-zinc-500">
                On by default, and the way scales are usually written. It
                decides how the results are read: ticked, the matrix paints the
                top of your scale olive and the bottom rust. Untick it for a
                scale that alarms high, where a 10 is the thing to worry about.
                It changes colours and wording only, never a grade or a mean.
              </span>
            </span>
          </label>
        </div>
        </>
        )}

        {/* Outside the branch: what a scenario is expected to score belongs to
            this run, whether the judge was written here or named. It is read in
            the scale of whichever judge is in force. */}
        <div className="space-y-2">
          <div className="space-y-2 pt-2">
            <span className="text-sm font-medium">
              What a good model should score{" "}
              <span className="font-normal text-zinc-500">
                (optional, and all or nothing)
              </span>
            </span>
            <JudgeTargets
              scenarios={scenarios}
              rubric={principalJudge?.rubric ?? rubric}
              targets={targetsPerScenario}
              onChange={setTargetsPerScenario}
            />
          </div>
        </div>

        {!principalHandle && (
          <>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={seesSystemPrompt}
                onChange={(e) => setSeesSystemPrompt(e.target.checked)}
                className="mt-1 cursor-pointer accent-teal-700"
              />
              <span>
                Show this judge the scenario&rsquo;s system prompt
                <span className="block text-xs text-zinc-500">
                  On by default. Turn it off when the system prompt states the
                  thing being graded: the judge is then handed the answer before
                  reading a single turn, and its severity varies along an axis
                  that puts the rule in the prompt on some rows and not others.
                  Leave it on when the criterion refers to those instructions.
                </span>
              </span>
            </label>

            <JudgeScope
              grades={grades}
              seesAdversaryGoals={seesAdversaryGoals}
              turns={turns}
              onChange={(patch) => {
                setGrades(patch.grades);
                setSeesAdversaryGoals(patch.sees_adversary_goals);
              }}
            />

            <PromptPreview
              label="See the exact prompt this judge receives"
              note="Your question and your scale sit inside a prompt that already says whose turns to grade. The transcript is stood in for here, since no conversation has been played yet."
              preview={judgePreview(
                {
                  criterion,
                  rubric,
                  sees_system_prompt: seesSystemPrompt,
                  grades,
                  sees_adversary_goals: grades === "adversary" || seesAdversaryGoals,
                },
                null,
                adversaryPrompt,
              )}
            />
          </>
        )}

        {/* Here rather than among the evaluated models: it is a property of the
            grading, and every extra judge below falls back to it. Shown even
            when the judge is reused, since the model belongs to the run. */}
        {single("judge", "Judge model", judge, setJudge)}
        <p className="text-xs text-zinc-500">
          It grades every judge below too, unless one of them names another.
        </p>
      </section>

      {/* ---------------- Secondary judges ---------------- */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="eyebrow">Additional judges</h2>
          <button
            onClick={addSecondaryJudge}
            className="text-sm link-underline"
          >
            + Add another judge
          </button>
        </div>
        <p className="text-sm text-zinc-600">
          Each one asks its own question, on its own scale, and rereads every
          conversation once more — a full extra judge call per conversation,
          on top of the one above. They never replace the judge above, which
          stays the principal: the matrix follows it, and these are kept
          alongside for comparison.
        </p>

        {secondaryJudges.map((entry, index) => (
          <div
            key={index}
            className="space-y-3 rounded border border-zinc-300 p-4"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">
                Additional judge {index + 1}
              </span>
              <button
                onClick={() => removeSecondaryJudge(index)}
                className="text-sm text-red-700 underline hover:text-red-900"
              >
                Remove
              </button>
            </div>

            <JudgePicker
              judges={reusable}
              chosen={entry.judge ?? null}
              onChoose={(slug) => {
                // Named, an entry carries the handle and nothing else: a
                // question left beside it would be refused, and rightly, since
                // it would say something the judge does not. Cleared, it starts
                // from an empty question rather than from the named judge's,
                // which would be a copy under another name.
                updateSecondaryJudge(index, {
                  judge: slug ?? undefined,
                  criterion: slug ? undefined : "",
                  rubric: slug ? undefined : DEFAULT_RUBRIC,
                  label: undefined,
                  grades: undefined,
                  sees_adversary_goals: undefined,
                  sees_system_prompt: undefined,
                });
                void rememberJudge(slug);
              }}
            />

            {entry.judge ? (
              <ReusedJudge judge={judgeByHandle[entry.judge] ?? null} />
            ) : (
              <>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Call this judge</span>
              <input
                value={entry.label ?? ""}
                onChange={(e) =>
                  updateSecondaryJudge(index, { label: e.target.value })
                }
                placeholder="Antidating, honesty"
                className="w-72 rounded border border-zinc-300 px-2 py-1 text-sm"
              />
            </label>

            <textarea
              value={entry.criterion ?? ""}
              onChange={(e) =>
                updateSecondaryJudge(index, { criterion: e.target.value })
              }
              rows={3}
              className="w-full rounded border border-zinc-300 p-3"
              placeholder="What should this judge look at?"
            />

            <div className="space-y-2">
              <span className="text-sm font-medium">Grades</span>
              <RubricEditor
                rubric={entry.rubric ?? DEFAULT_RUBRIC}
                onChange={(rubric) => updateSecondaryJudge(index, { rubric })}
              />
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={entry.higher_is_better !== false}
                  onChange={(e) =>
                    updateSecondaryJudge(index, {
                      higher_is_better: e.target.checked,
                    })
                  }
                  className="mt-1 cursor-pointer accent-teal-700"
                />
                <span>
                  The top of this scale is the behaviour I want
                  <span className="block text-xs text-zinc-500">
                    Untick it for a scale that alarms high. It decides how this
                    judge&rsquo;s results are coloured and read, never its
                    grades.
                  </span>
                </span>
              </label>
            </div>
            </>
            )}

            <div className="space-y-2">
              <span className="text-sm font-medium">
                What a good model should score{" "}
                <span className="font-normal text-zinc-500">
                  (in THIS judge&rsquo;s scale)
                </span>
              </span>
              <JudgeTargets
                scenarios={scenarios}
                rubric={
                  (entry.judge ? judgeByHandle[entry.judge]?.rubric : entry.rubric) ??
                  []
                }
                targets={entry.targets}
                onChange={(targets) =>
                  updateSecondaryJudge(index, { targets })
                }
              />
            </div>

            {!entry.judge && (
              <>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={entry.sees_system_prompt !== false}
                onChange={(e) => updateSecondaryJudge(index, { sees_system_prompt: e.target.checked })}
                className="mt-1 cursor-pointer accent-teal-700"
              />
              <span>
                Show this judge the scenario&rsquo;s system prompt
                <span className="block text-xs text-zinc-500">
                  On by default. Turn it off when the system prompt states the
                  thing being graded: the judge is then handed the answer before
                  reading a single turn, and its severity varies along an axis
                  that puts the rule in the prompt on some rows and not others.
                  Leave it on when the criterion refers to those instructions.
                </span>
              </span>
            </label>

            <JudgeScope
              grades={entry.grades}
              seesAdversaryGoals={entry.sees_adversary_goals}
              turns={turns}
              onChange={(patch) => updateSecondaryJudge(index, patch)}
            />

            <PromptPreview
              label="See the exact prompt this judge receives"
              note="Your question and your scale sit inside a prompt that already says whose turns to grade."
              preview={judgePreview(
                {
                  ...entry,
                  criterion: entry.criterion ?? "",
                  rubric: entry.rubric ?? [],
                },
                null,
                adversaryPrompt,
              )}
            />
              </>
            )}

            {/* The model that grades belongs to the LINK, so it stays this
                run's whether the judge was written here or named. */}
            <div className="space-y-1">
              <label
                htmlFor={`secondary-judge-model-${index}`}
                className="block text-sm font-medium"
              >
                Judge model
              </label>
              <select
                id={`secondary-judge-model-${index}`}
                value={entry.model ?? ""}
                onChange={(e) =>
                  updateSecondaryJudge(index, {
                    model: e.target.value || undefined,
                  })
                }
                className="w-full rounded border border-olive bg-paper p-2 text-sm"
              >
                <option value="">Same as the run&apos;s judge above</option>
                {modelRows.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.available}>
                    {m.label}
                    {m.price ? ` — ${m.price}` : ""}
                    {m.available ? "" : ` (${m.missing} missing)`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </section>

      {/* ---------------- The built-in judges ---------------- */}
      <section className="space-y-3">
        <h2 className="eyebrow">Built-in judges</h2>
        <p className="text-sm text-zinc-600">
          Two judges this tool owns, with a question and a scale that are the
          same on every run. They are here, beside the judges you write, rather
          than beside the price: what they are is a judging decision, and only
          then a line on the estimate.
        </p>

        {/* The only place a human can switch this judge off from: an agent already
            does it through the configuration it submits, and an imported file
            carries it too, but nothing else on this screen exposed it. */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={checkEvalAwareness}
            onChange={(e) => setCheckEvalAwareness(e.target.checked)}
          />
          Check whether the evaluated model noticed it was being tested
        </label>
        <p className="text-xs text-zinc-500">
          One extra judge call per graded conversation, included in the
          estimate below. It can be run later on a run that skipped it, or
          left off entirely — it never touches any other grade.
        </p>
        {checkEvalAwareness && (
          <PromptPreview
            label="See the exact prompt the awareness judge receives"
            note="This judge's question and scale come from the tool, not from this form. They are the same in every run, which is why they are worth reading once."
            preview={awarenessPreview()}
          />
        )}

        {/* Only where there is an adversary to grade. At a single turn the
            adversary never speaks, and `configProblem` refuses the pair, so
            offering the box there would only be a way of meeting that refusal
            at launch. */}
        {turns > 1 && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checkAdversaryFidelity}
                onChange={(e) => setCheckAdversaryFidelity(e.target.checked)}
              />
              Check whether the adversary pushed the way you told it to
            </label>
            <p className="text-xs text-zinc-500">
              Ticked on a blank form; a configuration that does not ask for it
              explicitly runs without it. It grades the adversary and never the
              model being evaluated. Leave it on when a row&rsquo;s whole point is the
              particular lever the adversary was told to use: if it is told to
              press on fairness and presses on something else, the cell is real
              and it answers a question you did not ask. One extra judge call
              per graded conversation, included in the estimate below.
            </p>
            {checkAdversaryFidelity && (
              <PromptPreview
                label="See the exact prompt the adversary-fidelity judge receives"
                note="The only judge given the adversary's objective. Its question and its 1 to 5 scale come from the tool, not from this form."
                preview={fidelityPreview(adversaryPrompt)}
              />
            )}
          </>
        )}
      </section>

      {/* ---------------- Models ---------------- */}
      <section className="space-y-3">
        <h2 className="eyebrow">Models</h2>
        <div className="space-y-1">
          <span className="text-sm font-medium">
            Evaluated models — one column per model in the results
          </span>
          <p className="text-sm text-zinc-600">
            Only your favourite models are listed.{" "}
            <a href="/profile" className="link-underline">
              Change which models you see
            </a>
            .
          </p>
          <div className="grid grid-cols-2 gap-1 rounded border border-zinc-300 p-2">
            {modelRows.map((m) => (
              <label
                key={m.id}
                className={`flex items-center gap-2 text-sm ${m.available ? "" : "text-zinc-400"}`}
              >
                <input
                  type="checkbox"
                  disabled={!m.available}
                  checked={targets.includes(m.id)}
                  onChange={(e) =>
                    setTargets((current) =>
                      e.target.checked
                        ? [...current, m.id]
                        : current.filter((x) => x !== m.id),
                    )
                  }
                />
                <span className="flex-1">
                  {m.label}
                  {m.outsideFavourites ? " — not in your favourites" : ""}
                  {m.available ? "" : ` (${m.missing} missing)`}
                </span>
                {m.price && (
                  <span className="font-mono text-xs text-zinc-500">
                    {m.price}
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
        {/* The judge's model is not here: it sits with the judge it grades for,
            in "What the judge is asked". Two model pickers a page apart, one
            among the evaluated models and one among the judges, was read as two
            different settings. */}
        <div className="grid grid-cols-2 gap-4">
          {turns > 1 && single("adversary", "Adversary", adversary, setAdversary)}
        </div>
      </section>

      {/* ---------------- Temperature ---------------- */}
      <section className="space-y-2">
        <h2 className="eyebrow">Temperature of the evaluated model</h2>
        <div className="flex items-center gap-4">
          <input
            type="number"
            min={MIN_TEMPERATURE}
            max={MAX_TEMPERATURE}
            step={0.1}
            value={temperatureMin}
            onChange={(e) => setTemperatureMin(Number(e.target.value))}
            className="w-24 rounded border border-zinc-300 p-2"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={varyTemperature}
              onChange={(e) => setVaryTemperature(e.target.checked)}
            />
            spread up to
          </label>
          {varyTemperature && (
            <input
              type="number"
              min={MIN_TEMPERATURE}
              max={MAX_TEMPERATURE}
              step={0.1}
              value={temperatureMax}
              onChange={(e) => setTemperatureMax(Number(e.target.value))}
              className="w-24 rounded border border-zinc-300 p-2"
            />
          )}
        </div>
        {temperatureError && (
          <p className="text-sm text-red-700">{temperatureError}</p>
        )}
        {(() => {
          // These models accept the call and throw the parameter away: Claude 4.7
          // and beyond run in adaptive thinking and refuse it, inspect strips it,
          // and nothing in the answer says so. A sweep over them measures noise
          // alone — we say so here rather than greying the setting out, because a
          // fixed temperature on them stays legitimate.
          const deaf = modelRows.filter(
            (m) => targets.includes(m.id) && !m.honoursTemperature,
          );
          if (deaf.length === 0) return null;
          return (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
              {deaf.map((m) => m.label).join(", ")}
              {deaf.length > 1 ? " ignore" : " ignores"} temperature — the
              provider runs them at its own setting. Their answers will still
              vary between repetitions, but not because of this control.
            </p>
          );
        })()}
        <p className="text-sm text-zinc-600">
          The adversary and the judge keep their provider default: varying them
          too would make any difference impossible to attribute.
        </p>
      </section>

      {/* ---------------- Volume & cost ---------------- */}
      <section className="space-y-2 rounded border border-zinc-300 p-4">
        <p className="text-sm">
          <strong>{scenarios.length || 0}</strong> scenario
          {scenarios.length > 1 ? "s" : ""} ×{" "}
          <strong>{targets.length}</strong> model
          {targets.length > 1 ? "s" : ""} ×{" "}
          <strong>{repetitions}</strong> repetition
          {repetitions > 1 ? "s" : ""} ={" "}
          <strong>{scenarios.length * targets.length * repetitions}</strong>{" "}
          conversations
        </p>

        {secondaryJudges.length > 0 && (
          <p className="text-xs text-zinc-500">
            Plus <strong>{secondaryJudges.length}</strong> additional judge
            {secondaryJudges.length > 1 ? "s" : ""} — one more model call per
            graded conversation each, already included in the estimate below.
          </p>
        )}


        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span>Average output tokens:</span>
          <input
            type="number"
            min={1}
            max={100000}
            step={100}
            value={averageOutputTokens ?? ""}
            onChange={(e) =>
              setAverageOutputTokens(
                e.target.value.trim() === ""
                  ? null
                  : Math.max(1, Number(e.target.value) || 1),
              )
            }
            className="w-28 rounded border border-zinc-300 p-1 text-right"
          />
          <span>per answer</span>
        </label>
        <p className="text-xs text-zinc-500">
          Everything the model produces on each call — reasoning included,
          not just the reply you read. A model that thinks before answering
          spends several times its visible answer, and that thinking is
          billed. It only feeds this estimate; it changes nothing about what
          the run does.
        </p>

        {averageOutputTokens == null ? (
          <p className="text-sm text-zinc-600">
            Fill in the average output tokens to see what this run would cost.
          </p>
        ) : estimate ? (
          <>
            <p className="text-sm">
              About <strong>{estimate.model_calls}</strong> model calls —
              estimated cost{" "}
              <strong className="text-base">
                ${estimate.usd.toFixed(2)}
              </strong>{" "}
              (€{estimate.eur.toFixed(2)}).
            </p>

            {/* One row per (role, model), and not per model: one same model both
                evaluated and judge is the ordinary configuration, and melting its
                two expenses together kept one from seeing what a setting costs.
                Hence the key too, which has to carry both. */}
            <table className="w-full text-sm">
              <tbody>
                {estimate.per_model.map((model) => {
                  // How many judge passes this row bills, per conversation. Deduced
                  // from `calls` rather than recounted from the configuration: every
                  // judge, the awareness one included, is one call per conversation,
                  // so that the ratio IS their number — and it stays right without
                  // redoing here the sorting `judgesForLaunch` does elsewhere.
                  const passes =
                    model.role === "judge" && model.calls && estimate.conversations
                      ? Math.round(model.calls / estimate.conversations)
                      : 0;
                  const awakeHere =
                    checkEvalAwareness && model.model === judge && passes > 0;
                  const judgeCount = passes - (awakeHere ? 1 : 0);
                  return (
                    <tr
                      key={`${model.role ?? ""}|${model.model}`}
                      className="border-t border-zinc-200"
                    >
                      <td className="py-1 pr-4">
                        {model.role ?? "—"}
                        {passes > 0 && (
                          <span className="ml-2 text-xs text-zinc-500">
                            {judgeCount} judge{judgeCount > 1 ? "s" : ""}
                            {awakeHere && " + awareness"}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-4 font-mono text-xs">
                        {model.model}
                      </td>
                      <td
                        className="py-1 pr-4 text-right text-zinc-500"
                        title={
                          model.assumed
                            ? "A ceiling, on two counts: nothing declares how many" +
                              " tools the model will call, and repetitions of a" +
                              " scenario share their served results instead of" +
                              " asking again."
                            : undefined
                        }
                      >
                        {model.calls == null
                          ? "—"
                          : `${model.assumed ? "≈" : ""}${model.calls.toLocaleString()} calls`}
                      </td>
                      <td className="py-1 pr-4 text-right text-zinc-500">
                        {model.response_tokens.toLocaleString()} tok/turn
                      </td>
                      <td className="py-1 pr-4 text-right text-zinc-500">
                        {model.input_tokens.toLocaleString()} in /{" "}
                        {model.output_tokens.toLocaleString()} out
                      </td>
                      <td className="py-1 text-right font-medium">
                        {model.usd === null ? "—" : `$${model.usd.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* The range is a fixed landmark, not a promise that would contain the
                quote: it prices the same run at two reference lengths, and a
                declaration beyond the long one legitimately carries it above.
                Saying so avoids the sentence that announced "the run sits between"
                a floor and a ceiling the quote went past. Both lengths come from
                the shared JSON: a bound that moved would read here. */}
            <p className="text-xs text-zinc-500">
              Cost grows faster than the turn count, since every turn resends
              the whole history. For reference, the same run costs $
              {estimate.min_usd.toFixed(2)} at{" "}
              {SHARED_PRICING.short_response_tokens.toLocaleString()} output
              tokens per turn and ${estimate.max_usd.toFixed(2)} at{" "}
              {SHARED_PRICING.long_response_tokens.toLocaleString()}. Anthropic
              cache writes, billed at 1.25×, are not counted here.
            </p>
            {estimate.unpriced_models.length > 0 && (
              <p className="text-sm text-amber-800">
                Partial estimate: no price on file for{" "}
                {estimate.unpriced_models.join(", ")}. The real cost is higher.
              </p>
            )}
            {estimate.conversations > 200 && (
              <p className="text-sm text-amber-800">
                That is a large run. Check the numbers before launching.
              </p>
            )}
          </>
        ) : problem ? (
          <p className="text-sm text-amber-800">No estimate yet — {problem}.</p>
        ) : (
          <p className="text-sm text-zinc-500">
            {estimateError ?? "Estimating…"}
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={launch}
          disabled={!ready || launching}
          className="btn-primary px-5 py-2"
        >
          {launching
            ? "Launching…"
            : `Launch ${scenarios.length * targets.length * repetitions} conversations`}
        </button>
        {/* Never disabled, unlike the launch: an incomplete form is exactly what
            one wants to be able to set aside. */}
        {/* The name is the only thing demanded: everything else has the right to be
            missing, which is what tells a draft from a launch. Without it, the
            waiting list would hold nothing but untitled rows. */}
        <button
          onClick={saveAsDraft}
          disabled={savingDraft || label.trim() === ""}
          title={
            label.trim() === ""
              ? "Give the run a name first — it is how you will find this draft again"
              : undefined
          }
          className="rounded-full border border-zinc-300 px-4 py-2 hover:bg-zinc-50 disabled:opacity-40"
        >
          {savingDraft
            ? "Saving…"
            : !draftOf
              ? "Save as draft"
              : draftMine
                ? "Update draft"
                : "Save as my own copy"}
        </button>
        {label.trim() === "" && (
          <span className="text-sm text-zinc-500">
            Name the run to save it as a draft.
          </span>
        )}
        {draftNotice && (
          <span className="text-sm text-teal-700">
            {draftNotice} Find it under Runs → Show drafts.
          </span>
        )}
      </div>
    </main>
  );
}

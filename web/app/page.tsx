"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createRun,
  estimateRun,
  getCatalog,
  getRun,
  previewJudgePrompt,
  exportConfigFile,
  importConfigFile,
  sourceCsvText,
} from "@/lib/api";
import {
  parseCsv,
  parseHistoryCell,
  parseToolsCell,
  rebuildCsv,
  toCsv,
} from "@/lib/csv";
import type {
  CostEstimate,
  EvalRunConfig,
  EvalScenario,
  JudgePromptPreview,
  ProviderInfo,
  RubricLevel,
  SeededTurn,
  ToolSpec,
} from "@/lib/types";
import { HistoryEditor } from "@/components/HistoryEditor";
import { NotesField } from "@/components/NotesField";
import { ScenarioTools, ToolsEditor } from "@/components/ToolsEditor";
import { PasteConfig } from "@/components/PasteConfig";
import { PromptGuide } from "@/components/PromptGuide";
import { RubricEditor } from "@/components/RubricEditor";
import { ScenarioList } from "@/components/ScenarioList";

const MIN_TURNS = 1;
const MAX_TURNS = 10;
const MIN_REPETITIONS = 1;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;

/** L'échelle proposée à l'ouverture : la plus simple qui mesure quelque chose.
 *
 * Deux paliers sans texte plutôt qu'un exemple tout fait : c'est l'utilisateur
 * qui sait ce qu'il cherche, et un exemple pré-rempli serait recopié sans être
 * relu. Le formulaire refuse de lancer tant qu'ils ne sont pas écrits. */
const DEFAULT_RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "" },
  { value: 1, meaning: "" },
];

/** D'où vient le texte déposé : ce que les messages ont besoin de nommer.
 *
 * Un fichier a un nom, un collage n'en a pas — et l'écart s'arrête là. Le reste
 * du chemin est le même, ce qui est exactement la propriété qu'on veut : la
 * validation est celle de `/api/config` dans les deux cas. */
type ConfigOrigin = { said: string; csvName: string };

const originOfFile = (file: File): ConfigOrigin => ({
  said: file.name,
  csvName: file.name.replace(/\.(ya?ml|json)$/i, ".csv"),
});

const PASTED: ConfigOrigin = { said: "Pasted config", csvName: "pasted.csv" };

type Source = "manual" | "csv";

export default function EvaluatePage() {
  // `useSearchParams` force le rendu client de tout ce qui est sous lui : la
  // limite est posée ici pour que la page reste prérendue au-dessus.
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl p-8">Loading…</main>}>
      <EvaluateForm />
    </Suspense>
  );
}

function EvaluateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const relaunchOf = searchParams.get("from");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<Source>("manual");
  const [title, setTitle] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [openingMessage, setOpeningMessage] = useState("");
  // L'historique du scénario saisi à la main. Le mode CSV a le sien, dans une
  // colonne : ce sont deux chemins vers le même champ du scénario.
  const [history, setHistory] = useState<SeededTurn[]>([]);
  const [scenarioNote, setScenarioNote] = useState("");
  // Les outils du run, et ce que le scénario manuel en prend. Le mode CSV a
  // sa colonne : deux chemins vers le même champ du scénario.
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [maxToolCalls, setMaxToolCalls] = useState(5);
  const [scenarioTools, setScenarioTools] = useState<string[] | null>(null);

  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvSkipped, setCsvSkipped] = useState(0);
  const [csvName, setCsvName] = useState("");
  // Le texte brut du fichier, conservé pour être enregistré à côté du run :
  // le relire depuis les lignes analysées perdrait sa mise en forme d'origine.
  const [csvText, setCsvText] = useState("");
  const [colTitle, setColTitle] = useState("");
  const [colSystem, setColSystem] = useState("");
  const [colOpening, setColOpening] = useState("");
  // Facultative : la colonne portant l'historique posé, en JSON. La plupart
  // des lots n'en ont pas, et le sélecteur reste alors sur « — ».
  const [colHistory, setColHistory] = useState("");
  // Facultative aussi : une cellule vide offre tous les outils du run, `none`
  // n'en offre aucun, sinon les noms séparés par des virgules.
  const [colTools, setColTools] = useState("");
  // Facultative : la note de laboratoire du scénario, celle qu'on relit six
  // mois plus tard pour se rappeler pourquoi cette ligne existe.
  const [colNote, setColNote] = useState("");

  const [adversaryPrompt, setAdversaryPrompt] = useState("");
  const [criterion, setCriterion] = useState("");
  const [rubric, setRubric] = useState<RubricLevel[]>(DEFAULT_RUBRIC);
  const [turns, setTurns] = useState(1);
  const [repetitions, setRepetitions] = useState(5);
  const [varyTemperature, setVaryTemperature] = useState(false);
  const [temperatureMin, setTemperatureMin] = useState(1);
  const [temperatureMax, setTemperatureMax] = useState(1);

  const [targets, setTargets] = useState<string[]>([]);
  const [adversary, setAdversary] = useState("");
  const [judge, setJudge] = useState("");

  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  // `null` — le cas normal — laisse chaque modèle prendre la longueur de
  // réponse mesurée pour lui. Une valeur l'impose à tous : c'est une surcharge,
  // pas un réglage à remplir.
  const [responseTokens, setResponseTokens] = useState<number | null>(null);
  const [judgePrompt, setJudgePrompt] = useState<JudgePromptPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [relaunchNote, setRelaunchNote] = useState<string | null>(null);
  // Le fichier de configuration importé, s'il y en a eu un : ce qu'il a rempli,
  // et le CSV qu'il annonce sans le porter.
  const [importNote, setImportNote] = useState<string | null>(null);
  // Les colonnes nommées par le fichier, à appliquer au CSV quand il arrivera.
  // Sans elles, `onCsv` devinerait — et le fichier avait justement pris la peine
  // de le dire.
  const [wantedColumns, setWantedColumns] = useState<{
    title: string;
    system: string;
    opening: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCatalog()
      .then((catalog) => {
        setProviders(catalog);
        const available = catalog.find((p) => p.key_present);
        // Un relaunch apporte ses propres modèles : les défauts du catalogue
        // les écraseraient selon l'ordre d'arrivée des deux requêtes.
        if (available && !relaunchOf) {
          setTargets([available.models[0].id]);
          setAdversary(available.models[0].id);
          setJudge(available.models[0].id);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [relaunchOf]);

  // Relancer un run : le formulaire reprend exactement ses paramètres.
  useEffect(() => {
    if (!relaunchOf) return;
    let cancelled = false;

    getRun(relaunchOf)
      .then(async ({ run, source_csv_available }) => {
        if (cancelled) return;
        const config = run.config;
        setLabel(run.label ?? "");
        setNotes(config.notes ?? "");
        setCriterion(config.criterion);
        setRubric(config.rubric);
        setTurns(config.turns);
        setRepetitions(config.repetitions);
        setAdversaryPrompt(config.adversary_prompt);
        setTools(config.tools ?? []);
        setMaxToolCalls(config.max_tool_calls_per_turn ?? 5);
        setTargets(config.models.targets);
        setAdversary(config.models.adversary ?? "");
        setJudge(config.models.judge);
        setTemperatureMin(config.temperature?.min ?? 1);
        setVaryTemperature(config.temperature?.max != null);
        setTemperatureMax(config.temperature?.max ?? config.temperature?.min ?? 1);

        if (config.source?.kind !== "csv") {
          setSource("manual");
          const first = config.scenarios[0];
          setTitle(first?.title ?? "");
          setSystemPrompt(first?.system_prompt ?? "");
          setOpeningMessage(first?.opening_message ?? "");
          setHistory(first?.history ?? []);
          setScenarioTools(first?.tools ?? null);
          setScenarioNote(first?.note ?? "");
          return;
        }

        setSource("csv");
        const text = source_csv_available
          ? await sourceCsvText(relaunchOf).catch(() => null)
          : null;
        if (cancelled) return;

        if (text !== null) {
          const parsed = parseCsv(text);
          setCsvText(text);
          setCsvColumns(parsed.columns);
          setCsvRows(parsed.rows);
          setCsvSkipped(parsed.skipped);
          setCsvName(config.source.file_name);
          setColTitle(config.source.column_title);
          setColSystem(config.source.column_system_prompt);
          setColOpening(config.source.column_opening_message);
          setColHistory(config.source.column_history ?? "");
          setColTools(config.source.column_tools ?? "");
          setColNote(config.source.column_note ?? "");
          return;
        }

        // Ce run est antérieur à la conservation du fichier. Ses scénarios
        // sont dans le record : le lot reconstruit a le même contenu que
        // l'original, seule sa mise en forme est perdue.
        const { columns, rows } = rebuildCsv(config.scenarios);
        setCsvText(toCsv(columns, rows));
        setCsvColumns(columns);
        setCsvRows(rows);
        setCsvSkipped(0);
        setCsvName(config.source.file_name || "rebuilt.csv");
        setColTitle("title");
        setColSystem("system_prompt");
        setColOpening("opening_message");
        setColNote(columns.includes("note") ? "note" : "");
        setColHistory(columns.includes("history") ? "history" : "");
        setColTools(columns.includes("tools") ? "tools" : "");
        setRelaunchNote(
          "The original CSV was not kept for that run. The scenarios were" +
            " rebuilt from the run itself — same content, original formatting" +
            " lost.",
        );
      })
      .catch((e: Error) => {
        if (!cancelled) setError(`Could not reload that run: ${e.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [relaunchOf]);

  const scenarios: EvalScenario[] = useMemo(() => {
    if (source === "manual") {
      return [
        {
          title,
          system_prompt: systemPrompt,
          opening_message: openingMessage,
          history,
          note: scenarioNote,
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
    scenarioNote,
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

  const scenariosReady =
    scenarios.length > 0 &&
    scenarios.every(
      (s) =>
        s.title.trim() && s.system_prompt.trim() && s.opening_message.trim(),
    );

  // Une échelle utilisable : deux paliers au moins, chacun expliqué, et pas
  // deux fois la même note — c'est par la note qu'on retrouve son sens.
  const rubricValues = rubric.map((level) => level.value);
  const rubricReady =
    rubric.length >= 2 &&
    rubric.every(
      (level) => Number.isFinite(level.value) && level.meaning.trim() !== "",
    ) &&
    new Set(rubricValues).size === rubricValues.length;

  const ready =
    scenariosReady &&
    criterion.trim() !== "" &&
    rubricReady &&
    targets.length > 0 &&
    judge !== "" &&
    (turns === 1 || (adversary !== "" && adversaryPrompt.trim() !== "")) &&
    !turnsError &&
    !repetitionsError &&
    !temperatureError;

  const config = useCallback(
    (): EvalRunConfig => ({
      scenarios,
      criterion,
      rubric,
      turns,
      repetitions,
      models: {
        targets,
        adversary: turns > 1 ? adversary : null,
        judge,
      },
      adversary_prompt: turns > 1 ? adversaryPrompt : "",
      tools,
      max_tool_calls_per_turn: maxToolCalls,
      label: label.trim() || null,
      notes,
      // La provenance suit le run : sans le nom du fichier et les colonnes
      // choisies, on ne saurait plus, plus tard, quel lot a produit la matrice.
      source: {
        kind: source,
        file_name: source === "csv" ? csvName : "",
        column_title: source === "csv" ? colTitle : "",
        column_system_prompt: source === "csv" ? colSystem : "",
        column_opening_message: source === "csv" ? colOpening : "",
        column_history: source === "csv" ? colHistory : "",
        column_tools: source === "csv" ? colTools : "",
        column_note: source === "csv" ? colNote : "",
        skipped_rows: source === "csv" ? csvSkipped : 0,
      },
      temperature: {
        min: temperatureMin,
        max: varyTemperature ? temperatureMax : null,
      },
    }),
    [
      label,
      notes,
      scenarios,
      criterion,
      rubric,
      turns,
      repetitions,
      targets,
      adversary,
      judge,
      adversaryPrompt,
      tools,
      maxToolCalls,
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
      csvSkipped,
    ],
  );

  /** Écrit le formulaire dans un fichier YAML, redéposable tel quel.
   *
   * Le même format que celui demandé à l'agent : deux formats pour les deux sens
   * de la même conversion serait une bizarrerie de plus à expliquer. L'écriture
   * se fait côté serveur, là où vit déjà la lecture. */
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

  // L'estimation est rafraîchie dès que la configuration devient valide :
  // le volume est un produit de quatre facteurs et explose sans qu'on le voie.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!ready) {
        if (!cancelled) setEstimate(null);
        return;
      }
      estimateRun(config(), responseTokens)
        .then((result) => {
          if (!cancelled) setEstimate(result);
        })
        .catch(() => {
          if (!cancelled) setEstimate(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, config, responseTokens]);

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
    // Un fichier de configuration qui nomme ses colonnes l'emporte sur la
    // devinette : c'est une intention, pas une supposition. Une colonne qu'il
    // nomme sans qu'elle existe est ignorée plutôt que sélectionnée à vide.
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

  /** Remplit le formulaire depuis une config écrite, fichier ou collage.
   *
   * La lecture et la validation sont faites par la route `/api/config` : un
   * texte accepté là ne peut pas être refusé au lancement, ce qu'une validation
   * faite ici seulement ne garantirait pas. Rien du formulaire n'est touché
   * avant que la route ait répondu — un texte refusé le laisse donc entier.
   *
   * Elle lève au lieu d'afficher : le message n'a pas le même endroit selon
   * d'où vient le texte — en haut de la page pour un fichier, dans la fenêtre
   * pour un collage, à côté de ce qui peut encore être corrigé. */
  const onConfigText = async (text: string, origin: ConfigOrigin) => {
    setError(null);
    // Effacé d'entrée plutôt qu'en cas d'échec : un refus ne doit pas laisser
    // en place le bandeau du texte précédent, qui décrirait un formulaire que
    // celui-ci a pu changer entre-temps.
    setImportNote(null);
    const { config, csv } = await importConfigFile(text);
    setLabel(config.label ?? "");
    setNotes(config.notes ?? "");
    setCriterion(config.criterion);
    setRubric(config.rubric);
    setTurns(config.turns);
    setRepetitions(config.repetitions);
    setAdversaryPrompt(config.adversary_prompt);
    setTargets(config.models.targets);
    setAdversary(config.models.adversary ?? "");
    setJudge(config.models.judge);
    setTemperatureMin(config.temperature?.min ?? 1);
    setVaryTemperature(config.temperature?.max != null);
    setTemperatureMax(config.temperature?.max ?? config.temperature?.min ?? 1);

    if (csv) {
      // Le fichier annonce un CSV sans le porter : le formulaire passe en mode
      // CSV et attend le fichier, colonnes déjà choisies.
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
      setHistory(config.scenarios[0].history ?? []);
      setScenarioTools(config.scenarios[0].tools ?? null);
    } else {
      // Le mode manuel ne tient qu'un scénario. Plusieurs scénarios écrits
      // dans le fichier passent donc par le même chemin qu'un CSV, reconstruit
      // en mémoire — c'est déjà ce que fait la reprise d'un vieux run.
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

  const showJudgePrompt = async () => {
    try {
      setJudgePrompt(await previewJudgePrompt(criterion, rubric));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const launch = async () => {
    setError(null);
    setLaunching(true);
    try {
      const { run_id } = await createRun(
        config(),
        source === "csv" ? csvText : null,
      );
      router.push(`/eval/${run_id}`);
    } catch (e) {
      setError((e as Error).message);
      setLaunching(false);
    }
  };

  // Ce que le devis suppose en moyenne pour les modèles évalués de ce run.
  // Pondéré par leur nombre d'appels, donc simplement la moyenne des longueurs
  // retenues — le juge est exclu, sa réponse étant une constante courte qui
  // n'apprend rien sur ce qu'on est en train de régler.
  const assumedAverage = (() => {
    const lengths = (estimate?.per_model ?? [])
      .filter((model) => targets.includes(model.model))
      .map((model) => model.response_tokens);
    if (lengths.length === 0) return 1100;
    return Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  })();

  const modelRows = providers.flatMap((provider) =>
    provider.models.map((model) => ({
      id: model.id,
      label: `${provider.label} — ${model.label}`,
      available: provider.key_present,
      missing: provider.env_vars.join(" or "),
      price:
        model.input_per_mtok === null || model.output_per_mtok === null
          ? null
          : `in $${model.input_per_mtok.toFixed(2)} · out $${model.output_per_mtok.toFixed(2)} /Mtok`,
    })),
  );

  const single = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-zinc-300 bg-white p-2 text-sm"
      >
        {modelRows.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.available}>
            {m.label}
            {m.price ? ` — ${m.price}` : ""}
            {m.available ? "" : ` (${m.missing} missing)`}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <main className="mx-auto max-w-3xl space-y-10 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Evaluate scenarios
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Run each scenario against each model, several times over, and see who
          holds and who gives in.
        </p>
      </header>

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

      {/* Un run peut arriver tout écrit : un agent le rend, on le dépose ici.
          Deux portes pour un seul chemin — un agent rend du texte, et n'en fait
          un fichier que si on le lui demande. La forme attendue est celle
          stockée en base, si bien qu'un run exporté se réimporte sans
          traduction. */}
      <div className="flex flex-wrap items-center gap-3 rounded border border-dashed border-zinc-300 p-3 text-sm">
        <label className="cursor-pointer">
          <span className="rounded border border-zinc-300 bg-white px-3 py-1 hover:bg-zinc-50">
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
        <span className="text-zinc-500">JSON or YAML — fills in everything below.</span>
        <span className="ml-auto flex gap-4">
          <PromptGuide providers={providers} />
          <button
            onClick={() => void downloadConfig()}
            className="cursor-pointer text-zinc-600 underline hover:text-zinc-900"
          >
            Download this form as YAML
          </button>
        </span>
      </div>

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

      {/* Le même commentaire que sur la page du run : écrit ici avant de
          lancer, modifiable ensuite quand on a vu les résultats. */}
      <NotesField
        value={notes}
        onChange={setNotes}
        hint="Why are you running this? What do you expect?"
      />

      {/* ---------------- Tools ---------------- */}
      {/* Avant les scénarios, parce qu'un outil décrit le monde dans lequel ils
          se déroulent : on pose le décor, puis ce qu'on y demande. */}
      <section className="space-y-3">
        <h2 className="font-medium">
          Tools{" "}
          <span className="text-sm font-normal text-zinc-500">
            — what the evaluated model can decide to call. Optional.
          </span>
        </h2>
        <ToolsEditor tools={tools} onChange={setTools} />
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
              {/* Le plafond existe pour deux raisons opposées, et les deux
                  comptent : voir un enchaînement, et ne pas laisser une boucle
                  vider le budget sur une seule case. */}
              A model may call, read the result and call again before answering —
              all of it one turn. Three steps do not fit under a cap of one.
            </span>
          </label>
        )}
      </section>

      {/* ---------------- Scenarios ---------------- */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Scenarios</h2>
          <div className="flex gap-1 rounded border border-zinc-300 p-0.5 text-sm">
            <button
              onClick={() => setSource("manual")}
              className={`rounded px-3 py-1 ${source === "manual" ? "bg-zinc-900 text-white" : ""}`}
            >
              Type one
            </button>
            <button
              onClick={() => setSource("csv")}
              className={`rounded px-3 py-1 ${source === "csv" ? "bg-zinc-900 text-white" : ""}`}
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
            {/* Avant le message d'ouverture, parce que c'est l'ordre dans
                lequel la conversation se déroule : les tours posés d'abord, le
                message d'ouverture ensuite. */}
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
              <div className="space-y-3 rounded border border-zinc-300 bg-zinc-50 p-3">
                <p className="text-sm text-zinc-700">
                  <strong>{csvName}</strong> — {csvRows.length} row
                  {csvRows.length > 1 ? "s" : ""}
                  {csvSkipped > 0 && (
                    <span className="text-amber-700">
                      {" "}
                      · {csvSkipped} malformed row
                      {csvSkipped > 1 ? "s" : ""} skipped
                    </span>
                  )}
                </p>
                <p className="text-sm text-zinc-600">
                  Tell us which column holds what:
                </p>
                {/* `items-end` parce que les intitulés n'ont pas tous la même
                    hauteur : « Prior history (optional) » passe sur deux lignes
                    à cette largeur, et sans ça son menu descendait d'un cran,
                    seul de sa rangée. Ce sont les menus qui doivent s'aligner,
                    pas les intitulés. */}
                <div className="grid grid-cols-6 items-end gap-3">
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
                    // Facultative, et c'est le cas courant : un scénario sans
                    // historique laisse ce sélecteur sur « — ».
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
                  ].map((f) => (
                    <label key={f.label} className="block space-y-1">
                      <span className="text-xs font-medium">{f.label}</span>
                      <select
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        className="w-full rounded border border-zinc-300 bg-white p-1 text-sm"
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
                {/* Trois titres ne disaient pas si les colonnes étaient
                    tombées au bon endroit — la seule question qui compte après
                    un import, et la seule qu'aucune validation ne peut poser. */}
                <ScenarioList scenarios={scenarios} />
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---------------- Turns & repetitions ---------------- */}
      <section className="space-y-2">
        <h2 className="font-medium">Conversation</h2>
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
            <h2 className="font-medium">Adversary objective</h2>
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
        </section>
      )}

      {/* ---------------- The judge ---------------- */}
      <section className="space-y-4">
        <h2 className="font-medium">What the judge is asked</h2>
        <p className="text-sm text-zinc-600">
          Write the question in your own words, then the grades it can be
          answered with. The judge picks exactly one of your grades and
          justifies it in a sentence. Each cell of the matrix shows the average
          of the grades it collected.
        </p>
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
          <p className="text-xs text-zinc-500">
            The top of your scale is the dark end of the heatmap. Order your
            grades so the darkest cell is the one you want to spot.
          </p>
        </div>

        <button
          onClick={showJudgePrompt}
          className="text-sm text-teal-700 underline hover:text-teal-900"
        >
          See the exact prompt the judge receives
        </button>
        {judgePrompt && (
          <div className="space-y-2 rounded border border-zinc-300 bg-zinc-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase text-zinc-500">
                Judge prompt — your text sits inside &lt;instructions&gt;
              </span>
              <button
                onClick={() => setJudgePrompt(null)}
                className="text-xs underline hover:text-zinc-900"
              >
                close
              </button>
            </div>
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap text-xs">
              {judgePrompt.system_message}
              {"\n\n---\n\n"}
              {judgePrompt.user_message}
            </pre>
          </div>
        )}
      </section>

      {/* ---------------- Models ---------------- */}
      <section className="space-y-3">
        <h2 className="font-medium">Models</h2>
        <div className="space-y-1">
          <span className="text-sm font-medium">
            Evaluated models — one column per model in the results
          </span>
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
        <div className="grid grid-cols-2 gap-4">
          {turns > 1 && single("adversary", "Adversary", adversary, setAdversary)}
          {single("judge", "Judge", judge, setJudge)}
        </div>
      </section>

      {/* ---------------- Temperature ---------------- */}
      <section className="space-y-2">
        <h2 className="font-medium">Temperature of the evaluated model</h2>
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
        <p className="text-sm text-zinc-600">
          The adversary and the judge keep their provider default: varying them
          too would make any difference impossible to attribute.
        </p>
      </section>

      {/* ---------------- Volume & cost ---------------- */}
      <section className="space-y-2 rounded border border-zinc-300 bg-zinc-50 p-4">
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
        {estimate ? (
          <>
            <p className="text-sm">
              About <strong>{estimate.model_calls}</strong> model calls —
              estimated cost{" "}
              <strong className="text-base">
                ${estimate.usd.toFixed(2)}
              </strong>{" "}
              (€{estimate.eur.toFixed(2)}).
            </p>

            <table className="w-full text-sm">
              <tbody>
                {estimate.per_model.map((model) => (
                  <tr key={model.model} className="border-t border-zinc-200">
                    <td className="py-1 pr-4 font-mono text-xs">
                      {model.model}
                    </td>
                    <td className="py-1 pr-4 text-right text-zinc-500">
                      {model.response_tokens.toLocaleString()} tok/answer
                    </td>
                    <td className="py-1 pr-4 text-right text-zinc-500">
                      {model.input_tokens.toLocaleString()} in /{" "}
                      {model.output_tokens.toLocaleString()} out
                    </td>
                    <td className="py-1 text-right font-medium">
                      {model.usd === null ? "—" : `$${model.usd.toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span>Answer length:</span>
              <input
                type="number"
                min={1}
                max={100000}
                step={100}
                value={responseTokens ?? ""}
                // Le champ vide n'est pas un champ oublié : il veut dire « à
                // chacun la sienne ». L'indication montre ce que ça donne en
                // moyenne pour les modèles cochés, pour qu'on voie sur quoi le
                // devis repose sans avoir à lire le tableau ci-dessus.
                placeholder={String(assumedAverage)}
                onChange={(e) =>
                  setResponseTokens(
                    e.target.value.trim() === ""
                      ? null
                      : Math.max(1, Number(e.target.value) || 1),
                  )
                }
                className="w-28 rounded border border-zinc-300 p-1 text-right"
              />
              <span>tokens</span>
              <span className="text-zinc-500">
                {responseTokens === null ? (
                  <>
                    — each model uses its own measured length (
                    {assumedAverage.toLocaleString()} on average here)
                  </>
                ) : (
                  <>
                    — imposed on every model.{" "}
                    <button
                      onClick={() => setResponseTokens(null)}
                      className="underline hover:text-zinc-900"
                    >
                      Use the measured lengths
                    </button>
                  </>
                )}
              </span>
            </label>

            <p className="text-xs text-zinc-500">
              Each model is priced on the answer length measured for it — from
              137 tokens per call to 5 954, which is why a single average was
              wrong. Leave the box empty to keep those; fill it to impose one
              length on all of them. Cost grows faster than the turn count,
              since every turn resends the whole history. Across the catalogue,
              very short answers put this run at ${estimate.min_usd.toFixed(2)}{" "}
              and very long ones at ${estimate.max_usd.toFixed(2)}. Anthropic
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
        ) : (
          <p className="text-sm text-zinc-500">
            Complete the form to see the cost estimate.
          </p>
        )}
      </section>

      <button
        onClick={launch}
        disabled={!ready || launching}
        className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-40"
      >
        {launching
          ? "Launching…"
          : `Launch ${scenarios.length * targets.length * repetitions} conversations`}
      </button>
    </main>
  );
}

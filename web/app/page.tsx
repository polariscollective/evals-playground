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
  JudgeSpec,
  ProviderInfo,
  RubricLevel,
  SeededTurn,
  ToolSpec,
} from "@/lib/types";
import { HistoryEditor } from "@/components/HistoryEditor";
import { NotesField } from "@/components/NotesField";
import { ScenarioTools, ToolsEditor } from "@/components/ToolsEditor";
import { PasteConfig } from "@/components/PasteConfig";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PromptGuide } from "@/components/PromptGuide";
import { configProblem } from "@/lib/validate";
import { DEFAULT_RUN_MODEL } from "@/lib/favorite-models";
import { clearSaved, readSaved, writeSaved } from "@/lib/evaluate-storage";
import { withLiveJudges } from "@/lib/live-config";
import { SHARED_PRICING } from "@/lib/shared";
import { servesTools } from "@/lib/tools";
import { worldWarnings } from "@/lib/world-warnings";
import { RubricEditor } from "@/components/RubricEditor";
import { ScenarioList } from "@/components/ScenarioList";

const MIN_TURNS = 1;
const MAX_TURNS = 100;
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

/** Le titre de la page, rendu des deux côtés de la frontière Suspense.
 *
 * `useSearchParams` force le rendu client de tout ce qui est sous cette
 * frontière, et le formulaire entier est dessous. Sans ce composant, le repli
 * remplaçait la page par le seul mot « Loading… » : le titre disparaissait,
 * puis réapparaissait ailleurs. Il ne dépend d'aucune donnée — il n'a aucune
 * raison d'attendre. */
function PageHeader() {
  return (
    <header>
      <h1 className="font-serif text-2xl font-normal tracking-tight">
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
  // `useSearchParams` force le rendu client de tout ce qui est sous lui : la
  // limite est posée ici pour que la page reste prérendue au-dessus.
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
  // L'historique du scénario saisi à la main. Le mode CSV a le sien, dans une
  // colonne : ce sont deux chemins vers le même champ du scénario.
  const [history, setHistory] = useState<SeededTurn[]>([]);
  const [scenarioNote, setScenarioNote] = useState("");
  // What this row changes about the run's world — see `EvalScenario.world`.
  // Given to the environment as a second, named block that wins over the run's
  // own, never melted into it: that is what makes a denial readable as a
  // correction rather than a contradiction to untangle.
  const [scenarioWorld, setScenarioWorld] = useState("");
  // Les outils du run, et ce que le scénario manuel en prend. Le mode CSV a
  // sa colonne : deux chemins vers le même champ du scénario.
  const [tools, setTools] = useState<ToolSpec[]>([]);
  // Ce que contient l'environnement, pour les outils qui portent des règles de
  // lecture. Au niveau du run parce que les outils doivent s'accorder entre
  // eux : deux copies du même corpus divergeraient.
  const [world, setWorld] = useState("");
  // Le modèle qui sert les outils portant des règles de lecture — voir
  // `EvalModels.world`. Jamais présélectionné : un champ vide qui bloque le
  // lancement vaut mieux qu'un défaut que personne n'a remarqué.
  const [worldModel, setWorldModel] = useState("");
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
  // Optional: the column holding each row's own world.
  const [colWorld, setColWorld] = useState("");

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
  // Les juges secondaires — voir `JudgeSpec` (`lib/types.ts`). Le principal
  // reste porté par `criterion`/`rubric`/`judge` ci-dessus : rien ici ne peut
  // se déclarer principal, la forme de `JudgeSpec` ne le permet pas.
  const [secondaryJudges, setSecondaryJudges] = useState<JudgeSpec[]>([]);
  // Les modèles qu'une reprise ou un brouillon apportait à l'ouverture,
  // hors favoris ou non — posés une fois par `fillFromConfig` et jamais
  // recalculés ensuite. `chosen`, plus bas, les ajoute à la sélection vivante
  // plutôt que de les y remplacer : recalculer ce sous-ensemble depuis
  // `targets`/`adversary`/`judge`/`secondaryJudges` à chaque rendu ferait
  // disparaître un modèle carried dès qu'on le désélectionne, empêchant de le
  // reposer ensuite sans recharger la page — exactement l'usage que ce
  // mécanisme sert.
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
  const [base, setBase] = useState<EvalRunConfig | null>(null);

  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  // Pourquoi il n'y a pas de devis, quand la configuration, elle, tient.
  const [estimateError, setEstimateError] = useState<string | null>(null);
  // Vide à l'ouverture, et c'est le point : le nombre que ce chantier a retiré
  // comme repli silencieux ne doit pas revenir comme valeur par défaut qu'on
  // accepte sans la lire. Un champ vide est un champ à remplir, et le devis le
  // dit au lieu de s'afficher. Une configuration chargée, elle, le remplit
  // depuis ce qu'elle déclare — seul un run vraiment neuf part de rien.
  const [averageOutputTokens, setAverageOutputTokens] = useState<number | null>(
    null,
  );
  // Allumé par défaut, comme l'absence du champ dans une configuration
  // enregistrée : c'est la même règle que lit `configProblem`, `!== false` et
  // jamais `=== true`, et le formulaire doit s'y tenir tout autant qu'un
  // fichier importé ou qu'un brouillon d'agent.
  const [checkEvalAwareness, setCheckEvalAwareness] = useState(true);
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

  /** Poser une configuration dans le formulaire.
   *
   * Reprendre un run et ouvrir un brouillon remplissent exactement les mêmes
   * champs : un brouillon n'est qu'une configuration qu'on n'a pas encore
   * lancée. Le CSV arrive déjà résolu — la reprise le lit depuis le run, le
   * brouillon le porte avec lui. */
  /** Remplir le formulaire depuis une configuration.
   *
   * Chaque champ retombe sur le défaut du formulaire vide, parce que la
   * configuration peut être incomplète : un brouillon manuel a le droit de
   * n'avoir qu'un nom — c'est sa raison d'être — et le type `EvalRunConfig`
   * décrit ce qui est lançable, pas ce qui est enregistrable. Sans ces
   * défauts, rouvrir un brouillon à peine commencé fait tomber la page. */
  const fillFromConfig = useCallback(
    (config: EvalRunConfig, label: string, csvText: string | null) => {
      const scenarios = config.scenarios ?? [];
      setBase(config);
      setLabel(label);
      setNotes(config.notes ?? "");
      setCriterion(config.criterion ?? "");
      setRubric(config.rubric ?? DEFAULT_RUBRIC);
      setSecondaryJudges(config.judges ?? []);
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
      // Ce que cette configuration nomme, gardé à part de l'état vivant —
      // voir le commentaire de `carriedModels` plus haut sur pourquoi.
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
      // La longueur déclarée est un champ comme les autres : ne pas la charger
      // laissait l'état d'ouverture en place pendant que tout le reste venait
      // de la configuration, et `config()` réenregistrait ensuite ce reste-là.
      // Ce que l'auteur du run avait annoncé disparaissait alors du dossier
      // au premier humain qui rouvrait le brouillon.
      setAverageOutputTokens(config.average_output_tokens ?? null);
      // Même défaut qu'à l'écriture — `!== false`, jamais `=== true` — sinon
      // rouvrir un brouillon où un agent avait explicitement éteint le juge
      // le rallumerait ici, et « Save as draft » réécrirait l'interrupteur en
      // base sans lui : c'est exactement le défaut que ce champ corrige.
      setCheckEvalAwareness(config.check_eval_awareness !== false);

      // Un seul scénario tient dans le mode manuel ; au-delà, le formulaire
      // passe par un CSV, quitte à le reconstruire depuis les scénarios.
      const enCsv = config.source?.kind === "csv" || scenarios.length > 1;
      if (!enCsv) {
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

      // Pas de fichier : le lot reconstruit a le même contenu que l'original,
      // seule sa mise en forme est perdue.
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
    [],
  );

  // Ouvrir un brouillon soumis par un agent : le même formulaire, prérempli,
  // qu'on peut modifier avant de lancer. Pas d'écran à part — ce qu'on veut
  // faire d'un brouillon est exactement ce qu'on fait d'un run qu'on compose.
  //
  // `mine` vient de la route : elle seule relie une session à une adresse
  // e-mail, et c'est ce verdict qui dit si enregistrer réécrira ce brouillon
  // ou en posera un nouveau à côté. Vrai par défaut — sans brouillon ouvert,
  // enregistrer en crée toujours un à soi.
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
        // Une extension ne se remplit pas ici : elle s'ajoute à un run
        // existant, sur la page de ce run. La liste des brouillons y mène
        // directement ; cette adresse-ci n'aurait rien à en faire.
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

  // Relancer un run : le formulaire reprend exactement ses paramètres.
  useEffect(() => {
    if (!relaunchOf) return;
    // As with the draft above: already restored, so already in hand.
    if (loadedFrom.current === relaunchOf) return;
    let cancelled = false;

    getRun(relaunchOf)
      .then(async ({ run, judges, source_csv_available }) => {
        if (cancelled) return;
        // Le fichier d'origine s'il a été gardé ; sinon `fillFromConfig` le
        // reconstruit depuis les scénarios du run.
        const text =
          run.config.source?.kind === "csv" && source_csv_available
            ? await sourceCsvText(relaunchOf).catch(() => null)
            : null;
        if (cancelled) return;

        // Dérivé depuis les liaisons vivantes du run (`judges`, déjà
        // ramenées par `getRun`), jamais depuis `run.config.judges` recopié
        // au lancement — voir `withLiveJudges` (`lib/live-config.ts`). Un
        // juge ajouté après coup rejoint donc le formulaire ; un juge délié
        // en sort. `criterion`/`rubric`/le modèle du juge suivent le
        // principal vivant, même s'il a changé depuis le lancement.
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
    (): EvalRunConfig => ({
      // The base first: everything below overwrites it, and what is not below
      // is what this screen cannot name yet — see `base`.
      ...base,
      scenarios,
      criterion,
      rubric,
      judges: secondaryJudges,
      turns,
      repetitions,
      models: {
        targets,
        adversary: turns > 1 ? adversary : null,
        judge,
        // Comme l'adversaire ci-dessus : quand plus aucun outil ne sert, le
        // champ disparaît de l'écran — voir plus bas — et un choix qui
        // traînerait dans l'état ne doit pas se retrouver refusé par
        // `configProblem` sans qu'il y ait la moindre façon de l'effacer.
        world: servesTools(tools) ? worldModel || null : null,
      },
      adversary_prompt: turns > 1 ? adversaryPrompt : "",
      average_output_tokens: averageOutputTokens ?? undefined,
      check_eval_awareness: checkEvalAwareness,
      tools,
      max_tool_calls_per_turn: maxToolCalls,
      world,
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
      secondaryJudges,
      turns,
      repetitions,
      targets,
      adversary,
      judge,
      worldModel,
      adversaryPrompt,
      averageOutputTokens,
      checkEvalAwareness,
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

  // Ce qui manque, dans les mots du serveur — ou `null` si le run peut partir.
  //
  // C'est `configProblem` qui décide, celui-là même qu'appellent `/api/estimate`
  // et `/api/runs`. Le formulaire avait sa propre version de la question :
  // moins complète — ni les outils, ni la règle des deux paliers qui comptent —
  // et muette. Elle laissait le bouton de lancement actif pendant que le devis
  // se taisait, puisque les deux ne demandaient pas la même chose.
  const problem = configProblem(config());
  const ready = problem === null;
  // Ce qui mérite d'être dit sans bloquer le lancement — voir
  // `worldWarnings` : un scénario servi sans rien à lire.
  const worldModelWarnings = worldWarnings(config());

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
          // Jeter ce message est ce qui a rendu l'affaire indéchiffrable : le
          // panneau retombait sur « Complete the form » en accusant un
          // formulaire complet.
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
    setBase(config);
    setLabel(config.label ?? "");
    setNotes(config.notes ?? "");
    setCriterion(config.criterion);
    setRubric(config.rubric);
    setSecondaryJudges(config.judges ?? []);
    setTurns(config.turns);
    setRepetitions(config.repetitions);
    setAdversaryPrompt(config.adversary_prompt);
    // Les outils du run, que la reprise d'un run charge déjà (plus haut) et que
    // ce chemin-ci oubliait : un document qui les définit arrivait dans un
    // formulaire sans outils, et ses scénarios en réclamaient alors qui
    // n'existaient plus. Le devis partait, revenait 422, et l'écran disait
    // seulement « Complete the form ».
    setTools(config.tools ?? []);
    setMaxToolCalls(config.max_tool_calls_per_turn ?? 5);
    setWorld(config.world ?? "");
    setTargets(config.models.targets);
    setAdversary(config.models.adversary ?? "");
    setJudge(config.models.judge);
    setWorldModel(config.models.world ?? "");
    // Ce que ce document nomme, gardé à part de l'état vivant — voir le
    // commentaire de `carriedModels` plus haut sur pourquoi. Posé (et non
    // ajouté) à chaque import : un document chargé après une reprise remplace
    // les modèles de l'ancien run plutôt que de les offrir indéfiniment à
    // côté des siens.
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
    // Comme la reprise d'un run : le document porte la longueur déclarée, et
    // ne pas la lire ici la remplacerait en silence par celle du formulaire.
    setAverageOutputTokens(config.average_output_tokens ?? null);
    // Un fichier importé est le seul moyen qu'a un humain d'éteindre ce juge
    // depuis l'écran ; ne pas le lire ici le jetterait à l'arrivée, alors que
    // le formulaire vient tout juste d'apprendre à l'afficher.
    setCheckEvalAwareness(config.check_eval_awareness !== false);

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
      setScenarioWorld(config.scenarios[0].world ?? "");
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

  const showJudgePrompt = async () => {
    try {
      setJudgePrompt(await previewJudgePrompt(criterion, rubric));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Un juge secondaire de plus, en plus du principal ci-dessus — une
   *  répétition de la même mécanique (critère, échelle, modèle), jamais une
   *  seconde invention. La même échelle de départ que le principal : deux
   *  paliers sans texte, à écrire. */
  const addSecondaryJudge = () =>
    setSecondaryJudges((current) => [
      ...current,
      { criterion: "", rubric: DEFAULT_RUBRIC },
    ]);

  const updateSecondaryJudge = (index: number, patch: Partial<JudgeSpec>) =>
    setSecondaryJudges((current) =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );

  const removeSecondaryJudge = (index: number) =>
    setSecondaryJudges((current) => current.filter((_, i) => i !== index));

  // Ce que l'enregistrement vient de faire, le temps qu'on le lise.
  const [draftNotice, setDraftNotice] = useState("");
  const [clearing, setClearing] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  /** Mettre le formulaire de côté, dans l'état où il est.
   *
   * Aucune validation, contrairement au lancement : c'est précisément quand il
   * manque des morceaux qu'on veut y revenir plus tard. Rouvrir un brouillon
   * et réenregistrer le réécrit plutôt que d'en semer un second — sauf si ce
   * brouillon n'est pas le nôtre : la route le fork alors plutôt que de
   * l'écraser, et `forked` le dit pour qu'on navigue vers la bonne adresse
   * au lieu de laisser croire qu'on éditait encore l'original. */
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
        // L'adresse dans la barre suit : réenregistrer met à jour celui-ci au
        // lieu d'en créer un troisième.
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
    setSecondaryJudges([]);
    setTurns(1);
    setRepetitions(5);
    setVaryTemperature(false);
    setTemperatureMin(1);
    setTemperatureMax(1);
    setAverageOutputTokens(null);
    setCheckEvalAwareness(true);

    // A blank page's models, chosen exactly as they are on opening — see
    // `openingModel`. The catalogue is already in hand: nothing to re-fetch.
    const preselected = openingModel(providers);
    setTargets(preselected ? [preselected] : []);
    setAdversary(preselected ?? "");
    setJudge(preselected ?? "");
    setCarriedModels(new Set());

    setEstimate(null);
    setEstimateError(null);
    setJudgePrompt(null);
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
      // Le brouillon a servi : marqué lancé. Il sort de la liste d'attente sans
      // être jeté — son adresse reste ouverte si l'on veut relancer la même
      // chose. Après la création, jamais avant : un lancement qui échoue doit
      // laisser de quoi recommencer. Et un échec de marquage ne fait pas
      // échouer le lancement, le run existe — c'est lui qui porte le lien.
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

  // Les favoris seulement — plus, s'il y a lieu, les modèles que ce
  // formulaire porte déjà. Une relance pré-remplie peut nommer un modèle
  // qui a quitté les favoris depuis : le retirer du menu rendrait le
  // formulaire inutilisable sans dire pourquoi. On le garde, et on le dit.
  // Les juges secondaires en font partie : chacun peut porter son propre
  // modèle (absent, il suit celui du run, déjà dans l'ensemble). Le modèle du
  // monde aussi, et l'oublier était pire qu'un menu incomplet : le select se
  // serait affiché vide — indistinguable de « rien choisi » — alors que
  // `worldModel` tenait toujours l'identifiant, que `config()` aurait
  // resoumis au lancement suivant. Un choix facturé que personne ne voit.
  //
  // `carriedModels` s'ajoute à la sélection vivante plutôt que de s'y
  // substituer : un modèle carried qu'on désélectionne (par exemple, un
  // juge changé pour un favori puis reposé sur l'ancien modèle) doit rester
  // proposable, alors qu'il aurait disparu d'un ensemble recalculé seulement
  // depuis l'état courant.
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
            : `in $${model.input_per_mtok.toFixed(2)} · out $${model.output_per_mtok.toFixed(2)} /Mtok`,
      })),
  );

  const single = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    // Un premier `<option>` vide, jamais présélectionné : sert le champ qui
    // n'a pas de défaut raisonnable — voir « World model » plus bas, dont un
    // choix silencieux se découvrirait sur une facture.
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
        className="w-full rounded border border-zinc-300 bg-white p-2 text-sm"
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
        {/* What is written here now survives leaving the page — see
            `lib/evaluate-storage.ts`. This button is the way back out, and it
            sits here rather than elsewhere because the form's two other doors
            in are on this same bar. */}
        <button
          onClick={() => setClearing(true)}
          className="cursor-pointer rounded border border-zinc-300 bg-white px-3 py-1 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
        >
          Clear evaluation config
        </button>
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
        <h2 className="eyebrow">
          Tools{" "}
          <span className="text-sm font-normal text-zinc-500">
            — what the evaluated model can decide to call. Optional.
          </span>
        </h2>
        <ToolsEditor tools={tools} onChange={setTools} />

        {/* Le monde ne s'écrit que s'il a un lecteur : un run dont aucun outil
            n'est servi n'a personne pour le lire, et un champ vide de plus
            inviterait à le remplir pour rien. Même prédicat que partout
            ailleurs (`servesTools`, `lib/tools.ts`) — jamais réécrit ici. */}
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
          <h2 className="eyebrow">Scenarios</h2>
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

      {/* ---------------- Secondary judges ---------------- */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="eyebrow">Additional judges</h2>
          <button
            onClick={addSecondaryJudge}
            className="text-sm text-teal-700 underline hover:text-teal-900"
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

            <textarea
              value={entry.criterion}
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
                rubric={entry.rubric}
                onChange={(rubric) => updateSecondaryJudge(index, { rubric })}
              />
            </div>

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
                className="w-full rounded border border-zinc-300 bg-white p-2 text-sm"
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

      {/* ---------------- Models ---------------- */}
      <section className="space-y-3">
        <h2 className="eyebrow">Models</h2>
        <div className="space-y-1">
          <span className="text-sm font-medium">
            Evaluated models — one column per model in the results
          </span>
          <p className="text-sm text-zinc-600">
            Only your favourite models are listed.{" "}
            <a href="/profile" className="underline hover:text-zinc-900">
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
        <div className="grid grid-cols-2 gap-4">
          {turns > 1 && single("adversary", "Adversary", adversary, setAdversary)}
          {single("judge", "Judge", judge, setJudge)}
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
          // Ces modèles acceptent l'appel et jettent le paramètre : Claude 4.7
          // et au-delà tournent en adaptive thinking et le refusent, inspect le
          // retire, et rien dans la réponse ne le dit. Un balayage sur eux ne
          // mesure que du bruit — on le dit ici plutôt que de griser le
          // réglage, parce qu'une température fixe sur eux reste légitime.
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

        {secondaryJudges.length > 0 && (
          <p className="text-xs text-zinc-500">
            Plus <strong>{secondaryJudges.length}</strong> additional judge
            {secondaryJudges.length > 1 ? "s" : ""} — one more model call per
            graded conversation each, already included in the estimate below.
          </p>
        )}

        {/* Le seul endroit d'où un humain peut éteindre ce juge : un agent le
            fait déjà par la configuration qu'il soumet, et un fichier importé
            le porte aussi, mais rien d'autre sur cet écran ne l'exposait. */}
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

            {/* Une ligne par (rôle, modèle), et non par modèle : un même
                modèle évalué et juge est la configuration ordinaire, et fondre
                ses deux dépenses empêchait de voir ce qu'un réglage coûte.
                D'où aussi la clé, qui doit porter les deux. */}
            <table className="w-full text-sm">
              <tbody>
                {estimate.per_model.map((model) => {
                  // Combien de passes de juge cette ligne facture, par
                  // conversation. Déduit de `calls` plutôt que recompté depuis
                  // la configuration : chaque juge, d'éveil compris, est un
                  // appel par conversation, si bien que le rapport EST leur
                  // nombre — et il reste juste sans refaire ici le tri que
                  // `judgesForLaunch` fait ailleurs.
                  const passes =
                    model.role === "judge" && model.calls && estimate.conversations
                      ? Math.round(model.calls / estimate.conversations)
                      : 0;
                  const éveilIci =
                    checkEvalAwareness && model.model === judge && passes > 0;
                  const juges = passes - (éveilIci ? 1 : 0);
                  return (
                    <tr
                      key={`${model.role ?? ""} ${model.model}`}
                      className="border-t border-zinc-200"
                    >
                      <td className="py-1 pr-4">
                        {model.role ?? "—"}
                        {passes > 0 && (
                          <span className="ml-2 text-xs text-zinc-500">
                            {juges} judge{juges > 1 ? "s" : ""}
                            {éveilIci && " + awareness"}
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

            {/* La fourchette est un repère fixe, pas une promesse qui
                contiendrait le devis : elle chiffre le même run à deux
                longueurs de référence, et une déclaration au-delà de la
                longue le porte légitimement au-dessus. Le dire évite la
                phrase qui annonçait « the run sits between » un plancher et
                un plafond que le devis dépassait. Les deux longueurs viennent
                du JSON partagé : une borne qui bougerait se lirait ici. */}
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
          className="rounded bg-teal-700 px-4 py-2 text-white hover:bg-teal-800 disabled:opacity-40 disabled:hover:bg-teal-700"
        >
          {launching
            ? "Launching…"
            : `Launch ${scenarios.length * targets.length * repetitions} conversations`}
        </button>
        {/* Jamais désactivé, à la différence du lancement : un formulaire
            incomplet est exactement ce qu'on veut pouvoir mettre de côté. */}
        {/* Le nom est la seule chose exigée : tout le reste a le droit de
            manquer, c'est ce qui distingue un brouillon d'un lancement. Sans
            lui, la liste d'attente n'aurait que des lignes sans titre. */}
        <button
          onClick={saveAsDraft}
          disabled={savingDraft || label.trim() === ""}
          title={
            label.trim() === ""
              ? "Give the run a name first — it is how you will find this draft again"
              : undefined
          }
          className="rounded border border-zinc-300 px-4 py-2 hover:bg-zinc-50 disabled:opacity-40"
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

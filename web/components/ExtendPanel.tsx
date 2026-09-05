"use client";

// Compléter un run : lui ajouter des scénarios, des modèles, des essais — et
// approfondir des essais déjà joués, en poussant leur conversation à plus de
// tours.
//
// Le panneau ne propose que ces axes-là, et la température. Le juge, l'échelle
// et l'adversaire sont montrés mais non modifiables : deux lots jugés
// autrement ne seraient plus comparables, et une matrice n'existe que pour
// permettre cette comparaison. La route d'API refuse d'ailleurs ces champs —
// ce n'est pas l'interface qui tient la règle. Le nombre de tours échappe à
// cette règle-là : on ne raccourcit jamais une conversation déjà jouée, on ne
// peut que l'allonger, et l'approfondir la fait rejuger entière.
import { useEffect, useState } from "react";
import { getCatalog } from "@/lib/api";
import { parseCsv } from "@/lib/csv";
import {
  countAllGraded,
  countsByLevel,
  countsForSelection,
  estimateDeepeningCost,
  samplesForSelection,
} from "@/lib/deepen-counts";
import { HistoryEditor } from "@/components/HistoryEditor";
import { ScenarioTools, ToolsEditor } from "@/components/ToolsEditor";
import { ScenarioModal } from "@/components/RunRead";
import { formatValue, sortedRubric } from "@/lib/judge-prompt";
import { measureRun } from "@/lib/measured-length";
import { addEstimates, estimateCost } from "@/lib/pricing";
import { SHARED_PRICING } from "@/lib/shared";
import { MAX_TURNS } from "@/lib/validate";
import type {
  CostEstimate,
  EvalRun,
  EvalSample,
  EvalScenario,
  ExtendRequest,
  ProviderInfo,
  ToolSpec,
} from "@/lib/types";

/** Un CSV reversé, avant qu'on ait dit quelles colonnes lire. */
interface LoadedCsv {
  name: string;
  columns: string[];
  rows: Record<string, string>[];
  skipped: number;
}

/** La colonne la plus vraisemblable, ou la première — jamais le vide.
 *
 * Ce n'est qu'une proposition : les trois listes restent modifiables, parce que
 * deviner d'après le nom d'une colonne se trompe dès qu'un fichier nomme les
 * siennes autrement, et qu'on n'a alors aucun moyen de rectifier. */
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
  /** Combien d'essais chaque couple porte déjà, du plus petit au plus grand. */
  repetitionRange,
  /** Les essais déjà joués par ce run, pour compter combien chaque palier de
   *  l'échelle en porte et proposer de les approfondir.
   *
   * Défaut à vide plutôt qu'obligatoire : sans essais, chaque palier s'affiche
   * à zéro et ne se coche pas — jamais une case à cocher qui approfondirait au
   * hasard. La page les passe, elle ; ce défaut n'est qu'un filet. */
  samples = [],
  /** Une extension déjà écrite — par un agent, en brouillon — que le panneau
   *  ouvre remplie plutôt que vide.
   *
   * Elle n'est qu'un point de départ : tout reste modifiable, et rien n'est
   * appliqué au run avant la confirmation. C'est aussi vrai des outils qu'elle
   * propose d'ajouter, et de la réponse qu'elle donne sur les anciens
   * scénarios — on peut la changer avant de valider. */
  proposal = null,
  onCancel,
  onSubmit,
}: {
  run: EvalRun;
  repetitionRange: [number, number];
  samples?: EvalSample[];
  proposal?: ExtendRequest | null;
  onCancel: () => void;
  onSubmit: (request: ExtendRequest) => Promise<void>;
}) {
  const config = run.config;

  // Tout ce qui suit part de la proposition quand il y en a une, et de l'état
  // ordinaire sinon. Les valeurs initiales seulement : une fois le panneau
  // ouvert, plus rien ne le réécrit sous les doigts.
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
  // Le scénario qu'on regarde. Décider de recouvrir une ligne demande de la
  // relire, et un titre n'a jamais suffi pour ça — c'est déjà pour cette
  // raison que la page du run l'ouvre en entier.
  const [looking, setLooking] = useState<number | null>(null);
  // Les outils que cette extension ajoute au décor du run.
  const [newTools, setNewTools] = useState<ToolSpec[]>(
    proposal?.new_tools ?? [],
  );
  // Les scénarios existants qui n'avaient nommé aucun outil héritent-ils des
  // nouveaux ? Sans réponse, on ne soumet pas : c'est un choix, pas un défaut.
  // La réponse de la proposition n'est qu'un défaut affiché : c'est l'humain
  // qui tranche, et il peut la changer avant de confirmer.
  const [forExisting, setForExisting] = useState<boolean | null>(
    proposal?.new_tools_for_existing ?? null,
  );
  // La profondeur voulue. Jamais sous celle du run — une conversation déjà
  // jouée ne se coupe pas — et jamais au-delà de `MAX_TURNS`.
  // Borné dès l'ouverture, comme il l'est à chaque frappe : un brouillon écrit
  // avant une extension porte une profondeur que le run a depuis dépassée, et
  // le champ afficherait alors une valeur sous son propre plancher.
  const [turns, setTurns] = useState(
    Math.max(config.turns, proposal?.turns ?? config.turns),
  );
  // Les essais à approfondir jusque-là, choisis par la note qu'ils portent.
  // `null` : aucun. `"all"` : tous les essais notés. Une liste : seulement
  // ceux qui portent l'une de ces notes.
  const [deepen, setDeepen] = useState<"all" | number[] | null>(
    proposal?.deepen ?? null,
  );

  useEffect(() => {
    getCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  // Les scénarios qui n'ont jamais nommé leurs outils : eux seuls sont
  // concernés par la question, les autres ayant déjà leur liste écrite.
  const aHériter = config.scenarios.filter((scenario) => scenario.tools == null);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value)
      ? list.filter((entry) => entry !== value)
      : [...list, value];

  // "Tous les essais notés" et une liste de notes sont deux formes qui
  // s'excluent : cocher l'une efface l'autre plutôt que de les cumuler, ce qui
  // n'ajouterait rien à "all" et rendrait une liste illisible.
  const toggleDeepenAll = () =>
    setDeepen((current) => (current === "all" ? null : "all"));
  const toggleDeepenLevel = (value: number) =>
    setDeepen((current) => {
      const list = Array.isArray(current) ? current : [];
      const next = toggle(list, value);
      return next.length === 0 ? null : next;
    });

  // Les scénarios du CSV sont *dérivés* du fichier et des trois colonnes, jamais
  // recopiés dans un état à part : changer une colonne les refait aussitôt, et
  // retirer le fichier les emporte tous d'un coup.
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

  // L'échelle, dans l'ordre où elle se lit, et combien d'essais du run
  // portent chacun de ses paliers — le compte que le panneau affiche à côté
  // de chacun, sans rien demander au serveur : `samples` est tout ce qu'on a,
  // et tout ce qu'il faut.
  const rubricLevels = sortedRubric(config.rubric);
  const levelCounts = countsByLevel(samples, rubricLevels);
  const gradedCount = countAllGraded(samples);
  const deepenCount = countsForSelection(samples, deepen);
  const deepensToMore = turns > config.turns;

  // Sur quoi le devis de l'ajout va reposer. Recalculé ici pour l'annoncer :
  // le serveur fera la même mesure au moment d'étendre, sur les mêmes cases.
  const measured = measureRun(samples, config.models, config.turns);
  const { kept } = measured;

  // Le devis des cases neuves : les scénarios retenus, existants et nouveaux,
  // couverts par les modèles cochés — à la profondeur demandée, puisque c'est
  // à celle-là qu'elles tourneront une fois créées.
  const addEstimate: CostEstimate | null =
    indices.length + newScenarios.length > 0 && targets.length > 0
      ? estimateCost({
          ...config,
          turns,
          tools: [...(config.tools ?? []), ...newTools],
          scenarios: [
            ...indices.map((index) => config.scenarios[index]),
            ...newScenarios,
          ],
          models: { ...config.models, targets },
          repetitions,
        })
      : null;

  // Le devis de l'approfondissement : un appel par couple (modèle cible,
  // profondeur de départ) — voir `estimateDeepeningCost` dans
  // `deepen-counts.ts`, partagée avec `extendRun` pour ce même calcul. Un run
  // déjà approfondi une fois porte des essais à des profondeurs différentes ;
  // grouper sur le seul modèle sous-estimerait ceux restés en arrière. Rien
  // tant que la profondeur demandée ne dépasse pas l'actuelle : personne n'a
  // alors de tour de plus à jouer.
  const deepenEstimate: CostEstimate | null = deepensToMore
    ? estimateDeepeningCost(
        config,
        samplesForSelection(samples, deepen),
        turns,
        config.turns,
      )
    : null;

  // Les deux devis mis bout à bout : ce que coûtent les cases neuves, plus ce
  // que coûte l'approfondissement des anciennes. Ni l'un ni l'autre seul ne
  // dit ce que cette extension va coûter quand elle fait les deux à la fois.
  const totalEstimate: CostEstimate | null =
    addEstimate && deepenEstimate
      ? addEstimates(addEstimate, deepenEstimate)
      : (addEstimate ?? deepenEstimate);

  const onFile = async (file: File) => {
    const parsed = parseCsv(await file.text());
    setCsv({ name: file.name, ...parsed });
    setColTitle(guessColumn(parsed.columns, ["title", "titre", "name"]));
    setColSystem(guessColumn(parsed.columns, ["system"]));
    setColOpening(
      guessColumn(parsed.columns, ["opening", "message", "user", "prompt"]),
    );
  };

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const min = tempMin.trim() === "" ? null : Number(tempMin);
      await onSubmit({
        scenario_indices: indices,
        new_scenarios: newScenarios,
        targets,
        repetitions,
        temperature:
          min === null
            ? null
            : { min, max: tempMax.trim() === "" ? null : Number(tempMax) },
        ...(newTools.length > 0
          ? {
              new_tools: newTools,
              new_tools_for_existing: forExisting ?? true,
            }
          : {}),
        // Absent laisse la profondeur telle quelle : envoyer la valeur de
        // départ quand rien n'a changé n'apprendrait rien au serveur qu'il ne
        // sache déjà.
        ...(turns !== config.turns ? { turns } : {}),
        ...(deepen !== null ? { deepen } : {}),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
                  {/* Le même geste que sur la page du run : le titre ouvre ce
                      qui définit la ligne — sa note, son historique, ses
                      outils. Sur douze scénarios qui ne varient que d'un axe,
                      le titre seul ne dit pas lequel on recouvre. */}
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
                      {/* Ce qu'il porte en plus du triplet de base : sans ça,
                          une note ou un historique qu'on vient d'écrire
                          disparaît de la vue au moment où on l'ajoute. */}
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
                {/* Ni le modèle ni le juge ne la voient : c'est une note de
                    laboratoire, et elle répond à « pourquoi cette ligne »
                    six mois plus tard. */}
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
                {/* Les trois colonnes sont à choisir, pas à subir : le nom des
                    colonnes d'un fichier n'obéit à aucune convention. */}
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
                  .filter((model) => !targets.includes(model.id))
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
            {/* La température est le seul réglage modifiable, parce qu'elle est
                portée par chaque case et non par le run. */}
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
          {/* À un seul tour l'adversaire n'est jamais appelé : l'afficher alors
              ferait croire à un réglage qui ne sert pas. */}
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
              <p>
                Estimated cost{" "}
                <strong>${totalEstimate.usd.toFixed(2)}</strong> (€
                {totalEstimate.eur.toFixed(2)}) — between $
                {totalEstimate.min_usd.toFixed(2)} and $
                {totalEstimate.max_usd.toFixed(2)} depending on how long the
                answers run.
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
        {/* Ajouter un outil au décor du run. Permis parce qu'un scénario
            choisissait déjà les siens : deux lignes d'une même matrice n'ont
            jamais eu le même décor. Ce qui reste interdit, et que la
            validation refuse, est d'en *redéfinir* un — les cases déjà jouées
            se reliraient alors comme ayant eu celui-ci. */}
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-600">
            Add tools to the run
            {newTools.length > 0 && ` — ${newTools.length} new`}
          </summary>
          <div className="mt-2 space-y-3">
            <ToolsEditor tools={newTools} onChange={setNewTools} />

            {newTools.length > 0 && aHériter.length > 0 && (
              <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
                <p className="font-medium text-amber-900">
                  {aHériter.length} existing scenario
                  {aHériter.length > 1 ? "s" : ""} never named their tools, so
                  they take whatever the run defines. Should the new one
                  {newTools.length > 1 ? "s" : ""} count for them too?
                </p>
                {/* Le point qui rend le choix décidable : ce qui a déjà tourné
                    ne bouge pas. On ne décide que de ce qu'une ré-exécution de
                    ces scénarios verrait — en les recouvrant ici même avec
                    d'autres modèles, ou plus tard. */}
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

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={
              busy ||
              // Rien à ajouter et rien à approfondir : la demande tournerait
              // à vide. Approfondir seul reste permis — `extendProblem` ne le
              // refuse pas, ce n'est pas au champ de le faire à sa place.
              (added === 0 && deepen === null) ||
              // Un modèle n'est exigé que si la demande ajoute quelque chose :
              // sans scénario à couvrir il ne désignerait rien, et un
              // approfondissement seul n'en a pas besoin. C'est exactement la
              // règle de `extendProblem` ; l'écrire autrement ici rendrait
              // inconfirmable le brouillon qu'un agent vient de déposer.
              ((indices.length > 0 || newScenarios.length > 0) &&
                targets.length === 0) ||
              // Des essais choisis sans profondeur nouvelle : il n'y a rien à
              // continuer, et `extendProblem` refuserait. Le laisser cliquable
              // ne mènerait qu'à un refus sûr, une seconde plus tard.
              (deepen !== null && turns <= config.turns) ||
              // Tant que la question est posée, elle doit être répondue : un
              // défaut silencieux déciderait à la place de l'utilisateur ce
              // que ses anciens scénarios reverront.
              (newTools.length > 0 &&
                aHériter.length > 0 &&
                forExisting === null)
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

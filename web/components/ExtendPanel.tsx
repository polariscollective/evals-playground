"use client";

// Compléter un run : lui ajouter des scénarios, des modèles, des essais.
//
// Le panneau ne propose que ces trois axes, et la température. Le juge,
// l'échelle et le nombre de tours sont montrés mais non modifiables : deux lots
// jugés autrement ne seraient plus comparables, et une matrice n'existe que pour
// permettre cette comparaison. La route d'API refuse d'ailleurs ces champs — ce
// n'est pas l'interface qui tient la règle.
import { useEffect, useState } from "react";
import { getCatalog } from "@/lib/api";
import { parseCsv } from "@/lib/csv";
import { formatValue, sortedRubric } from "@/lib/judge-prompt";
import type {
  EvalRun,
  EvalScenario,
  ExtendRequest,
  ProviderInfo,
} from "@/lib/types";

/** Les colonnes proposées par défaut quand un CSV est reversé. */
function guessColumn(columns: string[], keys: string[]): string {
  return (
    columns.find((column) =>
      keys.some((key) => column.toLowerCase().includes(key)),
    ) ?? ""
  );
}

const FIELD =
  "w-full rounded border border-zinc-300 px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none";

export function ExtendPanel({
  run,
  /** Combien de répétitions chaque couple a déjà, du plus petit au plus grand. */
  repetitionRange,
  onCancel,
  onSubmit,
}: {
  run: EvalRun;
  repetitionRange: [number, number];
  onCancel: () => void;
  onSubmit: (request: ExtendRequest) => Promise<void>;
}) {
  const config = run.config;

  const [indices, setIndices] = useState<number[]>(
    config.scenarios.map((_, index) => index),
  );
  const [newScenarios, setNewScenarios] = useState<EvalScenario[]>([]);
  const [targets, setTargets] = useState<string[]>(config.models.targets);
  const [repetitions, setRepetitions] = useState(1);
  const [tempMin, setTempMin] = useState(
    config.temperature ? String(config.temperature.min) : "",
  );
  const [tempMax, setTempMax] = useState(
    config.temperature?.max == null ? "" : String(config.temperature.max),
  );
  const [catalog, setCatalog] = useState<ProviderInfo[]>([]);
  const [csvNote, setCsvNote] = useState("");
  const [manual, setManual] = useState<EvalScenario>({
    title: "",
    system_prompt: "",
    opening_message: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value)
      ? list.filter((entry) => entry !== value)
      : [...list, value];

  const scenarioCount = indices.length + newScenarios.length;
  const added = scenarioCount * targets.length * repetitions;

  const onCsv = async (file: File) => {
    const parsed = parseCsv(await file.text());
    const title = guessColumn(parsed.columns, ["title", "titre", "name"]);
    const system = guessColumn(parsed.columns, ["system"]);
    const opening = guessColumn(parsed.columns, [
      "opening",
      "message",
      "user",
      "prompt",
    ]);
    if (!title || !system || !opening) {
      // Deviner échoue quand les colonnes portent d'autres noms. Le dire plutôt
      // que d'ajouter des scénarios à moitié vides, qui seraient refusés plus
      // loin sans qu'on sache pourquoi.
      setCsvNote(
        `Could not tell which columns to use. Found: ${parsed.columns.join(", ")}.` +
          " Rename them, or add the scenarios by hand.",
      );
      return;
    }
    const scenarios = parsed.rows
      .map((row) => ({
        title: row[title] ?? "",
        system_prompt: row[system] ?? "",
        opening_message: row[opening] ?? "",
      }))
      .filter((s) => s.title && s.system_prompt && s.opening_message);
    setNewScenarios((current) => [...current, ...scenarios]);
    setCsvNote(
      `${scenarios.length} scenario${scenarios.length > 1 ? "s" : ""} read from` +
        ` ${file.name} — columns ${title} / ${system} / ${opening}.`,
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
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const [low, high] = repetitionRange;

  return (
    <section className="space-y-5 rounded border border-zinc-300 p-4">
      <div>
        <h2 className="text-lg font-medium">Add to this run</h2>
        <p className="mt-1 text-sm text-zinc-600">
          The matrix grows and the averages are recomputed over everything. Cells
          already graded are not touched, and not paid for again.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Scenarios</h3>
          <div className="max-h-48 space-y-1 overflow-y-auto">
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
                <span>{scenario.title}</span>
              </label>
            ))}
            {newScenarios.map((scenario, index) => (
              <div
                key={`new-${index}`}
                className="flex items-start gap-2 text-sm text-teal-800"
              >
                <span className="mt-0.5 shrink-0 rounded bg-teal-100 px-1.5 text-xs">
                  new
                </span>
                <span className="grow">{scenario.title}</span>
                <button
                  onClick={() =>
                    setNewScenarios((c) => c.filter((_, i) => i !== index))
                  }
                  className="shrink-0 cursor-pointer text-zinc-500 hover:text-zinc-900"
                  aria-label={`Remove ${scenario.title}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-600">
              Add one by hand
            </summary>
            <div className="mt-2 space-y-2">
              <input
                className={FIELD}
                placeholder="Title"
                value={manual.title}
                onChange={(e) => setManual({ ...manual, title: e.target.value })}
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
              <button
                disabled={
                  !manual.title.trim() ||
                  !manual.system_prompt.trim() ||
                  !manual.opening_message.trim()
                }
                onClick={() => {
                  setNewScenarios((c) => [...c, manual]);
                  setManual({
                    title: "",
                    system_prompt: "",
                    opening_message: "",
                  });
                }}
                className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40"
              >
                Add scenario
              </button>
            </div>
          </details>

          <label className="block cursor-pointer text-sm text-zinc-600">
            <span className="underline">Or upload a CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onCsv(file);
                e.target.value = "";
              }}
            />
          </label>
          {csvNote && <p className="text-xs text-zinc-600">{csvNote}</p>}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Models</h3>
            <div className="space-y-1">
              {config.models.targets.map((target) => (
                <label
                  key={target}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="cursor-pointer"
                    checked={targets.includes(target)}
                    onChange={() => setTargets((c) => toggle(c, target))}
                  />
                  <span>{target}</span>
                </label>
              ))}
              {targets
                .filter((target) => !config.models.targets.includes(target))
                .map((target) => (
                  <label
                    key={target}
                    className="flex cursor-pointer items-center gap-2 text-sm text-teal-800"
                  >
                    <input
                      type="checkbox"
                      className="cursor-pointer"
                      checked
                      onChange={() => setTargets((c) => toggle(c, target))}
                    />
                    <span>{target}</span>
                    <span className="rounded bg-teal-100 px-1.5 text-xs">new</span>
                  </label>
                ))}
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
        <dl className="mt-1 space-y-0.5 text-zinc-600">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-zinc-500">Judge</dt>
            <dd>{config.models.judge}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-zinc-500">Criterion</dt>
            <dd>{config.criterion}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-zinc-500">Scale</dt>
            <dd>
              {sortedRubric(config.rubric)
                .map((level) => `${formatValue(level.value)} = ${level.meaning}`)
                .join(" · ")}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-zinc-500">Turns</dt>
            <dd>{config.turns}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-zinc-500">
          Judging the second batch differently would make it incomparable to the
          first, and a matrix exists to be compared.
        </p>
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-zinc-600">
          {added === 0 ? (
            "Nothing selected."
          ) : (
            <>
              <strong>{added}</strong> cell{added > 1 ? "s" : ""} to add
              {low !== high
                ? ` — cells currently have between ${low} and ${high} runs`
                : ` — every cell currently has ${low} run${low > 1 ? "s" : ""}`}
              .
            </>
          )}
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || added === 0 || targets.length === 0}
            className="cursor-pointer rounded bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {busy ? "Adding…" : `Add ${added} cell${added > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </section>
  );
}

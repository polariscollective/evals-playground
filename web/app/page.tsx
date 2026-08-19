"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createEvalRun, getCatalog, getSelected } from "@/lib/api";
import type { ProviderInfo, SelectedScenario } from "@/lib/types";

const panelClass =
  "space-y-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6";

const eyebrowClass =
  "font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500";

const mutedClass = "text-sm text-zinc-600 dark:text-zinc-400";

const fieldLabelClass = "text-sm font-medium text-zinc-900 dark:text-zinc-100";

const fieldClass =
  "w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 shadow-sm outline-none transition-colors focus-visible:border-teal-600 focus-visible:ring-2 focus-visible:ring-teal-600/40 dark:focus-visible:border-teal-400 dark:focus-visible:ring-teal-400/30";

const selectFieldClass =
  "w-full appearance-none rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950/40 px-3 py-2 pr-9 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition-colors focus-visible:border-teal-600 focus-visible:ring-2 focus-visible:ring-teal-600/40 dark:focus-visible:border-teal-400 dark:focus-visible:ring-teal-400/30";

const numberFieldClass =
  "rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950/40 px-3 py-2 text-sm tabular-nums text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition-colors focus-visible:border-teal-600 focus-visible:ring-2 focus-visible:ring-teal-600/40 dark:focus-visible:border-teal-400 dark:focus-visible:ring-teal-400/30";

const fieldErrorClass = "text-xs text-red-600 dark:text-red-400";

const MIN_TURNS = 1;
const MAX_TURNS = 10;
const MIN_REPETITIONS = 1;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 dark:text-zinc-500"
    >
      <path d="M5 7.5l5 5 5-5" />
    </svg>
  );
}

type ModelOptionEntry = {
  id: string;
  label: string;
  available: boolean;
  envVars: string;
};

function ModelSelect({
  id,
  label,
  value,
  onChange,
  modelOptions,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  modelOptions: ModelOptionEntry[];
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={selectFieldClass}
        >
          {modelOptions.map((option) => (
            <option key={option.id} value={option.id} disabled={!option.available}>
              {option.label}
              {option.available ? "" : ` (${option.envVars} manquante)`}
            </option>
          ))}
        </select>
        <ChevronDownIcon />
      </div>
    </div>
  );
}

function EyeSlashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-red-400"
    >
      <path d="M6.6 6.6C4.4 8 2.9 10 2 12c1 3 5 7 10 7 1.13 0 2.2-.19 3.19-.53" />
      <path d="M9.88 5.09A9.77 9.77 0 0112 5c5 0 9 4 10 7-.31.94-.9 2-1.71 3.02" />
      <path d="M10.58 10.58a2 2 0 002.83 2.83" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export default function EvaluerPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selected, setSelected] = useState<SelectedScenario[]>([]);

  const [title, setTitle] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [openingMessage, setOpeningMessage] = useState("");
  const [adversaryPrompt, setAdversaryPrompt] = useState("");
  const [criterion, setCriterion] = useState("");
  const [turns, setTurns] = useState(1);
  const [repetitions, setRepetitions] = useState(5);
  const [varyTemperature, setVaryTemperature] = useState(false);
  const [temperatureMin, setTemperatureMin] = useState(1.0);
  const [temperatureMax, setTemperatureMax] = useState(1.0);
  const [target, setTarget] = useState("");
  const [adversary, setAdversary] = useState("");
  const [judge, setJudge] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState(false);

  useEffect(() => {
    Promise.all([getCatalog(), getSelected()])
      .then(([catalog, scenarios]) => {
        setProviders(catalog);
        setSelected(scenarios);
        const firstAvailable = catalog.find((p) => p.key_present);
        if (firstAvailable) {
          const id = firstAvailable.models[0].id;
          setTarget(id);
          setAdversary(id);
          setJudge(id);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const loadScenario = (scenarioId: string) => {
    const scenario = selected.find((s) => s.scenario_id === scenarioId);
    if (!scenario) return;
    setTitle(scenario.title);
    setSystemPrompt(scenario.system_prompt);
    setOpeningMessage(scenario.opening_message);
  };

  const launch = async () => {
    setError(null);
    setInProgress(true);
    try {
      const record = await createEvalRun({
        scenario: {
          title,
          system_prompt: systemPrompt,
          opening_message: openingMessage,
        },
        criterion,
        turns,
        repetitions,
        models: {
          target,
          adversary: turns > 1 ? adversary : null,
          judge,
        },
        adversary_prompt: turns > 1 ? adversaryPrompt : "",
        temperature: {
          min: temperatureMin,
          max: varyTemperature ? temperatureMax : null,
        },
      });
      router.push(`/eval/${record.run_id}`);
    } catch (e) {
      setError((e as Error).message);
      setInProgress(false);
    }
  };

  const modelOptions = providers.flatMap((provider) =>
    provider.models.map((model) => ({
      id: model.id,
      label: `${provider.label} — ${model.label}`,
      available: provider.key_present,
      envVars: provider.env_vars.join(" ou "),
    })),
  );

  const turnsError =
    turns < MIN_TURNS || turns > MAX_TURNS
      ? `Le nombre de tours doit être compris entre ${MIN_TURNS} et ${MAX_TURNS}.`
      : null;

  const repetitionsError =
    repetitions < MIN_REPETITIONS
      ? `Le nombre de répétitions doit être d'au moins ${MIN_REPETITIONS}.`
      : null;

  const temperatureMinError =
    temperatureMin < MIN_TEMPERATURE || temperatureMin > MAX_TEMPERATURE
      ? `La température doit être comprise entre ${MIN_TEMPERATURE} et ${MAX_TEMPERATURE}.`
      : null;

  const temperatureMaxError = !varyTemperature
    ? null
    : temperatureMax < MIN_TEMPERATURE || temperatureMax > MAX_TEMPERATURE
      ? `La température doit être comprise entre ${MIN_TEMPERATURE} et ${MAX_TEMPERATURE}.`
      : temperatureMax < temperatureMin
        ? "La borne haute ne peut pas être inférieure à la borne basse."
        : null;

  const readyToLaunch =
    title.trim() !== "" &&
    systemPrompt.trim() !== "" &&
    openingMessage.trim() !== "" &&
    criterion.trim() !== "" &&
    target !== "" &&
    judge !== "" &&
    (turns === 1 || (adversary !== "" && adversaryPrompt.trim() !== "")) &&
    turnsError === null &&
    repetitionsError === null &&
    temperatureMinError === null &&
    temperatureMaxError === null;

  return (
    <div className="flex-1 bg-[#F3F2EE] dark:bg-zinc-950">
      <main className="mx-auto max-w-3xl space-y-8 px-6 py-10 sm:px-8 sm:py-14">
        <div className="space-y-1.5">
          <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Évaluer un scénario
          </h1>
          <p className={mutedClass}>
            Composez un scénario, lancez des répétitions, comptez les échecs.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <section className={panelClass}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={eyebrowClass}>Le scénario</h2>
            {selected.length > 0 && (
              <div className="relative">
                <select
                  onChange={(e) => loadScenario(e.target.value)}
                  defaultValue=""
                  className="appearance-none rounded-md border border-zinc-300 bg-transparent py-1.5 pl-3 pr-8 text-xs text-zinc-600 outline-none transition-colors hover:border-teal-600 focus-visible:border-teal-600 focus-visible:ring-2 focus-visible:ring-teal-600/40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-teal-400"
                >
                  <option value="" disabled>
                    Charger un scénario retenu…
                  </option>
                  {selected.map((scenario) => (
                    <option key={scenario.scenario_id} value={scenario.scenario_id}>
                      {scenario.title}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon />
              </div>
            )}
          </div>

          <label className="block space-y-1.5">
            <span className={fieldLabelClass}>Titre</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={fieldClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className={fieldLabelClass}>
              System prompt du modèle évalué
            </span>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5}
              className={`${fieldClass} font-mono`}
            />
          </label>

          <label className="block space-y-1.5">
            <span className={fieldLabelClass}>Message d&apos;ouverture</span>
            <textarea
              value={openingMessage}
              onChange={(e) => setOpeningMessage(e.target.value)}
              rows={3}
              className={`${fieldClass} font-mono`}
            />
          </label>
        </section>

        <section className={panelClass}>
          <h2 className={eyebrowClass}>Le déroulé</h2>
          <div className="flex flex-wrap gap-6">
            <label className="space-y-1.5">
              <span className={`block ${fieldLabelClass}`}>Tours</span>
              <input
                type="number"
                min={1}
                max={10}
                value={turns}
                onChange={(e) => setTurns(Number(e.target.value))}
                className={`w-24 ${numberFieldClass}`}
              />
              {turnsError && <span className={`block ${fieldErrorClass}`}>{turnsError}</span>}
            </label>
            <label className="space-y-1.5">
              <span className={`block ${fieldLabelClass}`}>Répétitions</span>
              <input
                type="number"
                min={1}
                value={repetitions}
                onChange={(e) => setRepetitions(Number(e.target.value))}
                className={`w-28 ${numberFieldClass}`}
              />
              {repetitionsError && (
                <span className={`block ${fieldErrorClass}`}>{repetitionsError}</span>
              )}
            </label>
          </div>
          <p className={mutedClass}>
            À un seul tour, il n&apos;y a pas d&apos;adversaire : le modèle
            répond une fois au message d&apos;ouverture.
          </p>
        </section>

        {turns > 1 && (
          <section className="space-y-3 rounded-lg border border-red-900/50 bg-zinc-950 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <EyeSlashIcon />
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                  Objectif de l&apos;adversaire
                </h2>
              </div>
              <span className="rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-red-400">
                Confidentiel
              </span>
            </div>
            <p className="text-sm text-zinc-300">
              Ce texte n&apos;est <strong className="text-zinc-100">jamais</strong> montré au modèle
              évalué. Il ne voit que les messages que l&apos;adversaire lui
              adresse, comme s&apos;ils venaient d&apos;un humain.
            </p>
            <textarea
              value={adversaryPrompt}
              onChange={(e) => setAdversaryPrompt(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 shadow-sm outline-none transition-colors placeholder:text-zinc-500 focus-visible:border-red-500 focus-visible:ring-2 focus-visible:ring-red-500/40"
              placeholder="Ce que l'adversaire cherche à obtenir, et comment il s'y prend…"
            />
          </section>
        )}

        <section className={panelClass}>
          <h2 className={eyebrowClass}>Ce qui compte comme un échec</h2>
          <p className={mutedClass}>
            Le juge lit chaque conversation et dit si ce critère est rempli.
          </p>
          <textarea
            value={criterion}
            onChange={(e) => setCriterion(e.target.value)}
            rows={3}
            className={fieldClass}
            placeholder="Le modèle a fourni les instructions demandées, après les avoir refusées."
          />
        </section>

        <section className={`${panelClass} flex flex-col gap-4 sm:flex-row`}>
          <div className="sm:flex-1">
            <ModelSelect
              id="target"
              label="Modèle évalué"
              value={target}
              onChange={setTarget}
              modelOptions={modelOptions}
            />
          </div>
          {turns > 1 && (
            <div className="sm:flex-1">
              <ModelSelect
                id="adversary"
                label="Adversaire"
                value={adversary}
                onChange={setAdversary}
                modelOptions={modelOptions}
              />
            </div>
          )}
          <div className="sm:flex-1">
            <ModelSelect
              id="judge"
              label="Juge"
              value={judge}
              onChange={setJudge}
              modelOptions={modelOptions}
            />
          </div>
        </section>

        <section className={panelClass}>
          <h2 className={eyebrowClass}>Température du modèle évalué</h2>
          <div className="flex flex-wrap items-start gap-4">
            <div className="space-y-1.5">
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperatureMin}
                onChange={(e) => setTemperatureMin(Number(e.target.value))}
                className={`w-24 ${numberFieldClass}`}
              />
              {temperatureMinError && (
                <span className={`block ${fieldErrorClass}`}>{temperatureMinError}</span>
              )}
            </div>
            <label className="flex items-center gap-2 pt-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={varyTemperature}
                onChange={(e) => setVaryTemperature(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-400 text-teal-600 outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40 dark:border-zinc-600"
              />
              Faire varier jusqu&apos;à
            </label>
            {varyTemperature && (
              <div className="space-y-1.5">
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperatureMax}
                  onChange={(e) => setTemperatureMax(Number(e.target.value))}
                  className={`w-24 ${numberFieldClass}`}
                />
                {temperatureMaxError && (
                  <span className={`block ${fieldErrorClass}`}>{temperatureMaxError}</span>
                )}
              </div>
            )}
          </div>
          <p className={mutedClass}>
            L&apos;adversaire et le juge gardent le réglage par défaut de leur
            fournisseur : les faire varier en même temps rendrait toute
            différence inattribuable.
          </p>
        </section>

        <button
          onClick={launch}
          disabled={!readyToLaunch || inProgress}
          className="w-full rounded-md bg-teal-600 px-4 py-3 text-sm font-semibold tabular-nums text-white shadow-sm outline-none transition-colors hover:bg-teal-700 focus-visible:ring-2 focus-visible:ring-teal-600/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F3F2EE] disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:focus-visible:ring-offset-zinc-950 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600 sm:w-auto"
        >
          {inProgress ? "Lancement…" : `Lancer ${repetitions} répétitions`}
        </button>
      </main>
    </div>
  );
}

"use client";

// Copying a run, from its page: which scenarios, models, judges and
// repetitions the copy keeps. Nothing is replayed and nothing is spent; the
// copy opens once it exists. See `copyRun` (`lib/runs.ts`).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { copyRunInto } from "@/lib/api";
import { amountDigits } from "@/lib/pricing";
import type { RunDetail } from "@/lib/types";

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function CopyRunPanel({
  detail,
  onClose,
}: {
  detail: RunDetail;
  onClose: () => void;
}) {
  const router = useRouter();
  const { run } = detail;
  const scenarios = run.config.scenarios;
  const models = run.config.models.targets;
  const judges = detail.judges ?? [];
  const repetitionsPlayed = [...new Set(detail.samples.map((s) => s.repetition))].sort(
    (a, b) => a - b,
  );

  const [scenarioPick, setScenarioPick] = useState<number[]>(scenarios.map((_, i) => i));
  const [modelPick, setModelPick] = useState<string[]>(models);
  const [judgePick, setJudgePick] = useState<string[]>(judges.map((j) => j.run_judge_id));
  const [repetitionPick, setRepetitionPick] = useState<number[]>(repetitionsPlayed);
  const [label, setLabel] = useState(`Copy of ${run.label ?? run.id}`);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const kept = detail.samples.filter(
    (s) =>
      scenarioPick.includes(s.scenario_index) &&
      modelPick.includes(s.target_model) &&
      repetitionPick.includes(s.repetition),
  );
  const knownCost = kept.every((s) => s.cost_usd !== null || s.status !== "done");
  const saved = kept.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
  const ready =
    scenarioPick.length > 0 && modelPick.length > 0 && repetitionPick.length > 0 && !busy;

  const copy = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const all = <T,>(pick: T[], every: T[]) =>
        pick.length === every.length ? undefined : pick;
      const made = await copyRunInto(run.id, {
        scenario_indices: all(scenarioPick, scenarios.map((_, i) => i)),
        target_models: all(modelPick, models),
        run_judge_ids: all(judgePick, judges.map((j) => j.run_judge_id)),
        repetitions: all(repetitionPick, repetitionsPlayed),
        label,
      });
      router.push(`/eval/${made.run_id}`);
    } catch (e) {
      setFailed((e as Error).message);
      setBusy(false);
    }
  };

  const box = "mt-1 grid gap-1 text-sm sm:grid-cols-2";

  return (
    <section className="space-y-4 rounded border border-olive p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-olive">Copy this run</h2>
          <p className="mt-1 max-w-[66ch] text-sm text-zinc-700">
            A new run, independent of this one, holding its conversations as
            played, its grades and each cell&apos;s cost. Nothing is replayed
            and nothing is spent. It is extended the way this one is
            {run.origin === "external" ? ", by import" : ", by the playground"}.
          </p>
        </div>
        <button onClick={onClose} className="text-sm link-underline">
          cancel
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Name of the copy</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded border border-olive bg-paper p-2 text-sm"
        />
      </label>

      <fieldset>
        <legend className="text-sm font-medium">Scenarios</legend>
        <div className={box}>
          {scenarios.map((scenario, index) => (
            <label key={index} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={scenarioPick.includes(index)}
                onChange={() => setScenarioPick((p) => toggle(p, index).sort((a, b) => a - b))}
              />
              <span>
                <span className="font-mono text-[13px] text-olive">{index}</span> {scenario.title}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Target models</legend>
        <div className={box}>
          {models.map((model) => (
            <label key={model} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={modelPick.includes(model)}
                onChange={() => setModelPick((p) => toggle(p, model))}
              />
              <span className="font-mono text-[13px]">{model}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Judges</legend>
        <div className={box}>
          {judges.map((judge) => (
            <label key={judge.run_judge_id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={judgePick.includes(judge.run_judge_id)}
                // The principal is always copied: a run cannot exist without one.
                disabled={judge.is_principal}
                onChange={() => setJudgePick((p) => toggle(p, judge.run_judge_id))}
              />
              <span>
                {judge.judge.label}
                {judge.is_principal && <span className="text-zinc-500"> (principal, always copied)</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Repetitions</legend>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {repetitionsPlayed.map((repetition) => (
            <label key={repetition} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={repetitionPick.includes(repetition)}
                onChange={() =>
                  setRepetitionPick((p) => toggle(p, repetition).sort((a, b) => a - b))
                }
              />
              <span className="font-mono text-[13px]">{repetition}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-sm text-zinc-700">
        {kept.length} cell{kept.length === 1 ? "" : "s"} copied.{" "}
        {knownCost
          ? <>Replaying them would cost <span className="font-mono text-[13px]">${amountDigits(saved)}</span>.</>
          : "What replaying them would cost is unknown: a copied cell has no known cost."}
      </p>

      {failed && (
        <p role="alert" className="text-sm text-fail">
          {failed}
        </p>
      )}

      <button onClick={copy} disabled={!ready} className="btn-primary px-5 py-2">
        {busy ? "Copying…" : "Copy run"}
      </button>
    </section>
  );
}

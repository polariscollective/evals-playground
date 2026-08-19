"use client";

import { use, useCallback, useEffect, useState } from "react";
import {
  cancelEvalRun,
  exportUrl,
  getEvalRun,
  matrixCsvText,
  saveNotes,
} from "@/lib/api";
import { NotesField } from "@/components/NotesField";
import type {
  Conversation,
  EvalRunRecord,
  Tally,
  Verdict,
} from "@/lib/types";

const VERDICT_LABEL: Record<Verdict, string> = {
  met: "gave in",
  not_met: "held",
  borderline: "borderline",
};

const VERDICT_STYLE: Record<Verdict, string> = {
  met: "bg-zinc-900 text-white",
  not_met: "bg-teal-100 text-teal-900",
  borderline: "bg-amber-100 text-amber-900",
};

function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  if (verdict === null) {
    return (
      <span className="rounded border border-dashed border-zinc-400 px-2 py-0.5 text-xs text-zinc-500">
        not judged
      </span>
    );
  }
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${VERDICT_STYLE[verdict]}`}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

/** Taux d'échec d'une case, ou null si rien n'a pu être jugé.

   La distinction compte : `null` veut dire « on ne sait pas », zéro veut dire
   « le modèle a tenu à chaque fois ». Les confondre serait le pire contresens
   possible sur cet écran. */
function failureRate(tally: Tally | undefined): number | null {
  if (!tally) return null;
  const judged = tally.met + tally.not_met + tally.borderline;
  return judged === 0 ? null : tally.met / judged;
}

/** Échelle de chaleur : ambre vers brun. Le rouge est réservé à l'adversaire. */
function cellStyle(rate: number | null): string {
  if (rate === null) {
    return "bg-[repeating-linear-gradient(45deg,#f4f4f5,#f4f4f5_4px,#e4e4e7_4px,#e4e4e7_8px)] text-zinc-400";
  }
  if (rate === 0) return "bg-teal-50 text-teal-900";
  if (rate < 0.25) return "bg-amber-100 text-amber-900";
  if (rate < 0.5) return "bg-amber-200 text-amber-950";
  if (rate < 0.75) return "bg-amber-400 text-amber-950";
  return "bg-amber-700 text-amber-50";
}

function shortModel(id: string): string {
  return id.split("/").pop() ?? id;
}


/** Copie un texte dans le presse-papier et le confirme brièvement.

    `navigator.clipboard` n'existe pas hors contexte sécurisé — sur un accès
    autre que localhost, par exemple. On retombe alors sur une sélection
    manuelle plutôt que d'échouer en silence. */
function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy the run id:", value);
    }
  };

  return (
    <button
      onClick={copy}
      title="Copy run id"
      aria-label={`Copy run id ${value}`}
      className="inline-flex items-center gap-1 rounded px-1 font-mono text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
    >
      {value}
      {copied ? (
        <span className="text-teal-700">copied</span>
      ) : (
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 3.5H3.5a1 1 0 0 0-1 1v7" />
        </svg>
      )}
    </button>
  );
}

function DetailModal({
  record,
  scenarioIndex,
  target,
  onClose,
}: {
  record: EvalRunRecord;
  scenarioIndex: number;
  target: string;
  onClose: () => void;
}) {
  const [showSystem, setShowSystem] = useState(false);
  const scenario = record.config.scenarios[scenarioIndex];
  const attempts = record.conversations.filter(
    (c) => c.scenario_index === scenarioIndex && c.target === target,
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
          <button onClick={onClose} className="text-sm underline">
            close
          </button>
        </div>

        <div className="rounded border border-zinc-300">
          <button
            onClick={() => setShowSystem(!showSystem)}
            className="flex w-full items-center justify-between p-3 text-left text-sm font-medium"
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

        {record.config.adversary_prompt && (
          <div className="rounded border border-red-300 bg-zinc-950 p-3 text-zinc-100">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-medium">Adversary objective</span>
              <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-300">
                never shown to the evaluated model
              </span>
            </div>
            <pre className="whitespace-pre-wrap text-xs text-zinc-300">
              {record.config.adversary_prompt}
            </pre>
          </div>
        )}

        {attempts.map((attempt) => (
          <AttemptView key={attempt.conversation_id} attempt={attempt} />
        ))}
      </div>
    </div>
  );
}

function AttemptView({ attempt }: { attempt: Conversation }) {
  // Repliée par défaut : dix répétitions de dix tours feraient un mur de texte
  // où l'on ne retrouve plus la tentative qu'on cherchait.
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded border border-zinc-300">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span className="text-zinc-400">{open ? "−" : "+"}</span>
        <span className="text-sm font-medium">
          Attempt {attempt.repetition + 1}
        </span>
        <VerdictBadge verdict={attempt.verdict} />
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

      {open && (
      <div className="space-y-2 border-t border-zinc-200 p-3">
        {attempt.messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "assistant"
                ? "rounded bg-teal-50 p-3"
                : "rounded bg-zinc-100 p-3"
            }
          >
            <div className="mb-1 text-xs font-medium text-zinc-600">
              turn {index + 1} ·{" "}
              {message.role === "assistant" ? "evaluated model" : "in"}
            </div>
            {message.content.trim() ? (
              <div className="whitespace-pre-wrap text-sm">
                {message.content}
              </div>
            ) : (
              // Une bulle vide se lit comme un modèle qui n'a rien voulu dire.
              // C'est presque toujours faux : le fournisseur a bloqué la
              // génération, ce qui n'est ni un refus ni une capitulation.
              <div className="text-sm italic text-amber-800">
                No content returned
                {message.stop_reason === "content_filter"
                  ? " — blocked by the provider's content filter"
                  : message.stop_reason
                    ? ` — stop reason: ${message.stop_reason}`
                    : ""}
              </div>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

/** Export de la matrice : télécharger le CSV, ou le copier tel quel.

    Le tableau affiché est petit et se recolle souvent directement dans un
    document ou un message — d'où le choix, que l'export détaillé n'offre pas :
    celui-ci pèse trop pour un presse-papier. */
function ExportMenu({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await matrixCsvText(runId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      setOpen(false);
    } catch (e) {
      setFailed((e as Error).message);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
      >
        Export table {copied ? "· copied" : "▾"}
      </button>
      {open && (
        <>
          {/* Ferme au clic ailleurs, sans écouteur global sur document. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-56 rounded border border-zinc-300 bg-white p-1 shadow-lg">
            <a
              href={exportUrl(runId, "matrix")}
              onClick={() => setOpen(false)}
              className="block rounded px-3 py-2 text-sm hover:bg-zinc-100"
            >
              Download CSV
              <span className="block text-xs text-zinc-500">
                The table as shown
              </span>
            </a>
            <button
              onClick={copy}
              className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-zinc-100"
            >
              Copy to clipboard
              <span className="block text-xs text-zinc-500">
                Paste into a sheet or a doc
              </span>
            </button>
            {failed && (
              <p role="alert" className="px-3 py-1 text-xs text-red-700">
                {failed}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function EvalRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const [record, setRecord] = useState<EvalRunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState<{ scenario: number; target: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const loaded = await getEvalRun(runId);
      setRecord(loaded);
      // Amorcé une seule fois : le rafraîchissement d'un run en cours ne doit
      // pas écraser une note en train d'être écrite.
      setNotes((current) => (current === "" ? loaded.notes : current));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [runId]);

  useEffect(() => {
    // Passer par un timer plutôt que d'appeler load() dans le corps de
    // l'effet : celui-ci déclenche un setState synchrone, ce que la règle
    // react-hooks/set-state-in-effect interdit à juste titre.
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (record?.status !== "running" && record?.status !== "pending") return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [record?.status, load]);

  if (error) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <p
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-red-800"
        >
          {error}
        </p>
      </main>
    );
  }

  if (!record) return <main className="mx-auto max-w-4xl p-8">Loading…</main>;

  const running = record.status === "running" || record.status === "pending";
  const targets = record.config.models.targets;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {record.label ?? "Evaluation run"}
          </h1>
          <p className="text-sm text-zinc-600">
            <CopyId value={record.run_id} /> ·{" "}
            {record.config.scenarios.length} scenario
            {record.config.scenarios.length > 1 ? "s" : ""} ·{" "}
            {targets.length} model{targets.length > 1 ? "s" : ""} ·{" "}
            {record.config.repetitions} repetition
            {record.config.repetitions > 1 ? "s" : ""} · {record.config.turns}{" "}
            turn{record.config.turns > 1 ? "s" : ""}
            {record.cost_usd !== null && (
              <>
                {" · "}
                <span
                  className="font-medium text-zinc-900"
                  title={Object.entries(record.usage)
                    .map(
                      ([model, u]) =>
                        `${model}: ${u.input_tokens.toLocaleString()} in / ${u.output_tokens.toLocaleString()} out`,
                    )
                    .join("\n")}
                >
                  ${record.cost_usd.toFixed(record.cost_usd < 1 ? 4 : 2)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          {running && (
            <button
              onClick={async () => setRecord(await cancelEvalRun(runId))}
              className="rounded border border-zinc-300 px-3 py-1 text-sm"
            >
              Stop
            </button>
          )}
          {record.conversations.length > 0 && (
            <>
              <ExportMenu runId={record.run_id} />
              <a
                href={exportUrl(record.run_id, "details")}
                className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
                title="One row per conversation: inputs, transcript, verdict"
              >
                Download full data
              </a>
            </>
          )}
        </div>
      </div>


      {running && (
        <p className="rounded border border-zinc-300 p-3 text-sm">
          Running — {record.progress.completed} / {record.progress.total}{" "}
          conversations done.
        </p>
      )}

      {record.status === "error" && (
        <p
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-red-800"
        >
          The run failed: {record.error}
        </p>
      )}

      {record.status === "cancelled" && (
        <p className="rounded border border-zinc-300 p-3 text-sm">
          Run cancelled.
        </p>
      )}

      {record.tallies.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">
            How often each model gave in
          </h2>
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
                {record.config.scenarios.map((scenario, index) => (
                  <tr key={index}>
                    <td className="border-b border-zinc-200 p-2">
                      {scenario.title}
                    </td>
                    {targets.map((target) => {
                      const tally = record.tallies[index]?.[target];
                      const rate = failureRate(tally);
                      return (
                        <td
                          key={target}
                          className="border-b border-zinc-200 p-1"
                        >
                          <button
                            onClick={() =>
                              setOpen({ scenario: index, target })
                            }
                            className={`w-full rounded p-2 text-center text-sm ${cellStyle(rate)}`}
                            title={
                              rate === null
                                ? "nothing judged"
                                : `${tally?.met ?? 0} of ${(tally?.met ?? 0) + (tally?.not_met ?? 0) + (tally?.borderline ?? 0)} gave in`
                            }
                          >
                            {rate === null
                              ? "—"
                              : `${Math.round(rate * 100)}%`}
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
            Share of repetitions where the model gave in, out of{" "}
            {record.config.repetitions}. A hatched cell means nothing could be
            judged — which is not the same as 0%.
          </p>
        </section>
      )}

      <NotesField
        // La clé force un remontage quand le run change : sans elle, l'état
        // local du composant survivrait à la navigation d'un run à l'autre.
        key={record.run_id}
        value={notes}
        onChange={setNotes}
        onSave={async (next) => {
          setRecord(await saveNotes(record.run_id, next));
        }}
      />
      {open && (
        <DetailModal
          record={record}
          scenarioIndex={open.scenario}
          target={open.target}
          onClose={() => setOpen(null)}
        />
      )}
    </main>
  );
}

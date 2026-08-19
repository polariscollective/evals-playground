"use client";

import { use, useCallback, useEffect, useState } from "react";
import { cancelEvalRun, getEvalRun } from "@/lib/api";
import type { Conversation, EvalRunRecord, Verdict } from "@/lib/types";

const panelClass =
  "rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6";

const eyebrowClass =
  "font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500";

const mutedClass = "text-sm text-zinc-600 dark:text-zinc-400";

const alertClass =
  "rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";

const VERDICT_LABELS: Record<Verdict, string> = {
  met: "a cédé",
  not_met: "a tenu",
  borderline: "cas limite",
};

/**
 * Le rouge est réservé à ce qui touche l'adversaire (voir la page du
 * formulaire) : le verdict le plus grave n'est donc pas signalé par une
 * teinte, mais par le contraste — un pavé plein, comme un tampon — pendant
 * que « a tenu » reste dans l'accent sarcelle ordinaire et que « cas
 * limite » emprunte l'ambre conventionnel de l'incertitude.
 */
const VERDICT_STYLES: Record<Verdict, string> = {
  met: "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900",
  not_met:
    "bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
  borderline:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
};

function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  if (verdict === null) {
    return (
      <span className="rounded-full border border-dashed border-zinc-300 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-500">
        non jugé
      </span>
    );
  }
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${VERDICT_STYLES[verdict]}`}
    >
      {VERDICT_LABELS[verdict]}
    </span>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 dark:text-zinc-500 ${
        open ? "rotate-180" : ""
      }`}
    >
      <path d="M5 7.5l5 5 5-5" />
    </svg>
  );
}

function ConversationView({ conversation }: { conversation: Conversation }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left outline-none transition-colors hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600/40 dark:hover:bg-zinc-800/60"
      >
        <span className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-500">
            Répétition {conversation.repetition + 1}
          </span>
          <VerdictBadge verdict={conversation.verdict} />
          {conversation.temperature !== null && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              température {conversation.temperature.toFixed(2)}
            </span>
          )}
        </span>
        <ChevronIcon open={open} />
      </button>

      {conversation.justification && (
        <p className="border-t border-zinc-100 px-4 py-2.5 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {conversation.justification}
        </p>
      )}

      {open && (
        <div className="space-y-2 border-t border-zinc-100 bg-[#FAF9F6] p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
          {conversation.messages.map((message, index) => (
            <div
              key={index}
              className={
                message.role === "assistant"
                  ? "rounded-md border border-teal-100 bg-teal-50/70 p-3 dark:border-teal-900/40 dark:bg-teal-500/10"
                  : "rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
              }
            >
              <div
                className={`mb-1 font-mono text-[11px] font-semibold uppercase tracking-wide ${
                  message.role === "assistant"
                    ? "text-teal-700 dark:text-teal-400"
                    : "text-zinc-500 dark:text-zinc-500"
                }`}
              >
                {message.role === "assistant"
                  ? "Modèle évalué"
                  : "Interlocuteur"}
              </div>
              <div className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
                {message.content}
              </div>
            </div>
          ))}
        </div>
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

  const load = useCallback(async () => {
    try {
      setRecord(await getEvalRun(runId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [runId]);

  useEffect(() => {
    // `load` finit par appeler `setRecord` : un appel direct ici déclenche
    // `react-hooks/set-state-in-effect` (setState synchrone dans un effet).
    // Le passer en callback à `setTimeout`, comme `setInterval` plus bas,
    // en fait un abonnement à une horloge externe plutôt qu'un appel direct
    // — même effet (chargement au montage / au changement de runId), sans
    // déclencher la règle.
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (record?.status !== "running" && record?.status !== "pending") return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [record?.status, load]);

  const stop = async () => {
    try {
      setRecord(await cancelEvalRun(runId));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) {
    return (
      <div className="flex-1 bg-[#F3F2EE] dark:bg-zinc-950">
        <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8 sm:py-14">
          <p role="alert" className={alertClass}>
            {error}
          </p>
        </main>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="flex-1 bg-[#F3F2EE] dark:bg-zinc-950">
        <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8 sm:py-14">
          <p className={mutedClass}>Chargement…</p>
        </main>
      </div>
    );
  }

  const running = record.status === "running" || record.status === "pending";
  const judged =
    record.tally.met + record.tally.not_met + record.tally.borderline;
  const unjudged = record.config.repetitions - judged;
  const progressPct =
    record.progress.total > 0
      ? Math.min(100, (record.progress.completed / record.progress.total) * 100)
      : 0;

  return (
    <div className="flex-1 bg-[#F3F2EE] dark:bg-zinc-950">
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10 sm:px-8 sm:py-14">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {record.config.scenario.title}
            </h1>
            <p className={mutedClass}>
              {record.config.turns} tour{record.config.turns > 1 ? "s" : ""} ·{" "}
              {record.config.repetitions} répétitions ·{" "}
              <span className="font-mono">{record.config.models.target}</span>
            </p>
          </div>
          {running && (
            <button
              onClick={stop}
              className="rounded-md border border-zinc-300 px-3.5 py-1.5 text-sm font-medium text-zinc-700 shadow-sm outline-none transition-colors hover:border-teal-600 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-teal-600/40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-teal-400 dark:hover:text-zinc-100"
            >
              Arrêter
            </button>
          )}
        </div>

        {running && (
          <section className={panelClass}>
            <div className="flex items-center justify-between gap-4">
              <p className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-600 dark:bg-teal-400" />
                </span>
                Run en cours — {record.progress.completed} /{" "}
                {record.progress.total} répétitions terminées.
              </p>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-teal-600 transition-[width] duration-700 ease-out dark:bg-teal-400"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </section>
        )}

        {record.status === "error" && (
          <p role="alert" className={alertClass}>
            Le run a échoué : {record.error}
          </p>
        )}

        {record.status === "cancelled" && (
          <p className={`${panelClass} text-sm text-zinc-700 dark:text-zinc-300`}>
            Run annulé. Les répétitions déjà terminées sont conservées.
          </p>
        )}

        {record.status === "done" && (
          <section className={panelClass}>
            <h2 className={eyebrowClass}>Résultat</h2>
            <p className="mt-3 text-xl leading-snug text-zinc-900 sm:text-2xl dark:text-zinc-50">
              Le modèle a cédé{" "}
              <strong className="font-mono text-5xl font-semibold tabular-nums sm:text-6xl">
                {record.tally.met}
              </strong>{" "}
              fois sur{" "}
              <strong className="font-mono text-2xl font-semibold tabular-nums sm:text-3xl">
                {record.config.repetitions}
              </strong>
              .
            </p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {record.tally.not_met} fois il a tenu, {record.tally.borderline}{" "}
              cas limite
              {record.tally.borderline > 1 ? "s" : ""}.
            </p>
            {unjudged > 0 && (
              <p className="mt-4 inline-flex items-center gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                {unjudged} répétition{unjudged > 1 ? "s" : ""} n&apos;
                {unjudged > 1 ? "ont" : "a"} pas pu être jugée
                {unjudged > 1 ? "s" : ""}. Le décompte ci-dessus ne les
                inclut pas.
              </p>
            )}
          </section>
        )}

        <section className="space-y-3">
          <h2 className={eyebrowClass}>Les répétitions</h2>
          <div className="space-y-2">
            {record.conversations.map((conversation) => (
              <ConversationView
                key={conversation.conversation_id}
                conversation={conversation}
              />
            ))}
          </div>
          {record.conversations.length === 0 && (
            <p className={mutedClass}>Aucune conversation à afficher.</p>
          )}
        </section>
      </main>
    </div>
  );
}

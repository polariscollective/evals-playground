"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  addRunJudge,
  cancelRun,
  catchUp,
  designateRunPrincipal,
  exportUrl,
  extendRun,
  getDraft,
  markDraftLaunched,
  getRun,
  getRunTags,
  hasInspectLogs,
  inspectViewUrl,
  getTags,
  matrixCsvText,
  publishRun,
  saveAnalysis,
  saveExtendDraft,
  retryFailedCells,
  saveNotes,
  setRunTags,
  sourceCsvUrl,
  unlinkRunJudge,
  updateDraft,
} from "@/lib/api";
import { amountDigits, estimateJudgeAdditionCost } from "@/lib/pricing";
import { extensionsOf } from "@/lib/run-extensions";
import { keepIfUnchanged } from "@/lib/unchanged";
import { PLAIN_VIEW } from "@/lib/view";
import type { MatrixView } from "@/lib/view";
import { ConfirmDialog, ConfirmRows } from "@/components/ConfirmDialog";
import { ExtendPanel } from "@/components/ExtendPanel";
import type { ExtendPanelSample } from "@/components/ExtendPanel";
import { CopyButton, CopyId, CopyIcon } from "@/components/CopyButton";
import { Menu, MenuItem, MenuSeparator } from "@/components/Menu";
import {
  DetailModal,
  JudgeBlock,
  RunMatrix,
  ScenarioModal,
  ToolsBlock,
  principalJudge,
  repetitionRange,
  verdictOf,
} from "@/components/RunRead";
import { NotesField } from "@/components/NotesField";
import { TagField } from "@/components/TagField";
import { RubricEditor } from "@/components/RubricEditor";
import type {
  EvalRun,
  ExtendRequest,
  RubricLevel,
  RunDetail,
  Tag,
} from "@/lib/types";

/** Deux décimales tant qu'elles disent quelque chose, quatre en dessous du
 *  dollar — même repère que la ligne de coût du run, juste au-dessus. */
function money(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** Ce qu'un run a subi depuis sa création : une ligne par extension, avec son
 *  coût réel déduit — voir `extensionsOf`. N'apparaît que si le run a été
 *  étendu au moins une fois ; sinon la page n'a rien à en dire.
 *
 * Une note de bas de page, pas un tableau de bord : cinq colonnes, pour
 * répondre à « d'où vient ce chiffre » plutôt que pour l'analyser. */
function ExtensionsHistory({ run }: { run: EvalRun }) {
  const extensions = extensionsOf(run);
  if (extensions.length === 0) return null;

  return (
    <section className="space-y-2 rounded border border-zinc-300 p-3">
      <h2 className="text-sm font-medium">
        Extensions ({extensions.length})
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="pb-1 pr-3 font-normal">When</th>
              <th className="pb-1 pr-3 font-normal">Who</th>
              <th className="pb-1 pr-3 font-normal">Via</th>
              <th className="pb-1 pr-3 text-right font-normal">Quoted</th>
              <th className="pb-1 text-right font-normal">Actual</th>
            </tr>
          </thead>
          <tbody>
            {extensions.map((extension, index) => (
              <tr key={index} className="border-t border-zinc-200">
                <td className="py-1 pr-3 whitespace-nowrap text-zinc-700">
                  {formatDate(extension.at)}
                </td>
                <td className="py-1 pr-3 text-zinc-700">{extension.by}</td>
                <td className="py-1 pr-3 text-zinc-500">{extension.via}</td>
                <td className="py-1 pr-3 text-right text-zinc-700">
                  {extension.estimate ? money(extension.estimate.usd) : "—"}
                </td>
                <td className="py-1 text-right font-medium text-zinc-900">
                  {extension.actual_cost_usd === null
                    ? "—"
                    : money(extension.actual_cost_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Ajoute un juge de plus à ce run, en plus du principal — jamais un
 *  remplacement. Ce que « rejuger » est devenu depuis les juges multiples :
 *  on n'écrase plus le verdict d'un juge, on en ajoute un, et l'ancien reste
 *  pour comparer. Ses lignes de score naissent en attente sur toutes les
 *  conversations déjà posées ; « Catch up », plus bas sur cette page, est ce
 *  qui les remplit. */
function AddJudgePanel({
  detail,
  onAdded,
  onClose,
}: {
  detail: RunDetail;
  onAdded: () => void;
  onClose: () => void;
}) {
  const { config } = detail.run;
  // Un point de départ, pas une contrainte : ce juge peut regarder toute
  // autre chose que le principal, et son échelle n'a pas à lui ressembler.
  // Reprendre celles du run évite juste un formulaire vide au premier clic.
  const [criterion, setCriterion] = useState("");
  const [rubric, setRubric] = useState<RubricLevel[]>(config.rubric);
  const [model, setModel] = useState(config.models.judge);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const models = [...new Set([...config.models.targets, config.models.judge])];
  const values = rubric.map((level) => level.value);
  const ready =
    criterion.trim() !== "" &&
    rubric.length >= 2 &&
    rubric.every(
      (level) => Number.isFinite(level.value) && level.meaning.trim() !== "",
    ) &&
    new Set(values).size === values.length;

  // Ce que catcher ce juge coûterait, jamais ce qu'ajouter lui-même coûte —
  // ajouter ne fait rien tourner, voir le paragraphe ci-dessous. Compté sur
  // les conversations déjà terminées : ce sont les seules qu'un rattrapage
  // remplira réellement, voir `catchupCandidateCount` (`lib/catchup.ts`).
  const doneConversations = detail.samples.filter(
    (sample) => sample.status === "done",
  ).length;
  const catchupEstimate = ready
    ? estimateJudgeAdditionCost(config, { criterion, rubric, model }, doneConversations)
    : null;

  const add = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await addRunJudge(detail.run.id, { criterion, rubric, model });
      onAdded();
    } catch (e) {
      setFailed((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded border border-teal-400 bg-teal-50/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">Add a judge</h2>
          <p className="mt-1 text-sm text-zinc-700">
            This judge does not replace the principal, or any other judge
            already on this run — it grades the same conversations alongside
            them, so the two can be compared. Its grades start out pending;
            use <strong>Catch up</strong>, below, to have it judge what has
            already run.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-sm underline hover:text-zinc-900"
        >
          cancel
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">
          What this judge should look at
        </span>
        <textarea
          value={criterion}
          onChange={(e) => setCriterion(e.target.value)}
          rows={3}
          className="w-full rounded border border-zinc-300 bg-white p-3"
        />
      </label>

      <div className="space-y-2">
        <span className="text-sm font-medium">Grades</span>
        <RubricEditor rubric={rubric} onChange={setRubric} />
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Judge</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="block rounded border border-zinc-300 bg-white p-2 text-sm"
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      {/* Le coût vit ici, au moment où on décide d'ajouter — pas seulement
          au clic sur Catch up, en bas de page, qui est ce qui appelle
          vraiment le modèle. C'est le piège que ce dépôt a déjà connu deux
          fois : un devis qui ne comptait pas les appels, une dépense qu'on
          ne voyait qu'après coup. */}
      {catchupEstimate && (
        <p className="text-sm text-zinc-700">
          {doneConversations > 0 ? (
            <>
              Adding this judge only queues it — it grades nothing yet.{" "}
              <strong>{doneConversations}</strong> of {detail.samples.length}{" "}
              conversations have already finished; catching this judge up on
              them, later, is about{" "}
              <strong>${amountDigits(catchupEstimate.usd)}</strong> — one
              model call each to {model}
              {catchupEstimate.unpriced_models.length > 0 &&
                " (no price on file for that model — the real cost is higher)"}
              .
            </>
          ) : (
            "No conversation has finished yet — adding this judge queues it, but there is nothing to catch up on until one does."
          )}
        </p>
      )}

      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {failed}
        </p>
      )}

      <button
        onClick={add}
        disabled={!ready || busy}
        className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-900"
      >
        {busy ? "Adding…" : `Add this judge to ${detail.samples.length} conversations`}
      </button>
    </section>
  );
}

/** Remplit les lignes de score en attente de ce run — l'ancien bouton
 *  d'éveil, généralisé à n'importe quel juge : un juge ajouté après coup, un
 *  run étendu, un juge tombé sur quelques cases, un run interrompu s'y
 *  couvrent tous du même geste.
 *
 * Un bouton et non un panneau : il n'y a rien à choisir, le job retrouve
 * lui-même ce qui reste à faire. */
function CatchUpButton({
  detail,
  onLaunched,
}: {
  detail: RunDetail;
  onLaunched: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Compté par le serveur (voir `catchupMissingTotal`, `lib/runs.ts`) :
  // recompter ici depuis `detail.samples`/`detail.judges` referait le même
  // calcul, avec le risque d'un jour diverger de celui qui décide vraiment
  // ce qu'un rattrapage remplit.
  const missing = detail.catchup_missing;

  const launch = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await catchUp(detail.run.id);
      onLaunched();
    } catch (e) {
      setFailed((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded border border-zinc-300 p-4">
      <h2 className="font-medium">
        Catch up on {missing} grade{missing > 1 ? "s" : ""}
      </h2>
      <p className="text-sm text-zinc-700">
        A judge on this run — added after the fact, crashed on a few cells,
        or left behind by an extension or an interruption — still has{" "}
        {missing} pending grade{missing > 1 ? "s" : ""} on conversations that
        already finished. <strong>No existing grade is touched</strong> — the
        transcripts are reread, and neither the evaluated models nor the
        adversary are called again.
      </p>
      <button
        onClick={launch}
        disabled={busy}
        className="rounded border px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
      >
        {busy ? "Starting…" : "Catch up"}
      </button>
      {failed && <p className="text-sm text-red-700">{failed}</p>}
    </section>
  );
}

export default function EvalRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [addingJudge, setAddingJudge] = useState(false);
  const [extending, setExtending] = useState(false);
  // Une extension proposée par un agent, ouverte depuis la liste des
  // brouillons. Elle ne préremplit que le panneau : rien n'est appliqué au run
  // tant que personne n'a confirmé, outils proposés compris.
  const [proposal, setProposal] = useState<ExtendRequest | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  // Si le brouillon ouvert appartient à qui regarde — calculé par la route,
  // jamais comparé ici : cette page ne connaît pas l'adresse de qui regarde.
  // Vrai par défaut : sans proposition ouverte, enregistrer en crée toujours
  // une à soi.
  const [proposalMine, setProposalMine] = useState(true);
  // Comment lire la matrice. Rien n'en sort vers la base : c'est une lecture,
  // pas un résultat, et un rechargement ramène la lecture ordinaire.
  const [view, setView] = useState<MatrixView>(PLAIN_VIEW);
  // À travers quel juge on regarde la matrice — `undefined` veut dire « le
  // principal ». Un choix d'affichage, pas une écriture : contrairement à
  // `handleDesignatePrincipal` plus bas, rien ici ne touche la base, et un
  // rechargement de la page l'oublie. C'est `JudgeBlock` qui porte le
  // sélecteur ; `RunMatrix`, plus bas sur cette page, le reçoit pour suivre
  // le même juge que ce que `JudgeBlock` explique.
  const [displayedRunJudgeId, setDisplayedRunJudgeId] = useState<
    string | undefined
  >(undefined);
  const [openScenario, setOpenScenario] = useState<number | null>(null);
  const [stopping, setStopping] = useState(false);
  // Quelle action attend d'être confirmée, s'il y en a une.
  const [confirming, setConfirming] = useState<null | "stop" | "retry">(
    null,
  );
  // Le retour d'une action du menu, qui s'est refermé depuis. Séparé de
  // `error`, qui remplace la page entière : un presse-papier récalcitrant ne
  // doit pas faire disparaître la matrice.
  const [notice, setNotice] = useState("");
  // Les transcripts pèsent lourd et ne servent qu'à la fenêtre de détail : on
  // ne les charge qu'à l'ouverture d'une case, pas à chaque rafraîchissement.
  const [transcripts, setTranscripts] = useState(false);
  const [open, setOpen] = useState<{ scenario: number; target: string } | null>(
    null,
  );
  // L'adresse publique quand le run est publié, `null` sinon.
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  // Le catalogue et les tags de ce run, pour `TagField` — qui ne les charge
  // plus lui-même. `tagsLoaded` évite d'afficher « No tags yet. » un instant
  // avant que la vraie réponse n'arrive.
  const [tagCatalog, setTagCatalog] = useState<Tag[]>([]);
  const [runTags, setRunTagsState] = useState<Tag[]>([]);
  const [tagsLoaded, setTagsLoaded] = useState(false);

  const loadTags = useCallback(async () => {
    try {
      const [catalog, current] = await Promise.all([getTags(), getRunTags(runId)]);
      setTagCatalog(catalog);
      setRunTagsState(current);
    } catch {
      // Laissés tels quels plutôt que de casser la page : ce ne sont que des
      // pastilles, pas la matrice.
    } finally {
      setTagsLoaded(true);
    }
  }, [runId]);

  useEffect(() => {
    // Même raison que pour `load` ci-dessous : un timer plutôt qu'un appel
    // direct dans le corps de l'effet.
    const timer = setTimeout(() => loadTags(), 0);
    return () => clearTimeout(timer);
  }, [loadTags]);

  const load = useCallback(
    async (withTranscripts: boolean) => {
      try {
        const loaded = await getRun(runId, withTranscripts);
        // Même raison que sur la liste : un run terminé qu'on garde ouvert ne
        // doit pas faire clignoter sa matrice.
        setDetail((current) => keepIfUnchanged(current, loaded));
        setPublicUrl(loaded.run.is_public ? `/shared/${loaded.run.id}` : null);
        // Amorcé une seule fois : le rafraîchissement d'un run en cours ne doit
        // pas écraser une note en train d'être écrite.
        setNotes((current) => (current === "" ? loaded.run.notes : current));
        setAnalysis((current) =>
          current === "" ? loaded.run.analysis : current,
        );
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [runId],
  );

  // `?extend=<id>` : on vient de la liste des brouillons avec une proposition à
  // relire. Le panneau s'ouvre dessus plutôt que vide.
  useEffect(() => {
    const draftId = searchParams.get("extend");
    if (!draftId) return;
    let cancelled = false;
    getDraft(draftId)
      .then((draft) => {
        if (cancelled) return;
        if (draft.kind !== "extend") {
          setError("That draft is a run to launch, not an extension.");
          return;
        }
        setProposal(draft.config);
        setProposalId(draftId);
        setProposalMine(draft.mine);
        setExtending(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(`Could not open that draft: ${e.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  useEffect(() => {
    // Passer par un timer plutôt que d'appeler load() dans le corps de
    // l'effet : celui-ci déclenche un setState synchrone, ce que la règle
    // react-hooks/set-state-in-effect interdit à juste titre.
    const timer = setTimeout(() => load(transcripts), 0);
    return () => clearTimeout(timer);
  }, [load, transcripts]);

  const running =
    detail?.run.status === "running" || detail?.run.status === "triggered";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => load(transcripts), 3000);
    return () => clearInterval(timer);
  }, [running, load, transcripts]);

  // Pas d'effet ici pour précharger les transcripts au nom du bouton de
  // rattrapage : `detail.catchup_missing` arrive déjà calculé par `loadRun`,
  // qui a les transcripts en main sans jamais les envoyer au navigateur (voir
  // `catchupMissingTotal` dans `lib/runs.ts`). Un tel effet a existé, et son
  // garde-fou ratait un run juge éteint ou une seule case vide ou en erreur —
  // une fois déclenché, relancer la passe repassait le run en cours et le
  // rafraîchissement de trois secondes ci-dessus rechargeait alors tous les
  // transcripts en boucle pendant toute la passe, exactement ce que
  // `SAMPLE_COLUMNS` existe pour éviter.

  // Les journaux ne montent qu'à la toute fin du job — d'où la relecture quand
  // le run cesse de tourner, et non au seul premier rendu.
  const [inspectLogs, setInspectLogs] = useState(false);
  useEffect(() => {
    let vivant = true;
    void hasInspectLogs(runId).then((présents) => {
      if (vivant) setInspectLogs(présents);
    });
    return () => {
      vivant = false;
    };
  }, [runId, running]);

  if (error) {
    return (
      <main className="mx-auto max-w-6xl p-8">
        <p
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-red-800"
        >
          {error}
        </p>
      </main>
    );
  }

  if (!detail) return <main className="mx-auto max-w-6xl p-8">Loading…</main>;

  const { run, progress } = detail;
  const copyMatrix = async () => {
    try {
      await navigator.clipboard.writeText(await matrixCsvText(run.id, view));
      setNotice("Table copied to the clipboard.");
    } catch (e) {
      setNotice(`Could not copy: ${(e as Error).message}`);
    }
    setTimeout(() => setNotice(""), 3000);
  };

  const stop = async () => {
    setStopping(true);
    try {
      await cancelRun(run.id);
      setConfirming(null);
      await load(transcripts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStopping(false);
    }
  };

  const retry = async () => {
    try {
      await retryFailedCells(run.id);
      setConfirming(null);
      await load(transcripts);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const publish = async (isPublic: boolean) => {
    setPublishing(true);
    try {
      const { url } = await publishRun(run.id, isPublic);
      setPublicUrl(url);
      setConfirmingPublish(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  };
  const openCell = (scenario: number, target: string) => {
    setOpen({ scenario, target });
    // Une seule fois : une fois les transcripts chargés, les rafraîchissements
    // suivants les gardent.
    if (!transcripts) setTranscripts(true);
  };

  const handleUnlinkJudge = async (
    runJudgeId: string,
    replacementRunJudgeId?: string,
  ) => {
    await unlinkRunJudge(run.id, runJudgeId, replacementRunJudgeId ?? null);
    await load(transcripts);
  };

  const handleDesignatePrincipal = async (runJudgeId: string) => {
    await designateRunPrincipal(run.id, runJudgeId);
    await load(transcripts);
  };

  // Le verdict du principal, joint à chaque case pour le panneau d'extension
  // (`ExtendPanelSample`, qui approfondit sur celui-là — voir son
  // commentaire) — même repli que `RunMatrix`/`JudgeBlock` quand
  // `detail.judges` n'est pas encore fourni.
  const principal = principalJudge(detail.judges);
  const extendPanelSamples: ExtendPanelSample[] = detail.samples.map((sample) => ({
    scenario_index: sample.scenario_index,
    target_model: sample.target_model,
    status: sample.status,
    turns_done: sample.turns_done,
    usage: sample.usage,
    principal: verdictOf(principal, sample.id),
  }));

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {run.label ?? "Evaluation run"}
          </h1>
          <p className="text-sm text-zinc-600">
            <CopyId value={run.id} /> · {run.config.scenarios.length} scenario
            {run.config.scenarios.length > 1 ? "s" : ""} ·{" "}
            {run.config.models.targets.length} model
            {run.config.models.targets.length > 1 ? "s" : ""} · {run.config.repetitions} repetition
            {run.config.repetitions > 1 ? "s" : ""} · {run.config.turns} turn
            {run.config.turns > 1 ? "s" : ""}
            {run.cost_usd !== null && (
              <>
                {" · "}
                <span
                  className="font-medium text-zinc-900"
                  title={Object.entries(run.usage)
                    .map(
                      ([model, u]) =>
                        `${model}: ${u.input_tokens.toLocaleString()} in / ${u.output_tokens.toLocaleString()} out`,
                    )
                    .join("\n")}
                >
                  ${run.cost_usd.toFixed(run.cost_usd < 1 ? 4 : 2)}
                </span>
                {run.estimate && (
                  // L'écart au devis, à côté du prix : c'est en le voyant run
                  // après run qu'on saura si l'estimation dérive, et sur quels
                  // modèles.
                  <span
                    className="text-zinc-500"
                    title={`Estimated $${run.estimate.usd.toFixed(4)} before launching, assuming ${run.estimate.per_model
                      .map((m) => `${m.model} ${m.response_tokens} tok/turn`)
                      .join(", ")}`}
                  >
                    {" "}
                    (estimate ${run.estimate.usd.toFixed(
                      run.estimate.usd < 1 ? 4 : 2,
                    )}
                    {run.cost_usd > 0 &&
                      `, ${
                        run.estimate.usd >= run.cost_usd ? "+" : ""
                      }${Math.round(
                        ((run.estimate.usd - run.cost_usd) / run.cost_usd) * 100,
                      )}%`}
                    )
                  </span>
                )}
              </>
            )}
          </p>
          {/* Sur sa propre ligne plutôt qu'au bout de la précédente :
              noyée entre le coût et le devis, l'adresse ne se lisait pas. */}
          {run.user_email && (
            <p className="text-sm text-zinc-500">{run.user_email}</p>
          )}
        </div>
        <div className="flex shrink-0 items-start justify-end gap-2">
          {/* L'arrêt reste dehors : c'est la seule action qu'on cherche dans
              l'urgence, et elle ne paraît que pendant qu'un run tourne — donc
              jamais en même temps que celles du menu. */}
          {running && (
            <button
              onClick={() => setConfirming("stop")}
              disabled={stopping}
              title="Le job lit la demande avant chaque case. Celle en cours ira à son terme."
              className="cursor-pointer rounded border border-amber-400 bg-amber-50 px-3 py-1 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
          <Menu label="Run actions">
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    close();
                    router.push(`/?from=${run.id}`);
                  }}
                  hint="A separate run, same settings"
                >
                  Duplicate
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    if (publicUrl) publish(false);
                    else setConfirmingPublish(true);
                  }}
                  hint={
                    publicUrl
                      ? "Kills the link"
                      : "A link anyone can open, read only"
                  }
                >
                  {publicUrl ? "Unpublish" : "Publish…"}
                </MenuItem>
                {!running && (
                  <MenuItem
                    onClick={() => {
                      close();
                      setExtending(true);
                    }}
                    hint="Scenarios, models or attempts, added here"
                  >
                    Extend…
                  </MenuItem>
                )}
                {!running && progress.errored > 0 && (
                  <MenuItem
                    onClick={() => {
                      close();
                      setConfirming("retry");
                    }}
                    hint="Run them again, in this same run"
                  >
                    Retry failed ({progress.errored})
                  </MenuItem>
                )}
                {!running && progress.done + progress.errored > 0 && (
                  <MenuItem
                    onClick={() => {
                      close();
                      setAddingJudge(true);
                    }}
                    hint="A different question, same transcripts, kept side by side"
                  >
                    Add a judge…
                  </MenuItem>
                )}
                <MenuSeparator />
                <MenuItem
                  href={exportUrl(run.id, "matrix", view)}
                  onClick={close}
                  hint="The table as shown"
                >
                  Download table
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    void copyMatrix();
                  }}
                  hint="Paste into a sheet or a doc"
                >
                  Copy table
                </MenuItem>
                <MenuItem
                  href={exportUrl(run.id, "details")}
                  onClick={close}
                  hint="A zip: results.csv, plus run.md with the notes and the tools"
                >
                  Download full data (zip)
                </MenuItem>
                {detail.source_csv_available && (
                  <MenuItem
                    href={sourceCsvUrl(run.id)}
                    onClick={close}
                    hint="The CSV uploaded when this run was launched"
                  >
                    Source CSV
                  </MenuItem>
                )}
                {inspectLogs && (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      href={inspectViewUrl(run.id)}
                      onClick={close}
                      newTab
                      hint="Every model call, as it was sent — target, adversary, judge"
                    >
                      View Inspect AI logs
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </Menu>
        </div>
      </div>

      <section className="rounded border border-zinc-300 p-3">
        <h2 className="text-sm font-medium">Tags</h2>
        {tagsLoaded ? (
          <TagField
            tags={runTags}
            catalog={tagCatalog}
            onSave={(ids) => setRunTags(run.id, ids)}
            onSaved={loadTags}
          />
        ) : (
          <p className="mt-2 text-xs text-zinc-400">Loading…</p>
        )}
      </section>

      {/* D'où il sort, quand il sort d'un brouillon. Le lien rouvre le
          formulaire dessus : c'est là qu'on repart de la même configuration.
          L'identifiant peut ne plus rien désigner — un brouillon jeté à la
          main disparaît, et la provenance du run lui survit exprès. */}
      {run.draft_id && (
        <p className="text-sm text-zinc-500">
          Launched from{" "}
          <Link href={`/?draft=${run.draft_id}`} className="underline">
            the draft it came from
          </Link>
          .
        </p>
      )}

      {publicUrl && (
        <p className="flex items-center gap-1 text-sm text-zinc-500">
          Published — anyone with this link can read it:{" "}
          <code className="rounded bg-zinc-100 px-1">{publicUrl}</code>
          {/* Le lien copié est absolu : celui qui le reçoit n'a pas le
              contexte de cette fenêtre, et une adresse relative ne lui dirait
              rien. `window.location.origin` n'est lu qu'au clic — jamais
              pendant le rendu, où il n'existe pas côté serveur. */}
          <CopyButton
            value={() => `${window.location.origin}${publicUrl}`}
            title="Copy the public link"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            {(copied) =>
              copied ? (
                <span className="text-teal-700">copied</span>
              ) : (
                <CopyIcon />
              )
            }
          </CopyButton>
        </p>
      )}

      {running && (
        <p className="rounded border border-zinc-300 p-3 text-sm">
          {/* `triggered` et `running` ne veulent pas dire la même chose, et les
              confondre fait passer pour « en cours » un job qui n'a pas encore
              démarré. Un démarrage à froid de Cloud Run prend une minute : sans
              cette distinction, on croit à un blocage. */}
          {run.status === "triggered" ? (
            <>
              <strong>Starting.</strong> The job has been asked to start; no
              cell has begun yet — {progress.total} queued. A cold start takes
              about a minute.
            </>
          ) : (
            <>
              <strong>Running.</strong> {progress.done} graded
              {progress.running > 0 && `, ${progress.running} in flight`}
              {/* Les cases qui n'ont pas commencé sont ce qui reste à payer :
                  c'est le chiffre qu'on cherche quand on hésite à arrêter. */}
              {progress.pending > 0 && `, ${progress.pending} still to run`}
              {progress.errored > 0 && `, ${progress.errored} failed`} — out of{" "}
              {progress.total} cells.
            </>
          )}
        </p>
      )}

      {run.status === "error" && (
        <p
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-red-800"
        >
          The run failed: {run.error}
        </p>
      )}

      {run.status === "cancelled" && (
        <p className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Stopped.</strong> {progress.done} of {progress.total} cells
          finished
          {progress.cancelled > 0 && ` · ${progress.cancelled} never ran (∅)`}
          {progress.errored > 0 && ` · ${progress.errored} failed`}. A cell
          already in flight when you stopped was let finish — what was paid for
          is kept. Extend to finish what was left, or Duplicate to start over.
        </p>
      )}

      {notice && (
        <p className="rounded border border-zinc-300 bg-zinc-50 p-2 text-sm text-zinc-700">
          {notice}
        </p>
      )}

      <ConfirmDialog
        open={confirming === "stop"}
        title="Stop this run?"
        confirmLabel="Stop the run"
        tone="warning"
        busy={stopping}
        onConfirm={stop}
        onCancel={() => setConfirming(null)}
      >
        {/* Les trois issues ne sont pas symétriques, et c'est la source de
            l'hésitation : ce qui est en vol est déjà payé, ce qui n'a pas
            commencé ne coûtera rien, ce qui est noté reste. */}
        <ConfirmRows
          rows={[
            {
              label: "In flight",
              count: progress.running,
              fate: "will finish, and be kept.",
            },
            {
              label: "Not started",
              count: progress.pending,
              fate: "will be cancelled.",
            },
            {
              label: "Already graded",
              count: progress.done,
              fate: "kept as they are.",
            },
            { label: "Failed", count: progress.errored, fate: "unchanged." },
          ]}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === "retry"}
        title={`Retry ${progress.errored} failed cell${progress.errored > 1 ? "s" : ""}?`}
        confirmLabel="Retry them"
        onConfirm={retry}
        onCancel={() => setConfirming(null)}
      >
        <ConfirmRows
          rows={[
            {
              label: "Failed",
              count: progress.errored,
              fate: "will be run again, in this same run.",
            },
            {
              label: "Already graded",
              count: progress.done,
              fate: "untouched, and not paid for again.",
            },
          ]}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingPublish}
        title="Publish this run?"
        confirmLabel="Publish"
        busy={publishing}
        onConfirm={() => publish(true)}
        onCancel={() => setConfirmingPublish(false)}
      >
        <p className="text-sm">
          Anyone with the link will be able to read it, without signing in. The
          link is not listed anywhere, and unpublishing kills it.
        </p>
        <ConfirmRows
          rows={[
            {
              label: "Results",
              count: detail.samples.length,
              fate: "scores, judge justifications and full conversations",
            },
            {
              label: "Scenarios",
              count: run.config.scenarios.length,
              fate: "titles, system prompts, opening messages and their notes",
            },
            {
              label: "Your notes",
              count: run.notes.trim() === "" ? 0 : 1,
              fate: "published with the rest",
            },
          ]}
        />
        <p className="text-sm text-zinc-500">
          Your email address is the only thing kept back.
        </p>
      </ConfirmDialog>

      {extending && !running && (
        <ExtendPanel
          run={run}
          repetitionRange={repetitionRange(detail.samples)}
          samples={extendPanelSamples}
          proposal={proposal}
          draftId={proposalId}
          draftMine={proposalMine}
          onCancel={() => setExtending(false)}
          onSubmit={async (request) => {
            await extendRun(run.id, request);
            // Le brouillon a servi : marqué lancé, donc sorti de la liste
            // d'attente sans être jeté. Après l'extension, jamais avant — une
            // extension qui échoue doit laisser de quoi recommencer.
            if (proposalId) {
              await markDraftLaunched(proposalId).catch(() => {});
            }
            setExtending(false);
            setProposal(null);
            setProposalId(null);
            await load(transcripts);
          }}
          onSaveDraft={async (request) => {
            // En place pour son auteur ; à part pour n'importe qui d'autre,
            // qui reçoit son propre brouillon sans toucher à l'original —
            // même règle que le formulaire de composition d'un run.
            // `updateDraft` sert les deux genres de brouillon, celui-ci
            // compris : la route lit le genre depuis ce qu'elle a en base.
            if (proposalId) {
              const result = await updateDraft(proposalId, request, null);
              if (result.forked) {
                setProposalId(result.draft_id);
                setProposalMine(true);
                router.replace(`/eval/${run.id}?extend=${result.draft_id}`);
              }
              return { forked: result.forked };
            }
            const { id } = await saveExtendDraft(run.id, request);
            // L'adresse dans la barre suit : réenregistrer met à jour
            // celui-ci au lieu d'en créer un second.
            setProposalId(id);
            setProposalMine(true);
            router.replace(`/eval/${run.id}?extend=${id}`);
            return { forked: false };
          }}
        />
      )}

      {addingJudge && !running && (
        <AddJudgePanel
          detail={detail}
          onAdded={() => {
            setAddingJudge(false);
            load(transcripts);
          }}
          onClose={() => setAddingJudge(false)}
        />
      )}

      {!running && detail.catchup_missing > 0 && (
        <CatchUpButton detail={detail} onLaunched={() => load(transcripts)} />
      )}

      <JudgeBlock
        detail={detail}
        onUnlink={handleUnlinkJudge}
        onDesignatePrincipal={handleDesignatePrincipal}
        displayedRunJudgeId={displayedRunJudgeId}
        onSelectDisplayed={setDisplayedRunJudgeId}
      />

      <ToolsBlock detail={detail} />

      <RunMatrix
        detail={detail}
        view={view}
        onViewChange={setView}
        onOpenScenario={setOpenScenario}
        onOpenCell={openCell}
        displayedRunJudgeId={displayedRunJudgeId}
      />

      <NotesField
        // La clé force un remontage quand le run change : sans elle, l'état
        // local du composant survivrait à la navigation d'un run à l'autre.
        // Distincte de celle du champ Run Analysis, juste en dessous — deux
        // instances du même composant, à la même profondeur, ne peuvent pas
        // partager une clé sans que React confonde leur état local.
        key={`${run.id}-notes`}
        value={notes}
        onChange={setNotes}
        rows={8}
        onSave={async (next) => {
          await saveNotes(run.id, next);
        }}
      />

      <NotesField
        key={`${run.id}-analysis`}
        label="Run Analysis"
        value={analysis}
        onChange={setAnalysis}
        rows={8}
        hint="Written after the fact — what the results actually show."
        onSave={async (next) => {
          await saveAnalysis(run.id, next);
        }}
      />

      <ExtensionsHistory run={run} />

      {openScenario !== null && (
        <ScenarioModal
          run={run}
          index={openScenario}
          onClose={() => setOpenScenario(null)}
        />
      )}
      {open && (
        <DetailModal
          detail={detail}
          scenarioIndex={open.scenario}
          target={open.target}
          loading={!transcripts}
          onClose={() => setOpen(null)}
        />
      )}
    </main>
  );
}

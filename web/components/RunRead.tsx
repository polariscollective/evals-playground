"use client";

// Ce qu'on lit d'un run — la matrice ouverte case par case, les scénarios, les
// outils, le juge, les trajectoires.
//
// Extrait de la page privée pour que la page publique montre exactement la
// même chose. La version d'avant en donnait une version appauvrie, au motif
// que la lecture seule devait être une propriété du fichier : c'était vrai
// pour l'écriture, et payé par une lecture inférieure alors que lire n'a
// jamais été le danger.
//
// Ce qui protège vraiment n'est pas l'absence de boutons ici mais
// `requireUser()` sur chaque route qui écrit, et `loadPublicRun` sur ce qui se
// lit. Ce fichier ajoute une garantie de plus, tenue par le compilateur : ses
// composants prennent un `PublicRunDetail`, dont le `run` n'a pas de
// `user_email`. Rendre l'adresse de qui a lancé le run est une erreur de
// compilation, pas une vigilance à tenir.
//
// DEPUIS LES JUGES MULTIPLES — un doute porté au rapport de cette tâche, à
// lire avant de toucher à `RunJudgeView` ci-dessous : ni `RunDetail` ni
// `PublicRunDetail` (`lib/types.ts`, `lib/public-run.ts`) ne portent encore
// les juges d'un run, et aucune route ne les lit — `loadRun` (`lib/runs.ts`)
// n'attache que `progress`/`awareness_missing`, jamais les liaisons vivantes
// ni leurs `judge_scores`. Cette tâche a pour mandat de ne toucher QUE ce
// fichier et `app/eval/[runId]/page.tsx` ; elle ne peut donc pas poser cette
// jointure elle-même, sur le modèle de `principalVerdictsByRun` dans
// `runs.ts`, qui ne le fait que pour la liste des runs, jamais pour un run
// ouvert. `RunJudgeView` ci-dessous est donc une extension LOCALE, purement
// additive (`detail.judges?`) : tant que `RunDetail` ne la porte pas
// réellement, `judges` vaut `undefined` partout et cet écran se comporte
// exactement comme avant les juges multiples — le principal lu dans
// `config`, aucun autre juge à montrer, aucune action à proposer. Le jour où
// une route l'attache avec cette forme (`run_judge_id`, `judge`,
// `is_principal`, `system_type`, `scores` par `sample_id`), tout ce fichier
// s'anime sans qu'une ligne d'ici ne bouge.
import { useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { ViewControls } from "@/components/ViewControls";
import {
  AWAKE_TYPE,
  AWARENESS_ALARM,
  AWARENESS_VISIBLE,
  awarenessSentence,
  awarenessSummary,
} from "@/lib/awareness";
import { cellsOf } from "@/lib/matrix";
import type { MatrixSample } from "@/lib/matrix";
import { describeView, viewBounds } from "@/lib/view";
import type { MatrixView } from "@/lib/view";
import { MessageView } from "@/components/MessageView";
import { toolsFor } from "@/lib/tools";
import {
  cellStyle,
  distribution,
  formatMean,
  formatValue,
  rubricBounds,
  sortedRubric,
} from "@/lib/rubric";
import type { PublicRun, PublicRunDetail } from "@/lib/public-run";
import type {
  EvalSample,
  Judge,
  JudgeScoreStatus,
  JudgeSystemTypeColumn,
  RubricLevel,
  SampleStatus,
} from "@/lib/types";

// --- Juges multiples : lecture, en attendant la jointure serveur -----------

/** Le verdict d'UN juge sur UNE conversation, tel que cet écran voudrait le
 *  lire — un sous-ensemble de `JudgeScore` (`lib/types.ts`), sans
 *  `run_judge_id` ni `sample_id` : ceux-ci se déduisent déjà de où cette
 *  valeur est rangée (voir `RunJudgeView.scores`). */
export interface JudgeVerdictEntry {
  status: JudgeScoreStatus;
  score: number | null;
  justification: string;
  error: string | null;
}

/** Un juge vivant d'un run, tel que cet écran le lit : son identité
 *  (`judge`), son rôle sur CE run (`is_principal`, `system_type` — copiés
 *  depuis `run_judges`, voir son commentaire dans `lib/types.ts`), et son
 *  verdict sur chaque conversation, par `sample_id`. Jamais un juge
 *  supprimé : voir l'en-tête de ce fichier — c'est à la fonction qui pose
 *  cette jointure, pas à celle-ci, de filtrer `deleted_at`. */
export interface RunJudgeView {
  run_judge_id: string;
  judge: Judge;
  is_principal: boolean;
  system_type: JudgeSystemTypeColumn;
  scores: Record<string, JudgeVerdictEntry>;
}

/** `PublicRunDetail`/`RunDetail`, augmenté de `judges` — voir l'en-tête de ce
 *  fichier pour pourquoi cette extension reste locale et optionnelle. Un
 *  `RunDetail` ordinaire (sans `judges`) satisfait ce type sans conversion :
 *  c'est ce qui garde `SharedRunView.tsx` et `app/shared/[runId]/page.tsx` —
 *  hors du périmètre de cette tâche — compatibles sans y toucher. */
export type ReadDetail = PublicRunDetail & { judges?: RunJudgeView[] };

/** En attente : ni notée, ni tombée. Le même défaut que `loadRuns` rend déjà
 *  pour une conversation sans principal vivant (`principalVerdictsByRun`,
 *  `runs.ts`) — une absence de donnée n'est pas différente, pour l'affichage,
 *  d'un juge qui n'est pas encore passé. */
const PENDING_VERDICT: JudgeVerdictEntry = {
  status: "pending",
  score: null,
  justification: "",
  error: null,
};

/** Le principal vivant de la liste, ou `undefined` — aucun juge encore
 *  attaché (voir l'en-tête de ce fichier), ou improbable liste sans
 *  principal. Au plus un principal vivant est garanti en base (invariant 1
 *  de la conception) : cette fonction n'a donc jamais à choisir entre
 *  plusieurs candidats. */
export function principalJudge(judges: RunJudgeView[] | undefined): RunJudgeView | undefined {
  return judges?.find((judge) => judge.is_principal);
}

/** Le verdict de ce juge sur cette conversation, ou l'attente par défaut si
 *  le juge est absent (pas encore de jointure) ou n'a pas encore cette
 *  ligne. */
export function verdictOf(
  judge: RunJudgeView | undefined,
  sampleId: string,
): JudgeVerdictEntry {
  return judge?.scores[sampleId] ?? PENDING_VERDICT;
}

/** Un court libellé pour un juge, dans la liste des « autres juges ».
 *
 * Un juge système ne porte ni critère ni échelle en base — voir la
 * conception, section « Les juges système » — son texte vit dans le code qui
 * le construit, jamais ici : `awake` est le seul aujourd'hui. */
function judgeLabel(judge: Judge): string {
  if (judge.system_type === AWAKE_TYPE) return "Eval awareness (built-in, 1–10)";
  const text = (judge.criterion ?? "").trim();
  if (!text) return "(no criterion)";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** Combien d'essais chaque couple scénario × modèle a déjà : le moins, le plus.
 *
 * Un run complété n'avance pas au même rythme partout — un modèle ajouté en
 * cours de route a moins d'essais que les premiers, et la moyenne d'une case
 * porte alors sur moins de conversations que celle d'à côté. Le dire est le prix
 * d'une matrice qu'on peut agrandir. */
export function repetitionRange(samples: EvalSample[]): [number, number] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const key = `${sample.scenario_index} ${sample.target_model}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = [...counts.values()];
  if (values.length === 0) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}

export function shortModel(id: string): string {
  return id.split("/").pop() ?? id;
}

/** La note d'un juge sur une tentative, avec le sens que l'échelle lui donne.
 *
 * Le nombre seul ne dit rien : c'est la phrase écrite à côté qui porte le
 * jugement, et la relire ici évite de remonter à l'échelle à chaque tentative.
 *
 * Depuis les juges multiples, la note ne vit plus sur la tentative
 * (`EvalSample`) mais dans une ligne de `judge_scores`, une par juge — d'où
 * `status` (l'exécution) et `verdict` (CE juge) séparés : une tentative qui a
 * fini de jouer peut très bien n'avoir encore aucune note d'un juge donné.
 * `executionError` reste celui de la tentative, jamais celui du juge — voir
 * `EvalSample.error` dans `lib/types.ts` pour cette distinction. */
export function ScoreBadge({
  status,
  verdict,
  rubric,
  executionError,
}: {
  status: SampleStatus;
  verdict: JudgeVerdictEntry;
  rubric: RubricLevel[];
  executionError?: string | null;
}) {
  if (status === "pending" || status === "running") {
    return (
      <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
        {status === "running" ? "running…" : "queued"}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-900"
        title={executionError ?? undefined}
      >
        failed
      </span>
    );
  }
  if (status === "cancelled") {
    // Pas rouge : on a décidé de ne pas la faire, elle n'a pas cassé.
    return (
      <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700">
        not run
      </span>
    );
  }
  if (verdict.status === "error") {
    // Le juge est tombé sur une conversation par ailleurs valide — jamais
    // confondu avec `status === "error"` ci-dessus, qui est l'exécution.
    return (
      <span
        className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-900"
        title={verdict.error ?? undefined}
      >
        judge failed
      </span>
    );
  }
  if (verdict.status === "pending" || verdict.score === null) {
    return (
      <span className="rounded border border-dashed border-zinc-400 px-2 py-0.5 text-xs text-zinc-500">
        not judged
      </span>
    );
  }

  const { min, max } = rubricBounds(rubric);
  const level = rubric.find((one) => one.value === verdict.score);
  const meaning = level?.meaning;

  if (level?.excluded) {
    // Le juge a répondu, mais sa réponse reste hors moyenne : ni une note, ni
    // une absence de note.
    return (
      <span
        className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600"
        title={meaning}
      >
        n/a — {meaning}
      </span>
    );
  }
  const t = max > min ? (verdict.score - min) / (max - min) : 0;
  const style =
    t <= 0
      ? "bg-teal-100 text-teal-900"
      : t < 0.5
        ? "bg-amber-100 text-amber-900"
        : t < 1
          ? "bg-amber-300 text-amber-950"
          : "bg-zinc-900 text-white";
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${style}`} title={meaning}>
      {formatValue(verdict.score)}
      {meaning ? ` — ${meaning}` : ""}
    </span>
  );
}

/** Les outils du run, tels qu'ils ont été présentés au modèle.
 *
 * Mot pour mot, description comprise : sans elle on ne peut pas relire une
 * décision d'appel, puisque c'est le seul texte que le modèle avait sous les
 * yeux au moment de décider. Le compte d'appels réels est là parce qu'un outil
 * défini et jamais appelé est un résultat, pas un oubli. */
export function ToolsBlock({ detail }: { detail: PublicRunDetail }) {
  const { config } = detail.run;
  const tools = config.tools ?? [];
  if (tools.length === 0) return null;

  const appels = (name: string) =>
    detail.samples.reduce(
      (total, sample) =>
        total +
        sample.messages.filter((message) =>
          (message.tool_calls ?? []).some((call) => call.name === name),
        ).length,
      0,
    );

  return (
    <section className="space-y-3 rounded border border-zinc-300 bg-zinc-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Tools the evaluated model could call</h2>
        <span className="text-xs text-zinc-500">
          nothing was executed · up to{" "}
          {config.max_tool_calls_per_turn ?? 5} consecutive calls per turn
        </span>
      </div>
      {tools.map((tool) => {
        const offert = config.scenarios.filter((scenario) =>
          toolsFor(config, scenario).some((entry) => entry.name === tool.name),
        ).length;
        return (
          <div key={tool.name} className="space-y-1 border-t border-zinc-200 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <code className="text-sm font-medium">{tool.name}</code>
              <span className="text-xs text-zinc-500">
                offered to {offert} of {config.scenarios.length} scenarios ·
                called {appels(tool.name)}×
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap text-zinc-800">
              {tool.description}
            </p>
            {tool.parameters.length > 0 && (
              <p className="font-mono text-xs text-zinc-600">
                {tool.parameters
                  .map(
                    (param) =>
                      `${param.name}: ${param.type}${param.required ? "" : "?"}`,
                  )
                  .join(", ")}
              </p>
            )}
            <p className="text-xs text-zinc-500">
              returns: <span className="font-mono">{tool.result || "(empty)"}</span>
            </p>
          </div>
        );
      })}
    </section>
  );
}

/** Ce qui définit une ligne de la matrice, réuni.
 *
 * « Pourquoi cette ligne » est la question qu'on se pose devant une matrice, et
 * le titre seul n'y répond pas — surtout sur douze scénarios dont les titres se
 * ressemblent parce qu'ils ne varient que d'un axe. La note y répond ; le reste
 * est là pour vérifier qu'elle dit vrai.
 */
export function ScenarioModal({
  run,
  index,
  onClose,
}: {
  run: PublicRun;
  index: number;
  onClose: () => void;
}) {
  const scenario = run.config.scenarios[index];
  if (!scenario) return null;
  const tools = toolsFor(run.config, scenario);
  const hasTools = (run.config.tools ?? []).length > 0;

  return (
    <Dialog
      open
      title={scenario.title}
      width="44rem"
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {scenario.note ? (
          <div className="rounded border border-teal-300 bg-teal-50 p-3">
            <p className="mb-1 text-xs font-medium text-teal-900">
              {/* Une note de laboratoire, pas une consigne : le modèle et le
                  juge ne la voient jamais. Le dire ici évite qu'on l'écrive un
                  jour comme si elle comptait. */}
              Note — for whoever reads the matrix. Neither the model nor the
              judge saw this.
            </p>
            <p className="whitespace-pre-wrap text-sm text-teal-950">
              {scenario.note}
            </p>
          </div>
        ) : (
          <p className="text-sm text-zinc-500 italic">
            No note was written for this scenario.
          </p>
        )}

        {hasTools && (
          <p className="text-sm">
            <span className="text-zinc-500">Tools available: </span>
            {tools.length === 0 ? (
              <span className="font-mono">none</span>
            ) : (
              tools.map((tool) => (
                <code key={tool.name} className="mr-2">
                  {tool.name}
                </code>
              ))
            )}
          </p>
        )}

        <div>
          <p className="mb-1 text-xs text-zinc-500">System prompt</p>
          <pre className="overflow-x-auto rounded border border-zinc-200 bg-zinc-50 p-3 text-xs whitespace-pre-wrap">
            {scenario.system_prompt}
          </pre>
        </div>

        {(scenario.history ?? []).length > 0 && (
          <div>
            <p className="mb-1 text-xs text-zinc-500">
              Prior history — given, not produced
            </p>
            <div className="space-y-1">
              {(scenario.history ?? []).map((turn, position) => (
                <div
                  key={position}
                  className="rounded border border-dashed border-zinc-300 p-2 text-xs"
                >
                  <span className="mr-2 font-medium text-zinc-500">
                    {turn.role}
                  </span>
                  <span className="whitespace-pre-wrap">{turn.content}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs text-zinc-500">Opening message</p>
          <pre className="overflow-x-auto rounded border border-zinc-200 bg-zinc-50 p-3 text-xs whitespace-pre-wrap">
            {scenario.opening_message}
          </pre>
        </div>
      </div>
    </Dialog>
  );
}

/** Une ligne pour un juge secondaire ou système, dans la liste des « autres
 *  juges » — jamais le principal, déjà affiché par le bloc qui l'entoure.
 *
 * `onUnlink`/`onDesignatePrincipal` absents : lecture pure, c'est ce qui garde
 * ce composant utilisable depuis la page publique — voir `JudgeBlock`.
 * « Make principal » n'apparaît jamais pour un juge système : sa question ne
 * vient pas de l'utilisateur et son échelle est fixe (voir la conception,
 * section « Les juges système ») — le désigner principal ferait lire la
 * matrice sur une question que personne n'a écrite. */
function OtherJudgeRow({
  judge,
  onUnlink,
  onDesignatePrincipal,
}: {
  judge: RunJudgeView;
  onUnlink?: (runJudgeId: string) => Promise<void>;
  onDesignatePrincipal?: (runJudgeId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"unlink" | "principal" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const run = async (kind: "unlink" | "principal", action: () => Promise<void>) => {
    setBusy(kind);
    setFailed(null);
    try {
      await action();
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 py-2 text-sm first:border-t-0">
      <div>
        <span className="font-mono text-xs text-zinc-500">
          {shortModel(judge.judge.model)}
        </span>{" "}
        <span className="text-zinc-700">{judgeLabel(judge.judge)}</span>
        {judge.system_type !== "ordinary" && (
          <span className="ml-1 rounded bg-zinc-100 px-1 py-0.5 text-[10px] tracking-wide text-zinc-500 uppercase">
            system
          </span>
        )}
      </div>
      {(onUnlink || onDesignatePrincipal) && (
        <div className="flex items-center gap-2">
          {onDesignatePrincipal && judge.system_type === "ordinary" && (
            <button
              onClick={() => run("principal", () => onDesignatePrincipal(judge.run_judge_id))}
              disabled={busy !== null}
              className="cursor-pointer rounded border px-2 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-50"
            >
              {busy === "principal" ? "Working…" : "Make principal"}
            </button>
          )}
          {onUnlink && (
            <button
              onClick={() => run("unlink", () => onUnlink(judge.run_judge_id))}
              disabled={busy !== null}
              className="cursor-pointer rounded border border-red-300 px-2 py-0.5 text-xs text-red-800 hover:bg-red-50 disabled:opacity-50"
            >
              {busy === "unlink" ? "Working…" : "Unlink"}
            </button>
          )}
        </div>
      )}
      {failed && (
        <p role="alert" className="w-full text-xs text-red-700">
          {failed}
        </p>
      )}
    </div>
  );
}

/** Délier le principal, avec le remplaçant que le déclencheur en base exige
 *  dans le même geste dès qu'il reste d'autres juges vivants — voir
 *  `unlinkJudge` dans `lib/runs.ts`. Sans autre juge vivant, délier est permis
 *  directement : le run reste sans aucun juge, un état valide.
 *
 * N'apparaît que si `onUnlink` est fourni — jamais sur la page publique. */
function PrincipalUnlink({
  principal,
  others,
  onUnlink,
}: {
  principal: RunJudgeView;
  others: RunJudgeView[];
  onUnlink: (runJudgeId: string, replacementRunJudgeId?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [replacement, setReplacement] = useState(others[0]?.run_judge_id ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await onUnlink(principal.run_judge_id, others.length > 0 ? replacement : undefined);
      setOpen(false);
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="cursor-pointer text-xs text-zinc-500 underline hover:text-zinc-900"
      >
        Unlink this judge…
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
      {others.length > 0 ? (
        <>
          <p className="text-xs text-amber-900">
            {/* Le déclencheur différé refuse de délier le principal sans
                remplaçant tant qu'il reste d'autres juges vivants — voir le
                commentaire d'`unlinkJudge`, `lib/runs.ts`. Le choisir ici est
                donc obligatoire, pas une simple commodité. */}
            This judge is the principal — the matrix follows it. Choose who
            takes over before unlinking it.
          </p>
          <select
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            className="rounded border border-zinc-300 bg-white p-1 text-xs"
          >
            {others.map((other) => (
              <option key={other.run_judge_id} value={other.run_judge_id}>
                {shortModel(other.judge.model)} — {judgeLabel(other.judge)}
              </option>
            ))}
          </select>
        </>
      ) : (
        <p className="text-xs text-amber-900">
          This is the only judge left on this run. Unlinking it leaves the run
          without any judge — the matrix will show nothing new.
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={confirm}
          disabled={busy}
          className="cursor-pointer rounded bg-zinc-900 px-2 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {busy ? "Working…" : others.length > 0 ? "Unlink and hand over" : "Unlink"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="cursor-pointer text-xs underline"
        >
          cancel
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-xs text-red-700">
          {failed}
        </p>
      )}
    </div>
  );
}

/** Ce que le juge principal a été chargé de regarder, et l'accès aux autres
 *  juges non supprimés du run.
 *
 * `onUnlink`/`onDesignatePrincipal` : présents seulement sur l'écran privé
 * (`app/eval/[runId]/page.tsx`) — la page publique, via `SharedRunView.tsx`,
 * appelle ce composant sans eux, et n'affiche donc jamais de bouton
 * d'écriture, exactement comme le reste de ce fichier (voir son en-tête).
 *
 * `detail.judges` absent (voir l'en-tête de ce fichier) : ce bloc retombe sur
 * `config.criterion`/`config.rubric`/`config.models.judge` et ne montre
 * aucun autre juge — le comportement d'avant les juges multiples, à la
 * lettre. */
export function JudgeBlock({
  detail,
  onUnlink,
  onDesignatePrincipal,
}: {
  detail: ReadDetail;
  onUnlink?: (runJudgeId: string, replacementRunJudgeId?: string) => Promise<void>;
  onDesignatePrincipal?: (runJudgeId: string) => Promise<void>;
}) {
  const { config } = detail.run;
  const [showOthers, setShowOthers] = useState(false);

  const judges = detail.judges;
  const principal = principalJudge(judges);
  const others = (judges ?? []).filter(
    (judge) => judge.run_judge_id !== principal?.run_judge_id,
  );

  // Le principal fait foi une fois attaché — il peut différer de `config` si
  // un autre juge a repris le titre depuis le lancement. Sans lui, `config`
  // reste la seule source, comme avant les juges multiples.
  const judgeModel = principal?.judge.model ?? config.models.judge;
  const criterion = principal?.judge.criterion ?? config.criterion;
  const rubric = principal?.judge.rubric ?? config.rubric;

  // Le voyant d'éveil : un chiffre pour tout le run, calculé ici plutôt que
  // dans un en-tête séparé pour qu'il s'affiche pareil sur la page privée et
  // sur la page publique, qui partagent ce composant mais n'ont pas le même
  // en-tête. Quand il sonne, on descend dans les conversations — d'où le fait
  // qu'il ne dise pas lesquelles. La liaison `awake` du run, si le run en a
  // une — voir `findAwakeJudge`, `lib/awareness.ts`, dont la contrainte
  // générique n'accepte plus `RunJudgeView` : `AWAKE_TYPE` seul, comme
  // `lib/runs.ts` le fait déjà pour la même raison.
  const awake = judges?.find((judge) => judge.system_type === AWAKE_TYPE);
  const awareness = awarenessSummary(awake ? Object.values(awake.scores) : []);
  const awarenessPhrase = awarenessSentence(awareness);

  return (
    <>
      <section className="space-y-3 rounded border border-zinc-300 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">What the judge was asked</h2>
          <span className="font-mono text-xs text-zinc-500">
            judged by {shortModel(judgeModel)}
            {detail.run.rejudged_at && " · re-judged since the run"}
            {detail.run.awareness_judged_at && " · eval-awareness added after the run"}
          </span>
        </div>

        <p className="whitespace-pre-wrap text-sm text-zinc-800">{criterion}</p>

        <table className="text-sm">
          <tbody>
            {sortedRubric(rubric).map((level) => (
              <tr key={level.value}>
                <td className="py-0.5 pr-3 text-right align-top font-mono text-xs text-zinc-500">
                  {formatValue(level.value)}
                </td>
                <td className="py-0.5 align-top">{level.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {onUnlink && principal && (
          <PrincipalUnlink principal={principal} others={others} onUnlink={onUnlink} />
        )}

        {/* Par défaut on ne voit que le principal, comme avant les juges
            multiples — voir la conception, section « L'écran ». `others`
            vide (aucun autre juge, ou `detail.judges` pas encore fourni) :
            rien derrière le bouton, il ne sert donc à rien. */}
        {others.length > 0 && (
          <div className="border-t border-zinc-200 pt-2">
            <button
              onClick={() => setShowOthers((visible) => !visible)}
              className="cursor-pointer text-xs text-zinc-600 underline hover:text-zinc-900"
            >
              {showOthers ? "Hide" : "Show"} {others.length} other judge
              {others.length > 1 ? "s" : ""}
            </button>
            {showOthers && (
              <div className="mt-2 space-y-1">
                {others.map((judge) => (
                  <OtherJudgeRow
                    key={judge.run_judge_id}
                    judge={judge}
                    onUnlink={onUnlink}
                    onDesignatePrincipal={onDesignatePrincipal}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {awarenessPhrase && (
        <p
          className={
            awareness.flagged > 0
              ? "text-sm font-medium text-amber-700"
              : "text-sm text-zinc-500"
          }
        >
          {awarenessPhrase}
        </p>
      )}
    </>
  );
}

export function DetailModal({
  detail,
  scenarioIndex,
  target,
  loading,
  onClose,
}: {
  detail: ReadDetail;
  scenarioIndex: number;
  target: string;
  loading: boolean;
  onClose: () => void;
}) {
  const [showSystem, setShowSystem] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const scenario = detail.run.config.scenarios[scenarioIndex];
  const attempts = detail.samples.filter(
    (sample) =>
      sample.scenario_index === scenarioIndex && sample.target_model === target,
  );
  // Le principal fait foi pour l'échelle de cette fenêtre — même repli que
  // `JudgeBlock` quand `detail.judges` n'est pas encore fourni.
  const rubric = principalJudge(detail.judges)?.judge.rubric ?? detail.run.config.rubric;

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
          <button
            onClick={onClose}
            className="text-sm underline hover:text-zinc-900"
          >
            close
          </button>
        </div>

        <div className="rounded border border-zinc-300">
          <button
            onClick={() => setShowSystem(!showSystem)}
            className="flex w-full items-center justify-between p-3 text-left text-sm font-medium hover:bg-zinc-50"
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

        {/* Ce que cette case avait réellement sous la main : un scénario peut
            n'avoir reçu aucun outil quand les autres les ont tous, et c'est
            souvent la comparaison qu'on cherche. Avec la description, sans
            laquelle on ne peut pas relire une décision d'appel. */}
        {(detail.run.config.tools ?? []).length > 0 && scenario && (
          <div className="rounded border border-zinc-300">
            <button
              onClick={() => setShowTools(!showTools)}
              className="flex w-full items-center justify-between p-3 text-left text-sm"
            >
              Tools available to this scenario —{" "}
              {toolsFor(detail.run.config, scenario).length === 0
                ? "none"
                : toolsFor(detail.run.config, scenario)
                    .map((tool) => tool.name)
                    .join(", ")}
              <span>{showTools ? "−" : "+"}</span>
            </button>
            {showTools && (
              <div className="space-y-3 border-t border-zinc-200 p-3">
                {toolsFor(detail.run.config, scenario).length === 0 ? (
                  <p className="text-xs text-zinc-600">
                    This scenario was offered no tools, while the run defines{" "}
                    {(detail.run.config.tools ?? []).length}.
                  </p>
                ) : (
                  toolsFor(detail.run.config, scenario).map((tool) => (
                    <div key={tool.name} className="space-y-1">
                      <code className="text-xs font-medium">{tool.name}</code>
                      <p className="text-xs whitespace-pre-wrap text-zinc-700">
                        {tool.description}
                      </p>
                      {tool.parameters.length > 0 && (
                        <p className="font-mono text-xs text-zinc-500">
                          {tool.parameters
                            .map(
                              (param) =>
                                `${param.name}: ${param.type}${param.required ? "" : "?"}`,
                            )
                            .join(", ")}
                        </p>
                      )}
                      <p className="text-xs text-zinc-500">
                        returns:{" "}
                        <span className="font-mono">{tool.result || "(empty)"}</span>
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {detail.run.config.adversary_prompt && (
          <div className="rounded border border-red-300 bg-zinc-950 p-3 text-zinc-100">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-medium">Adversary objective</span>
              <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-300">
                never shown to the evaluated model
              </span>
            </div>
            <pre className="whitespace-pre-wrap text-xs text-zinc-300">
              {detail.run.config.adversary_prompt}
            </pre>
          </div>
        )}

        {loading && (
          <p className="text-sm text-zinc-500">Loading the transcripts…</p>
        )}

        {attempts.map((attempt) => (
          <AttemptView
            key={attempt.id}
            attempt={attempt}
            judges={detail.judges}
            rubric={rubric}
            runTurns={detail.run.config.turns}
          />
        ))}
      </div>
    </div>
  );
}

export function AttemptView({
  attempt,
  judges,
  rubric,
  runTurns,
}: {
  attempt: EvalSample;
  /** Tous les juges vivants du run, avec leur verdict sur chaque
   *  conversation — voir `RunJudgeView`. `undefined` tant qu'aucune route ne
   *  les fournit encore (voir l'en-tête de ce fichier) : cette vue retombe
   *  alors sur l'attente par défaut pour le principal, et ne montre aucun
   *  autre juge. */
  judges: RunJudgeView[] | undefined;
  rubric: RubricLevel[];
  /** La profondeur demandée par le run, pour ne signaler que les tentatives
   *  qui s'en écartent — voir le commentaire sur `turns_done` plus bas. */
  runTurns: number;
}) {
  // Repliée par défaut : dix répétitions de dix tours feraient un mur de texte
  // où l'on ne retrouve plus la tentative qu'on cherchait.
  const [open, setOpen] = useState(false);

  const principal = principalJudge(judges);
  const principalVerdict = verdictOf(principal, attempt.id);
  const awake = judges?.find((judge) => judge.system_type === AWAKE_TYPE);
  const awakeVerdict = awake ? verdictOf(awake, attempt.id) : null;
  // Les juges non supprimés de ce run, sauf le principal (déjà affiché
  // ci-dessus) et l'éveil (traité à part, avec son propre seuil de
  // visibilité) — c'est cette liste qu'une conversation dépliée doit encore
  // montrer pour tenir « tous les juges non supprimés » de la conception.
  const others = (judges ?? []).filter(
    (judge) => judge.run_judge_id !== principal?.run_judge_id && judge !== awake,
  );

  return (
    <div className="rounded border border-zinc-300">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 p-3 text-left hover:bg-zinc-50"
      >
        <span className="text-zinc-400">{open ? "−" : "+"}</span>
        <span className="text-sm font-medium">
          Attempt {attempt.repetition + 1}
        </span>
        <ScoreBadge
          status={attempt.status}
          verdict={principalVerdict}
          rubric={rubric}
          executionError={attempt.error}
        />
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
        {attempt.turns_done !== null && attempt.turns_done !== runTurns && (
          // Un renseignement, pas une réserve : cette tentative s'est réglée
          // avant la profondeur du run, et l'y pousser plus loin n'aurait
          // rien appris — c'est même la question qu'on pose à un run de ce
          // genre. Silencieux quand la tentative est allée aussi loin que le
          // run : l'en-tête du run le dit déjà, le répéter n'apprend rien.
          <span className="text-xs text-zinc-500">
            settled at {attempt.turns_done} turn
            {attempt.turns_done > 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto text-xs text-zinc-500">
          {attempt.cost_usd !== null && attempt.cost_usd > 0 && (
            <>${attempt.cost_usd.toFixed(4)} · </>
          )}
          {attempt.messages.length} message
          {attempt.messages.length > 1 ? "s" : ""}
        </span>
      </button>

      {/* La justification du juge principal reste visible repliée : c'est
          elle qui dit si cette tentative mérite qu'on l'ouvre. */}
      {principalVerdict.justification && (
        <p className="px-3 pb-3 text-sm text-zinc-700">
          <span className="font-medium">Judge:</span> {principalVerdict.justification}
        </p>
      )}
      {principalVerdict.error && (
        <p className="px-3 pb-3 text-sm text-red-800">{principalVerdict.error}</p>
      )}

      {/* Repliée, l'éveil ne s'affiche qu'au-dessus du seuil de visibilité, et
          la panne du juge en gris : dans l'immense majorité des tentatives il
          n'y a rien à dire, et l'écrire partout noierait le seul cas qui
          compte. Dépliée, la réponse du juge se montre quelle que soit la
          note — y compris un 1, qui veut dire « aucun signe » : c'est une
          réponse que l'utilisateur a demandé à pouvoir lire, pas seulement
          celles qui alarment. En dessous du seuil d'alarme, la note reste
          lisible mais en ton neutre — c'est la bande que la revue a jugée
          trop floue pour affirmer quoi que ce soit ; l'ambre reste réservé aux
          notes qui ont fait sonner le voyant du run. */}
      {awakeVerdict?.error ? (
        <p className="px-3 pb-3 text-xs text-zinc-400">
          Eval-awareness judge failed: {awakeVerdict.error}
        </p>
      ) : typeof awakeVerdict?.score === "number" &&
        (open || awakeVerdict.score >= AWARENESS_VISIBLE) ? (
        <p
          className={
            awakeVerdict.score >= AWARENESS_ALARM
              ? "px-3 pb-3 text-sm font-medium text-amber-700"
              : "px-3 pb-3 text-sm text-zinc-600"
          }
        >
          <span className="font-semibold">
            Eval awareness {awakeVerdict.score}/10:
          </span>{" "}
          {awakeVerdict.justification}
        </p>
      ) : null}

      {/* Une conversation dépliée montre le verdict de TOUS les juges non
          supprimés — le principal et l'éveil sont déjà au-dessus, quel que
          soit l'état d'ouverture ; les juges secondaires n'apparaissent
          qu'ici, une fois dépliée, comme le reste de la conversation. */}
      {open && others.length > 0 && (
        <div className="space-y-2 border-t border-zinc-200 p-3">
          <p className="text-xs font-medium text-zinc-500">Other judges</p>
          {others.map((judge) => {
            const verdict = verdictOf(judge, attempt.id);
            return (
              <div key={judge.run_judge_id} className="space-y-0.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-zinc-500">
                    {shortModel(judge.judge.model)}
                  </span>
                  <ScoreBadge
                    status={attempt.status}
                    verdict={verdict}
                    rubric={judge.judge.rubric ?? []}
                  />
                </div>
                {verdict.justification && (
                  <p className="text-zinc-700">{verdict.justification}</p>
                )}
                {verdict.error && <p className="text-red-800">{verdict.error}</p>}
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <div className="space-y-2 border-t border-zinc-200 p-3">
          {attempt.messages.map((message, index) => (
            <MessageView key={index} message={message} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}

/** La matrice, telle qu'on la lit — et telle qu'on l'ouvre.
 *
 * Le même tableau sur la page privée et sur la page publique : cliquer un
 * titre ouvre le scénario, cliquer une case ouvre ses tentatives. Les réglages
 * de lecture (moyenne, médiane, échelle repliée) n'écrivent rien et suivent
 * donc les deux.
 *
 * `view` reste à l'appelant : la page privée en a besoin ailleurs, pour
 * exporter le tableau tel qu'il est lu. */
export function RunMatrix({
  detail,
  view,
  onViewChange,
  onOpenScenario,
  onOpenCell,
}: {
  detail: ReadDetail;
  view: MatrixView;
  onViewChange: (next: MatrixView) => void;
  onOpenScenario: (index: number) => void;
  onOpenCell: (scenario: number, target: string) => void;
}) {
  const { run, progress } = detail;
  // Le principal fait foi pour l'échelle affichée — même repli que
  // `JudgeBlock` tant que `detail.judges` n'est pas encore fourni.
  const principal = principalJudge(detail.judges);
  const rubric = principal?.judge.rubric ?? run.config.rubric;
  const targets = run.config.models.targets;
  // La liaison `awake` du run, pour le badge d'éveil des cases — même
  // recherche inline que `JudgeBlock` (voir son commentaire sur
  // `findAwakeJudge`).
  const awake = detail.judges?.find((judge) => judge.system_type === AWAKE_TYPE);
  // La matrice suit le PRINCIPAL, jamais un autre juge non supprimé — voir la
  // conception, section « L'écran », et le commentaire de tête de
  // `lib/matrix.ts`. `awake` voyage à part : c'est un juge différent sur la
  // même conversation, dont le badge d'éveil de chaque case ne dépend pas de
  // ce que le principal a tranché.
  const matrixSamples: MatrixSample[] = detail.samples.map((sample) => ({
    scenario_index: sample.scenario_index,
    target_model: sample.target_model,
    status: sample.status,
    cost_usd: sample.cost_usd,
    principal: verdictOf(principal, sample.id),
    awake: awake ? verdictOf(awake, sample.id) : undefined,
  }));
  const cells = cellsOf(
    matrixSamples,
    run.config.scenarios.length,
    rubric,
    view,
  );
  // Les bornes de la lecture en cours, pas celles de l'échelle : une échelle
  // repliée sur 0–1 laisserait sinon la couleur calée sur l'ancienne étendue, et
  // toute la matrice paraîtrait pâle.
  const { min, max } = viewBounds(rubric, view);

  const scoresOf = (scenarioIndex: number, target: string) =>
    detail.samples
      .filter(
        (sample) =>
          sample.scenario_index === scenarioIndex &&
          sample.target_model === target,
      )
      .map((sample) => verdictOf(principal, sample.id).score);

  // Décide si la légende doit expliquer le marqueur d'éveil : il est absent de
  // la quasi-totalité des runs, et une phrase qui parle d'un signe qu'on ne
  // voit nulle part sur cet écran ne ferait que dérouter.
  const anyFlagged = cells.some((row) =>
    Object.values(row).some((cell) => cell.awareness_flagged > 0),
  );

  if (cells.length === 0) return null;

  return (

    <section className="space-y-3">
      <h2 className="font-medium">Grade per scenario and model</h2>
      <ViewControls
        rubric={rubric}
        scores={detail.samples
          .map((sample) => verdictOf(principal, sample.id).score)
          .filter((score): score is number => score !== null)}
        view={view}
        onChange={onViewChange}
      />
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
            {run.config.scenarios.map((scenario, index) => (
              <tr key={index}>
                <td className="border-b border-zinc-200 p-2">
                  {/* Le titre mène à ce qui définit la ligne. Sur douze
                      scénarios qui ne varient que d'un axe, le titre seul
                      ne dit pas ce qu'on regarde. */}
                  <button
                    onClick={() => onOpenScenario(index)}
                    title="What this scenario is, and why"
                    className="cursor-pointer text-left underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900"
                  >
                    {scenario.title}
                  </button>
                  {scenario.note && (
                    <span
                      className="ml-1 text-xs text-zinc-400"
                      aria-hidden
                    >
                      ●
                    </span>
                  )}
                </td>
                {targets.map((target) => {
                  const cell = cells[index]?.[target];
                  const waiting = (cell?.pending ?? 0) > 0;
                  const nothingRan =
                    !!cell && cell.judged === 0 && cell.cancelled > 0;
                  // Même seuil que le voyant du run (AWARENESS_ALARM, via
                  // `cellsOf`) : c'est ce qui garantit que la somme de ces
                  // marqueurs, toutes cases confondues, retombe sur le
                  // chiffre que le voyant annonce.
                  const flagged = cell?.awareness_flagged ?? 0;
                  const baseTitle =
                    cell?.mean != null
                      ? `${distribution(scoresOf(index, target))} — average of ${cell.judged} of ${run.config.repetitions}` +
                        (cell.excluded > 0
                          ? ` · ${cell.excluded} not applicable`
                          : "") +
                        (cell.unjudged > 0
                          ? ` · ${cell.unjudged} not judged`
                          : "") +
                        (cell.cancelled > 0
                          ? ` · ${cell.cancelled} never ran`
                          : "") +
                        (cell.cost_usd > 0
                          ? ` · $${cell.cost_usd.toFixed(4)}`
                          : "")
                      : waiting
                        ? `${cell?.pending} still to run`
                        : nothingRan
                          ? "never ran — the run was stopped first"
                          : "nothing judged";
                  return (
                    <td key={target} className="border-b border-zinc-200 p-1">
                      <button
                        onClick={() => onOpenCell(index, target)}
                        className={`w-full rounded p-2 text-center text-sm ${cellStyle(cell, rubric)}`}
                        title={
                          flagged > 0
                            ? `${baseTitle} · ${flagged} attempt${flagged > 1 ? "s" : ""} showed signs of knowing it was a test`
                            : baseTitle
                        }
                      >
                        {cell?.mean != null ? (
                          <>
                            {formatMean(cell.mean)}
                            {cell.judged < run.config.repetitions && (
                              // La moyenne ne porte pas sur toutes les
                              // répétitions : le dire, sinon on la lit
                              // comme si elle valait autant que ses
                              // voisines.
                              <span className="ml-1 text-xs font-normal opacity-70">
                                ({cell.judged}/{run.config.repetitions})
                              </span>
                            )}
                          </>
                        ) : waiting ? (
                          "…"
                        ) : nothingRan ? (
                          "∅"
                        ) : (
                          "—"
                        )}
                        {flagged > 0 && (
                          // Discret et absent par défaut : ce signal est vide
                          // dans la quasi-totalité des cases, et une marque
                          // partout noierait le seul cas qui compte. Un fond
                          // propre plutôt qu'une simple couleur de texte, pour
                          // rester lisible quel que soit le fond de la case —
                          // du teal le plus clair à l'amber le plus foncé.
                          // Le nombre est écrit, pas seulement une présence :
                          // deux tentatives signalées sur cinq n'est pas une
                          // seule.
                          <span className="ml-1 rounded bg-white/85 px-1 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-700/50">
                            ⚠{flagged}
                          </span>
                        )}
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
        {progress.cancelled > 0 && (
          <>
            <strong>∅</strong> marks a cell that never ran — the run was
            stopped before reaching it.{" "}
          </>
        )}
        A cell showing <strong>(2/3)</strong> means its average rests on
        fewer repetitions than were run — some were not applicable, not
        judged, or never ran. Each cell is{" "}
        {/* La phrase suit la lecture en cours : « moyenne » cesse d'être
            vrai dès qu'on choisit une médiane ou un minimum. */}
        {describeView(view, rubric)}, on a {formatValue(min)}–
        {formatValue(max)} scale. The top of the scale is the dark end. A
        hatched cell means nothing could be judged — which is not the same as{" "}
        {formatValue(min)}.
        {anyFlagged && (
          <>
            {" "}A <strong>⚠</strong> followed by a number marks a cell where
            that many attempts showed signs of knowing it was a test — the
            same count, at the same threshold, as the run&apos;s eval-awareness
            indicator above.
          </>
        )}
      </p>
    </section>
  );
}

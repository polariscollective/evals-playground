"use client";

import { Fragment, use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { stringify } from "yaml";
import {
  addRunJudge,
  cancelRun,
  catchUp,
  designateRunPrincipal,
  exportUrl,
  extendRun,
  getCatalog,
  getDraft,
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
import { summariseExtension } from "@/lib/extension-summary";
import { withLiveJudges } from "@/lib/live-config";
import { amountDigits, estimateJudgeAdditionCost } from "@/lib/pricing";
import { extensionsOf } from "@/lib/run-extensions";
import type { RunExtension } from "@/lib/run-extensions";
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
import { RunTitle } from "@/components/RunTitle";
import { TagField } from "@/components/TagField";
import { RubricEditor } from "@/components/RubricEditor";
import type {
  EvalRun,
  EvalScenario,
  ExtendRequest,
  ProviderInfo,
  RubricLevel,
  RunDetail,
  Tag,
} from "@/lib/types";

/** Two decimals as long as they say something, four below the dollar — the same
 *  reference point as the run's cost line, just above. */
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

/** What an extension did, under its row of the table.
 *
 * The sentence answers "what did it do", and the raw request is just below it,
 * folded one notch further: it is what guarantees the sentence invents nothing.
 * In YAML rather than JSON because the nested scenarios and scales read there,
 * and through the `yaml` dependency rather than a home-made serialiser, which
 * would diverge the day `ExtendRequest` gained a field. */
function ExtensionDetail({
  extension,
  scenarios,
}: {
  extension: RunExtension;
  scenarios: EvalScenario[];
}) {
  const summary = summariseExtension(extension, scenarios);

  return (
    <div className="space-y-3 bg-zinc-50 px-3 py-3 text-sm">
      {summary.headlines.map((headline, index) => (
        <p key={index} className="text-zinc-800">
          {headline}
        </p>
      ))}
      {summary.lines.length > 0 && (
        <dl className="space-y-1">
          {summary.lines.map((line) => (
            <div key={line.label} className="flex gap-2">
              <dt className="w-40 shrink-0 text-xs text-zinc-500">{line.label}</dt>
              <dd className="text-zinc-800">
                {line.values.map((value, index) => (
                  <div key={index}>{value}</div>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-800">
          The request, as it was made
        </summary>
        <pre className="mt-2 overflow-x-auto rounded bg-paper p-2 text-xs text-zinc-700">
          {stringify(extension.request)}
        </pre>
      </details>
    </div>
  );
}

/** What a run has undergone since its creation: one row per extension, with its
 *  real cost deduced — see `extensionsOf`. Appears only if the run has been
 *  extended at least once; otherwise the page has nothing to say about it.
 *
 * A footnote, not a dashboard: six columns, to answer "where does this figure
 * come from" rather than to analyse it. */
function ExtensionsHistory({ run }: { run: EvalRun }) {
  const extensions = extensionsOf(run);
  // One row open at a time: two details unfolded side by side read badly, and
  // one comes here to compare a row to the rest of the table.
  const [open, setOpen] = useState<number | null>(null);
  if (extensions.length === 0) return null;

  return (
    <section id="extensions" className="space-y-2 rounded border border-zinc-300 p-3">
      <h2 className="text-sm font-medium">
        Extensions ({extensions.length})
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="pb-1 pr-3 font-normal" />
              <th className="pb-1 pr-3 font-normal">When</th>
              <th className="pb-1 pr-3 font-normal">Who</th>
              <th className="pb-1 pr-3 font-normal">Via</th>
              <th className="pb-1 pr-3 text-right font-normal">Quoted</th>
              <th className="pb-1 text-right font-normal">Actual</th>
            </tr>
          </thead>
          <tbody>
            {extensions.map((extension, index) => (
              <Fragment key={index}>
                <tr className="border-t border-zinc-200">
                  <td className="py-1 pr-1">
                    <button
                      type="button"
                      onClick={() => setOpen(open === index ? null : index)}
                      aria-expanded={open === index}
                      aria-label={`What the extension of ${formatDate(extension.at)} did`}
                      className="rounded-full px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800"
                    >
                      {open === index ? "▾" : "▸"}
                    </button>
                  </td>
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
                {open === index && (
                  <tr className="border-t border-zinc-200">
                    <td colSpan={6} className="p-0">
                      <ExtensionDetail
                        extension={extension}
                        scenarios={run.config.scenarios}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Adds one more judge to this run, on top of the principal — never a
 *  replacement. What "re-judging" has become since the multiple judges: a
 *  judge's verdict is no longer overwritten, one is added, and the old one stays
 *  to compare. Its score rows are born pending on every conversation already
 *  laid down; "Catch up", further down this page, is what fills them. */
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
  // A starting point, not a constraint: this judge may look at something
  // entirely other than the principal, and its scale need not resemble the
  // principal's. Taking the run's just avoids an empty form at the first click.
  const [criterion, setCriterion] = useState("");
  const [rubric, setRubric] = useState<RubricLevel[]>(config.rubric);
  const [model, setModel] = useState(config.models.judge);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // The catalogue, so as not to lock a judge into the run's models: one adds a
  // judge precisely to look differently, and the best model for that is not
  // necessarily one of the columns already played.
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  useEffect(() => {
    getCatalog().then(setProviders).catch(() => setProviders([]));
  }, []);

  // The favourites, plus the run's models: the latter stay offerable even if
  // they have left the favourites since, without which one could no longer add a
  // judge running on the same model as the principal. The secondary judges
  // already laid down are part of it too: each can carry its own model (absent,
  // it follows the run's, already in the set) — same reason as `chosen` in
  // `app/page.tsx` (commit 1a991da).
  //
  // Derived from the LIVING judges (`detail.judges`), never from `config.judges` —
  // the photograph of the launch: see `withLiveJudges` (`lib/live-config.ts`) and
  // its header. Without that, a judge added from this very panel whose model has
  // left the favourites since would no longer be offerable, while an unlinked
  // judge would stay there.
  const liveConfig = withLiveJudges(config, detail.judges ?? []);
  const models = [
    ...new Set([
      ...providers.flatMap((p) => p.models.filter((m) => m.favorite).map((m) => m.id)),
      ...liveConfig.models.targets,
      liveConfig.models.judge,
      ...(liveConfig.judges ?? []).map((j) => j.model).filter((m): m is string => Boolean(m)),
    ]),
  ];
  const values = rubric.map((level) => level.value);
  const ready =
    criterion.trim() !== "" &&
    rubric.length >= 2 &&
    rubric.every(
      (level) => Number.isFinite(level.value) && level.meaning.trim() !== "",
    ) &&
    new Set(values).size === values.length;

  // What catching this judge up would cost, never what adding it costs — adding
  // runs nothing, see the paragraph below. Counted on the conversations already
  // finished: they are the only ones a catch-up will really fill, see
  // `catchupCandidateCount` (`lib/catchup.ts`).
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
          <h2 className="eyebrow">Add a judge</h2>
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
          className="text-sm link-underline"
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
          className="w-full rounded border border-olive bg-paper p-3"
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
          className="block rounded border border-olive bg-paper p-2 text-sm"
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

        {/* The cost lives here, at the moment one decides to add — not only on the
            click on Catch up, at the foot of the page, which is what really calls
            the model. It is the trap this repository has already met twice: a
            quote that did not count the calls, a spend one only saw afterwards. */}
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
        className="btn-primary px-5 py-2"
      >
        {busy ? "Adding…" : `Add this judge to ${detail.samples.length} conversations`}
      </button>
    </section>
  );
}

/** Fills in this run's pending score rows — the old awareness button,
 *  generalised to any judge: a judge added afterwards, an extended run, a judge
 *  fallen over on a few cells, an interrupted run — all are covered by the same
 *  gesture.
 *
 * A button and not a panel: there is nothing to choose, the job finds what is
 * left to do on its own. */
function CatchUpButton({
  detail,
  onLaunched,
}: {
  detail: RunDetail;
  onLaunched: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Counted by the server (see `catchupMissingTotal`, `lib/runs.ts`): recounting
  // here from `detail.samples`/`detail.judges` would redo the same computation,
  // with the risk of one day diverging from the one that really decides what a
  // catch-up fills.
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
      <h2 className="eyebrow">
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
        className="rounded-full border px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
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
  // An extension proposed by an agent, opened from the drafts list. It only
  // prefills the panel: nothing is applied to the run until somebody has
  // confirmed, offered tools included.
  const [proposal, setProposal] = useState<ExtendRequest | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  // Whether the open draft belongs to whoever is looking — computed by the
  // route, never compared here: this page does not know the address of whoever
  // is looking. True by default: with no proposal open, saving always creates
  // one of one's own.
  const [proposalMine, setProposalMine] = useState(true);
  // When `?extend=` designates an extension already applied: its date, to say
  // so, rather than a panel that would suggest it is still waiting.
  const [appliedAt, setAppliedAt] = useState<string | null>(null);
  // How to read the matrix. Nothing goes out of it to the database: it is a
  // reading, not a result, and a reload brings back the ordinary reading.
  const [view, setView] = useState<MatrixView>(PLAIN_VIEW);
  // Through which judge one is looking at the matrix — `undefined` means "the
  // principal". A display choice, not a write: unlike `handleDesignatePrincipal`
  // below, nothing here touches the database, and a page reload forgets it. It
  // is `JudgeBlock` that carries the selector; `RunMatrix`, further down this
  // page, receives it so as to follow the same judge as what `JudgeBlock`
  // explains.
  const [displayedRunJudgeId, setDisplayedRunJudgeId] = useState<
    string | undefined
  >(undefined);
  const [openScenario, setOpenScenario] = useState<number | null>(null);
  const [stopping, setStopping] = useState(false);
  // Which action is waiting to be confirmed, if there is one.
  const [confirming, setConfirming] = useState<null | "stop" | "retry">(
    null,
  );
  // The outcome of a menu action, which has closed since. Separate from `error`,
  // which replaces the whole page: a stubborn clipboard must not make the matrix
  // disappear.
  const [notice, setNotice] = useState("");
  // The transcripts weigh a lot and serve only the detail window: we load them
  // only when a cell is opened, not on every refresh.
  const [transcripts, setTranscripts] = useState(false);
  const [open, setOpen] = useState<{ scenario: number; target: string } | null>(
    null,
  );
  // The public address when the run is published, `null` otherwise.
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  // The catalogue and this run's tags, for `TagField` — which no longer loads
  // them itself. `tagsLoaded` avoids showing "No tags yet." for an instant before
  // the real answer arrives.
  const [tagCatalog, setTagCatalog] = useState<Tag[]>([]);
  const [runTags, setRunTagsState] = useState<Tag[]>([]);
  const [tagsLoaded, setTagsLoaded] = useState(false);

  const loadTags = useCallback(async () => {
    try {
      const [catalog, current] = await Promise.all([getTags(), getRunTags(runId)]);
      setTagCatalog(catalog);
      setRunTagsState(current);
    } catch {
      // Left as they are rather than breaking the page: they are only pills, not
      // the matrix.
    } finally {
      setTagsLoaded(true);
    }
  }, [runId]);

  useEffect(() => {
    // Same reason as for `load` below: a timer rather than a direct call in the
    // effect's body.
    const timer = setTimeout(() => loadTags(), 0);
    return () => clearTimeout(timer);
  }, [loadTags]);

  const load = useCallback(
    async (withTranscripts: boolean) => {
      try {
        // A secondary judge shown needs its own verdicts — the light load brings
        // back only the principal's and awareness's (see `withFullJudgeScores` on
        // `getRun`/`loadRun`). Independent of `withTranscripts`: we do not want to
        // pay the conversations' weight for the sole reason of having changed the
        // judge shown.
        const loaded = await getRun(runId, {
          withTranscripts,
          withFullJudgeScores: displayedRunJudgeId !== undefined,
        });
        // Same reason as on the list: a finished run kept open must not make its
        // matrix flicker.
        setDetail((current) => keepIfUnchanged(current, loaded));
        setPublicUrl(loaded.run.is_public ? `/shared/${loaded.run.id}` : null);
        // Primed once only: the refresh of a running run must not overwrite a note
        // being written.
        setNotes((current) => (current === "" ? loaded.run.notes : current));
        setAnalysis((current) =>
          current === "" ? loaded.run.analysis : current,
        );
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [runId, displayedRunJudgeId],
  );

  // `?extend=<id>`: one comes from the drafts list with a proposal to reread.
  // The panel opens on it rather than empty — unless it has already served, in
  // which case there is no proposal left, only a trace.
  useEffect(() => {
    const draftId = searchParams.get("extend");
    if (!draftId) {
      // A timer, not a direct call: `react-hooks/set-state-in-effect` forbids a
      // synchronous setState in the effect's body.
      const timer = setTimeout(() => setAppliedAt(null), 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    getDraft(draftId)
      .then((draft) => {
        if (cancelled) return;
        if (draft.kind !== "extend") {
          setError("That draft is a run to launch, not an extension.");
          return;
        }
          // An address is shared and bookmarked: nothing guarantees this one
          // arrived through the list, where the link has already disappeared.
        if (draft.launched_at) {
            // The banner closes the panel a previous address could have opened: on
            // the same page, moving from one `?extend=` to another does not
            // remount the component, and the two must never coexist.
          setAppliedAt(draft.launched_at);
          setExtending(false);
          setProposal(null);
          setProposalId(null);
          return;
        }
        setAppliedAt(null);
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
    // Going through a timer rather than calling load() in the effect's body: the
    // latter triggers a synchronous setState, which the
    // react-hooks/set-state-in-effect rule rightly forbids.
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

  // No effect here to preload the transcripts on the catch-up button's behalf:
  // `detail.catchup_missing` arrives already computed by `loadRun`, which has the
  // transcripts to hand without ever sending them to the browser (see
  // `catchupMissingTotal` in `lib/runs.ts`). Such an effect existed, and its
  // guard missed a run with the judge off, or a single empty or failed cell —
  // once triggered, relaunching the pass put the run back to running and the
  // three-second refresh above then reloaded every transcript in a loop for the
  // whole pass, exactly what `SAMPLE_COLUMNS` exists to avoid.

  // The logs only go up at the very end of the job — hence the reread when the
  // run stops running, and not on the first render alone.
  const [inspectLogs, setInspectLogs] = useState(false);
  useEffect(() => {
    let alive = true;
    void hasInspectLogs(runId).then((present) => {
      if (alive) setInspectLogs(present);
    });
    return () => {
      alive = false;
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
    // Once only: once the transcripts are loaded, the refreshes that follow keep
    // them.
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

  // The principal's verdict, joined to each cell for the extension panel
  // (`ExtendPanelSample`, which deepens on that one — see its comment) — same
  // fallback as `RunMatrix`/`JudgeBlock` when `detail.judges` is not yet
  // supplied.
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
          <h1 className="text-2xl tracking-tight">
            <RunTitle
              runId={run.id}
              label={run.label}
              fallback="Evaluation run"
                // Here the title is only an `<h1>`: clicking it may open it. In
                // the list it is a link to this run, and stealing its click would
                // make the list unusable.
              editOnClick
                // The field takes the title's shape — serif, same size, full
                // width — so that nothing jumps at the moment it opens.
              inputClassName="w-full border border-zinc-300 bg-transparent px-2 py-0.5 text-2xl tracking-tight"
                // Written into the state already loaded rather than rereading
                // everything: the response carries the saved title, and reloading
                // the whole run for one word would make the matrix flicker below.
              onSaved={(next) =>
                setDetail((current) =>
                  current ? { ...current, run: { ...current.run, label: next } } : current,
                )
              }
            >
              {run.label ?? "Evaluation run"}
            </RunTitle>
          </h1>
          <p className="text-sm text-zinc-600">
            <CopyId value={run.id} />, {run.config.scenarios.length} scenario
            {run.config.scenarios.length > 1 ? "s" : ""},{" "}
            {run.config.models.targets.length} model
            {run.config.models.targets.length > 1 ? "s" : ""}, {run.config.repetitions} repetition
            {run.config.repetitions > 1 ? "s" : ""}, {run.config.turns} turn
            {run.config.turns > 1 ? "s" : ""}
            {run.cost_usd !== null && (
              <>
                {", "}
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
                    // The gap to the quote, beside the price: it is by seeing it
                    // run after run that one will know whether the estimate drifts,
                    // and on which models.
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
            {/* On its own line rather than at the end of the previous one: drowned
                between the cost and the quote, the address did not read. */}
          {run.user_email && (
            <p className="text-sm text-zinc-500">{run.user_email}</p>
          )}
        </div>
        <div className="flex shrink-0 items-start justify-end gap-2">
            {/* Stopping stays outside: it is the one action one looks for in a
                hurry, and it only appears while a run is going — so never at the
                same time as those in the menu. */}
          {running && (
            <button
              onClick={() => setConfirming("stop")}
              disabled={stopping}
                title="The job reads the request before each cell. The one under way will run to its end."
              className="cursor-pointer rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
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

      {/* Where it comes from, when it comes from a draft. The link reopens the
          form on it: that is where one starts again from the same configuration.
          The identifier may designate nothing any more — a draft discarded by
          hand disappears, and the run's provenance deliberately survives it. */}
      {run.draft_id && (
        <p className="text-sm text-zinc-500">
          Launched from{" "}
          <Link href={`/?draft=${run.draft_id}`} className="link-underline">
            the draft it came from
          </Link>
          .
        </p>
      )}

      {publicUrl && (
        <p className="flex items-center gap-1 text-sm text-zinc-500">
          Published — anyone with this link can read it:{" "}
          <code className="rounded bg-zinc-100 px-1">{publicUrl}</code>
          {/* The copied link is absolute: whoever receives it has none of this
              window's context, and a relative address would tell them nothing.
              `window.location.origin` is read only on click — never during
              render, where it does not exist server-side. */}
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
          {/* `triggered` and `running` do not mean the same thing, and confusing
              them makes a job that has not started yet pass for "running". A cold
              start on Cloud Run takes a minute: without that distinction, one
              believes it is stuck. */}
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
                {/* The cells that have not started are what is left to pay for:
                    it is the figure one looks for when hesitating to stop. */}
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
          {progress.cancelled > 0 && `, ${progress.cancelled} never ran (∅)`}
          {progress.errored > 0 && `, ${progress.errored} failed`}. A cell
          already in flight when you stopped was let finish — what was paid for
          is kept. Extend to finish what was left, or Duplicate to start over.
        </p>
      )}

      {notice && (
        <p className="rounded border border-zinc-300 p-2 text-sm text-zinc-700">
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
        {/* The three outcomes are not symmetrical, and that is the source of the
            hesitation: what is in flight is already paid for, what has not started
            will cost nothing, what is graded stays. */}
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

      {/* The banner and the panel are mutually exclusive by construction here:
          opening the panel from the menu does not clear `appliedAt`, so it is this
          render, rather than the gesture that opens it, that must stop the two
          coexisting. */}
      {appliedAt && !extending && (
        <div className="rounded border border-zinc-300 p-3 text-sm text-zinc-700">
          This extension was applied on {formatDate(appliedAt)}.{" "}
          <a href="#extensions" className="link-underline">
            See what it did
          </a>
          .
        </div>
      )}

      {extending && !running && (
        <ExtendPanel
          run={run}
          // The living judges, never `run.config.judges`: see the comment on
          // `liveJudges` on `ExtendPanel`.
          liveJudges={detail.judges ?? []}
          repetitionRange={repetitionRange(detail.samples)}
          samples={extendPanelSamples}
          proposal={proposal}
          draftId={proposalId}
          draftMine={proposalMine}
          onCancel={() => {
            setExtending(false);
              // The draft's identifier now goes to the server as `?draft=`:
              // leaving it here would attribute an extension composed by hand
              // afterwards to somebody else's draft.
            setProposal(null);
            setProposalId(null);
            setProposalMine(true);
          }}
          onSubmit={async (request) => {
              // The draft goes with the request: it is the route that refuses a
              // draft already applied and that marks it launched, in the very
              // request that extends. Doing it here afterwards, while swallowing
              // the error, left a launched draft believing itself still waiting.
            await extendRun(run.id, request, proposalId);
            setExtending(false);
            setProposal(null);
            setProposalId(null);
            await load(transcripts);
          }}
          onSaveDraft={async (request) => {
              // In place for its author; apart for anyone else, who receives their
              // own draft without touching the original — the same rule as the run
              // composition form. `updateDraft` serves both kinds of draft, this
              // one included: the route reads the kind from what it has in the
              // database.
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
              // The address in the bar follows: saving again updates this one
              // instead of creating a second.
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

      {/* Before the judge: what has been written about this run reads first, and
          the judge's scale after — the analysis, for its part, stays at the
          bottom, because it is written once the matrix has been read. */}
      <NotesField
        // The key forces a remount when the run changes: without it, the
        // component's local state would survive navigation from one run to
        // another. Distinct from the Run analysis field's, further down — two
        // instances of the same component, at the same depth, cannot share a key
        // without React confusing their local state.
        key={`${run.id}-notes`}
        value={notes}
        onChange={setNotes}
        rows={8}
        onSave={async (next) => {
          await saveNotes(run.id, next);
        }}
      />

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
        key={`${run.id}-analysis`}
        label="Run analysis"
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

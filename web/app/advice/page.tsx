"use client";

// The four advice documents: writing a scenario, putting a batch together,
// reading the results, writing a judge.
//
// The tab is not a library of scenarios — those still live in the run that uses
// them. It is the place where the knowledge of how to run an evaluation here
// lives, and it is the same page that serves to read it, to copy it into an
// agent, and to rewrite it.
//
// It was called `/scenarios` while there was one document and it was about
// scenarios. The old address still resolves — see the redirects in
// `next.config.ts`, and why a public link is not broken lightly.
//
// The text shown is the one the MCP tool will serve: a page showing something
// other than what leaves would be a silent lie, the same one the judge prompt's
// preview already avoids.
//
// On reading, that text is rendered as the markdown it is — it is a document one
// reads, not a payload one inspects. The promise above holds all the same:
// "Copy" copies the source, "Edit" shows it, and nothing between the two
// rewrites a character. Only the layout changes, never what leaves.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CopyButton, CopyIcon } from "@/components/CopyButton";
import { Loading, Refreshing } from "@/components/Loading";
import { updateAdvice } from "@/lib/api";
import { putProfile, refreshProfile, useProfile } from "@/lib/profile-store";
import { renderMarkdown } from "@/lib/markdown";
import { AdviceTabs } from "@/components/AdviceTabs";
import {
  ADVICE_LABEL,
  DEFAULT_ADVICE,
  adviceFor,
  isAdviceTopic,
  overridesOf,
  type AdviceTopic,
} from "@/lib/advice";

/** The page's heading, on both sides of the Suspense boundary.
 *
 * `useSearchParams` forces client rendering of everything under that boundary,
 * and the whole page is under it. Without this the fallback would replace the
 * page with one word, and the heading would vanish and come back. It waits on
 * nothing. Same shape as `/`, for the same reason. */
function AdviceHeader() {
  return (
    <header className="flex items-center gap-2">
      <h1 className="font-serif text-2xl font-normal">Advice</h1>
    </header>
  );
}

export default function AdvicePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-6xl space-y-4 p-8">
          <AdviceHeader />
          <p className="text-sm text-zinc-500">Loading…</p>
        </main>
      }
    >
      <AdviceDocuments />
    </Suspense>
  );
}

function AdviceDocuments() {
  // The profile comes from the shared cache: "Evaluate" preloaded it, and the
  // "Profile" page reads the same resource. So we show what we already had, and
  // the re-check happens behind.
  const { data: profileData, loading, error: loadError } = useProfile();
  // Which document we are looking at. A piece of state and not an address: the
  // page is a client, the profile is already cached, and switching tabs should
  // reload nothing.
  //
  // `?topic=` decides which one OPENS, and is then let go of. It is what the
  // shared page carries across a sign-in — somebody reading the judge document
  // without a session, who logs in from it, comes back to the judge document
  // rather than to the first tab.
  const asked = useSearchParams().get("topic");
  const [topic, setTopic] = useState<AdviceTopic>(
    isAdviceTopic(asked) ? asked : "scenario",
  );
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // On every arrival: we check again. If the cache already carries the profile,
  // the page is already written on the first render and this request keeps nobody
  // waiting — which is the whole point of the cache.
  useEffect(() => {
    void refreshProfile();
  }, []);

  // Derived from the cache on every render, never copied into a local state. A
  // copy would have demanded an effect to keep it up to date, hence one more
  // render per response — and two sources of truth to hold in agreement.
  //
  // `loaded` matters: as long as the profile has not come back, a null
  // `scenario_advice` means nothing, and the page must above all not believe
  // itself without an override before having read what the profile really
  // carries.
  const loaded = profileData !== null;
  const overrides = profileData ? overridesOf(profileData.profile) : {};
  const saved = overrides[topic] ?? null;
  const shown = adviceFor(topic, overrides);
  const custom = saved !== null && saved.trim() !== "";

  /** What "Save" must send: `null` — the "restore the default" gesture — as soon
   *  as the entry is empty, or trimmed equal to the default. Both cases mean the
   *  same thing; telling them apart would let a copy be written in place of the
   *  `null` that lets the default improve under this profile without anyone
   *  having wanted it.
   *
   *  The comparison trims both sides — a copy-paste adding a space or a trailing
   *  newline must not manufacture an override — but does not touch the internal
   *  whitespace: somebody who really edited the text keeps their version as it
   *  stands, even if it differs only by an indentation. */
  function normalizedDraft(): string | null {
    if (draft.trim() === "" || draft.trim() === DEFAULT_ADVICE[topic].trim()) {
      return null;
    }
    return draft;
  }

  // `value` carries either the override to write, or `null` to restore the
  // default — never accompanied by a cap: the route now refuses with a 422 a
  // request that would carry both at once.
  function write(value: string | null) {
    setBusy(true);
    setSaveError(null);
    updateAdvice(topic, value)
      .then(({ profile }) => {
        setDraft(adviceFor(topic, overridesOf(profile)));
        setEditing(false);
          // The cache carries the old profile: without this, "Profile" would
          // still show the previous version at the next click.
        if (profileData) putProfile({ ...profileData, profile });
      })
      .catch((e) => setSaveError((e as Error).message))
      .finally(() => setBusy(false));
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-8">
      <header className="flex items-center gap-2">
        <h1 className="font-serif text-2xl font-normal">Advice</h1>
        {loading && loaded && <Refreshing />}
      </header>

      {/* Four documents read at four moments. Switching tabs abandons an edit in
          progress rather than dragging it onto another document, where it would
          save over the wrong text — nothing else moves, every document being a
          constant of this bundle. */}
      <AdviceTabs
        topic={topic}
        onSelect={(entry) => {
          setTopic(entry);
          setEditing(false);
          setSaveError(null);
        }}
        disabled={busy}
      />

      {loadError && <p className="text-sm text-red-700">{loadError}</p>}

        {/* Holds the document's place while it is not there, at the same edge as
            it — without which the page jumps at the moment it arrives. */}
      {!loaded && loadError === null && <Loading label="Loading the advice" />}

      {loaded && (
        <>
          <p className="text-sm text-zinc-600">
            This is the exact text the <code>read_advice</code> MCP tool serves for{" "}
            <code>{topic}</code>. Paste it into an agent that only has HTTP, or let
            one that holds the tools fetch it itself. Edit it and the tool serves
            your version.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <CopyButton
                // While editing, what one copies must be what one is looking at in
                // the input — the draft, not the version still saved below.
              value={editing ? draft : shown}
              title={`Copy: ${ADVICE_LABEL[topic]}`}
              className="rounded border px-3 py-1 text-sm hover:bg-zinc-100"
            >
              {(copied) => (copied ? "Copied" : "Copy")}
            </CopyButton>
            {!editing && (
              <button
                onClick={() => {
                  setDraft(shown);
                  setEditing(true);
                }}
                disabled={busy}
                className="rounded border px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
              >
                Edit
              </button>
            )}
            {custom && !editing && (
              <button
                onClick={() => write(null)}
                disabled={busy}
                className="rounded border px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
              >
                Back to default
              </button>
            )}
            {custom && (
              <span className="text-xs text-zinc-500">Edited — the default is no longer shown.</span>
            )}
          </div>

          {/* The link one hands to somebody with no account here. It always
              serves the default: say so plainly when this profile carries an
              override, or you believe you are sharing your own version and
              share something else. The copied link is absolute — whoever
              receives it has none of this window's context — and
              `window.location.origin` is read only on click, never during
              render, where it does not exist server-side. */}
          <p className="flex flex-wrap items-center gap-1 text-sm text-zinc-500">
            {custom
              ? "Public link — anyone can read it, but it serves the default, not your edit:"
              : "Public link — anyone can read this, no account needed:"}{" "}
            <code className="rounded bg-zinc-100 px-1">
              {topic === "scenario"
                ? "/shared/advice"
                : `/shared/advice?topic=${topic}`}
            </code>
            <CopyButton
              value={() =>
                `${window.location.origin}/shared/advice` +
                (topic === "scenario" ? "" : `?topic=${topic}`)
              }
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

          {saveError && <p className="text-sm text-red-700">{saveError}</p>}

          {/* Both modes take the page's full width, like everything above them.
              A cap here misaligned them from the heading and the introductory
              paragraph, which showed more than the long line it avoided. */}
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={30}
                className="max-h-[calc(100vh-26rem)] w-full rounded border border-zinc-300 p-3 font-mono text-xs"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => write(normalizedDraft())}
                  disabled={busy}
                  className="rounded border px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setDraft(shown);
                    setEditing(false);
                    setSaveError(null);
                  }}
                  disabled={busy}
                  className="rounded border px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              // Scrolls inside its own frame, so the tab strip stays put while
              // a long document moves under it.
              className="notes-prose max-h-[calc(100vh-26rem)] w-full overflow-y-auto rounded border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700"
              // Safe: `renderMarkdown` escapes all the input HTML before producing
              // the only tags it builds itself.
              // `reflow`: this document is stored wrapped at 78 columns, and those
              // breaks are a writing convenience, not an intention. Without it the
              // text kept its breaks in the middle of a wide frame, and a wrapped
              // bullet had its continuation start again as a paragraph at the
              // margin. The run notes, for their part, keep their hard breaks.
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(shown, { reflow: true }),
              }}
            />
          )}
        </>
      )}
    </main>
  );
}

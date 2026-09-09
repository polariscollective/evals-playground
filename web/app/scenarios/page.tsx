"use client";

// What one needs to know to write a scenario a model will not recognise as a
// test.
//
// The tab is not a library of scenarios — those still live in the run that uses
// them. It is the place where the knowledge of how to write one lives, and it is
// the same page that serves to read it, to copy it into an agent, and to rewrite
// it.
//
// The text shown is the one the MCP tool will serve: a page showing something
// other than what leaves would be a silent lie, the same one the judge prompt's
// preview already avoids.
//
// On reading, that text is rendered as the markdown it is — it is a document one
// reads, not a payload one inspects. The promise above holds all the same:
// "Copy" copies the source, "Edit" shows it, and nothing between the two
// rewrites a character. Only the layout changes, never what leaves.
import { useEffect, useState } from "react";
import { CopyButton, CopyIcon } from "@/components/CopyButton";
import { Loading, Refreshing } from "@/components/Loading";
import { updateAdvice } from "@/lib/api";
import { putProfile, refreshProfile, useProfile } from "@/lib/profile-store";
import { renderMarkdown } from "@/lib/markdown";
import {
  ADVICE_SUMMARY,
  ADVICE_TOPICS,
  DEFAULT_ADVICE,
  adviceFor,
  overridesOf,
  type AdviceTopic,
} from "@/lib/advice";

const LABEL: Record<AdviceTopic, string> = {
  scenario: "Writing a scenario",
  batch: "Putting a batch together",
  analysis: "Reading the results",
  judge: "Writing a judge",
};

export default function ScenariosPage() {
  // The profile comes from the shared cache: "Evaluate" preloaded it, and the
  // "Profile" page reads the same resource. So we show what we already had, and
  // the re-check happens behind.
  const { data: profileData, loading, error: loadError } = useProfile();
  // Quel document on regarde. Un état et non une adresse : la page est un
  // client, le profil est déjà en cache, et changer d'onglet ne doit rien
  // recharger.
  const [topic, setTopic] = useState<AdviceTopic>("scenario");
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
      <header className="space-y-1">
        <h1 className="font-serif text-2xl font-normal">Guidelines</h1>
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          {ADVICE_SUMMARY[topic]}
          {loading && loaded && <Refreshing />}
        </p>
      </header>

      {/* Quatre documents lus à quatre moments. Changer d'onglet abandonne une
          édition en cours plutôt que de la traîner sur un autre document, où
          elle s'écrirait par-dessus le mauvais texte. */}
      <nav className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2">
        {ADVICE_TOPICS.map((entry) => (
          <button
            key={entry}
            onClick={() => {
              setTopic(entry);
              setEditing(false);
              setSaveError(null);
            }}
            disabled={busy}
            className={`cursor-pointer rounded px-3 py-1 text-sm disabled:opacity-50 ${
              entry === topic
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {LABEL[entry]}
          </button>
        ))}
      </nav>

      {loadError && <p className="text-sm text-red-700">{loadError}</p>}

        {/* Holds the document's place while it is not there, at the same edge as
            it — without which the page jumps at the moment it arrives. */}
      {!loaded && loadError === null && <Loading label="Loading scenario advice" />}

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
              title={`Copy: ${LABEL[topic]}`}
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
                ? "/shared/scenarios"
                : `/shared/scenarios?topic=${topic}`}
            </code>
            <CopyButton
              value={() =>
                `${window.location.origin}/shared/scenarios` +
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
                className="w-full rounded border border-zinc-300 p-3 font-mono text-xs"
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
              className="notes-prose w-full rounded border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700"
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

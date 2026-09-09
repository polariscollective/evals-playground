"use client";

// The four tabs, and the sentence saying what the one in front is for.
//
// Written once and used by both doors — `/advice`, where a signed-in person
// rewrites these documents, and `/shared/advice`, where anyone reads them. Two
// strips would have drifted, and the labels are the only place a reader learns
// that four documents exist at all.
//
// The summary sits BELOW the strip and not above it: it describes the document
// selected, so it has to come after the thing that selects it. Above, it read
// as a subtitle of the page and said something false as soon as a tab moved.
import { ADVICE_SUMMARY, ADVICE_TOPICS, ADVICE_LABEL, type AdviceTopic } from "@/lib/advice";

export function AdviceTabs({
  topic,
  onSelect,
  disabled = false,
}: {
  topic: AdviceTopic;
  onSelect: (topic: AdviceTopic) => void;
  /** True while a save is in flight: moving away then would lose the answer. */
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <nav className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2">
        {ADVICE_TOPICS.map((entry) => (
          <button
            key={entry}
            onClick={() => onSelect(entry)}
            disabled={disabled}
            aria-current={entry === topic ? "page" : undefined}
            className={`cursor-pointer rounded px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
              entry === topic
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {ADVICE_LABEL[entry]}
          </button>
        ))}
      </nav>
      <p className="text-sm text-zinc-500">{ADVICE_SUMMARY[topic]}</p>
    </div>
  );
}

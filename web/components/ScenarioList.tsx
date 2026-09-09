"use client";

// The scenarios one has just imported, as they stand.
//
// Without this list, one launches a forty-row run having seen three words of its
// content — a count and the first three titles. Yet an import goes wrong
// silently: a shifted column produces forty perfectly valid and completely wrong
// scenarios, and no validation can see it. An eye can, in a second, if it is
// shown the rows.
//
// Read-only, and it knows nothing but its scenarios: neither the CSV they come
// from, nor the columns chosen, nor anything to write with. That ignorance is
// the design — it forbids it changing anything at all today, and leaves it
// reusable as it stands the day editing arrives.
import { useState } from "react";
import { scenarioBadges } from "@/lib/scenario-summary";
import type { EvalScenario } from "@/lib/types";

/** A text and its label, cut short while the entry is folded.
 *
 * `SYS` and `MSG` carry the whole weight of the check: aligned over forty rows, a
 * column shift leaps to the eye — an opening message starting with "You are an
 * assistant" is not missed. */
function Field({
  label,
  text,
  open,
}: {
  label: string;
  text: string;
  open: boolean;
}) {
  // `span`s and not `div`s: this block lives inside a `<button>`, whose content
  // can only be phrasing content. The `flex` classes give them a block's layout
  // without being one.
  return (
    <span className="flex gap-2">
      <span className="mt-px shrink-0 font-mono text-[10px] tracking-wider text-zinc-400">
        {label}
      </span>
      <span
        className={`min-w-0 font-mono text-xs text-zinc-600 ${
          open ? "whitespace-pre-wrap" : "line-clamp-2"
        }`}
      >
        {text || <em className="text-amber-700 not-italic">— empty</em>}
      </span>
    </span>
  );
}

function Scenario({
  scenario,
  position,
}: {
  scenario: EvalScenario;
  position: number;
}) {
  const [open, setOpen] = useState(false);
  const badges = scenarioBadges(scenario);
  const history = scenario.history ?? [];

  return (
    <li className="border-b border-zinc-200 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer gap-2 p-2 text-left hover:bg-zinc-100"
      >
        <span className="w-6 shrink-0 text-right font-mono text-xs text-zinc-400">
          {position}
        </span>
        <span className="min-w-0 grow space-y-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-medium">
              {scenario.title || (
                <em className="text-amber-700 not-italic">— untitled</em>
              )}
            </span>
            {badges.map((badge) => (
              <span
                key={badge}
                className="rounded bg-zinc-200 px-1.5 py-px text-[10px] text-zinc-600"
              >
                {badge}
              </span>
            ))}
          </span>
          <Field label="SYS" text={scenario.system_prompt} open={open} />
          <Field label="MSG" text={scenario.opening_message} open={open} />
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-zinc-200 bg-white p-2 pl-10 text-xs">
          {scenario.note?.trim() && (
            <div>
              <span className="font-medium text-zinc-500">
                Note — neither the model nor the judge sees it
              </span>
              <p className="whitespace-pre-wrap text-zinc-700">
                {scenario.note}
              </p>
            </div>
          )}
          {history.length > 0 && (
            <div>
              <span className="font-medium text-zinc-500">
                Prior history — given as already having happened
              </span>
              {history.map((turn, index) => (
                <p key={index} className="mt-1 flex gap-2">
                  <span className="shrink-0 font-mono text-[10px] tracking-wider text-zinc-400">
                    {turn.role === "user" ? "USER" : "ASST"}
                  </span>
                  <span className="whitespace-pre-wrap text-zinc-700">
                    {turn.content}
                  </span>
                </p>
              ))}
            </div>
          )}
          {/* Named, and not counted: the pill already says how many, and in front
              of a surprising cell it is "which one" that one wants to know. */}
          {scenario.tools != null && scenario.tools.length > 0 && (
            <div>
              <span className="font-medium text-zinc-500">Tools offered</span>
              <p className="font-mono text-zinc-700">
                {scenario.tools.join(", ")}
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ScenarioList({ scenarios }: { scenarios: EvalScenario[] }) {
  if (scenarios.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-sm text-zinc-700">
        {scenarios.length} scenario{scenarios.length > 1 ? "s" : ""} ready —
        click one to see it whole.
      </p>
      {/* Capped and scrolling: the list serves to understand the run one is
          composing, and must not push the launch button off the screen. */}
      <ul className="max-h-96 overflow-y-auto rounded border border-zinc-300 bg-zinc-50">
        {scenarios.map((scenario, index) => (
          <Scenario key={index} scenario={scenario} position={index + 1} />
        ))}
      </ul>
    </div>
  );
}

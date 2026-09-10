"use client";

// The confirmation of an action one cannot undo.
//
// `window.confirm` did the job, badly: a system window, with no layout, whose
// title carries the domain name and where a table of figures reads as a
// paragraph. Here the outcomes of a stop fit in a table, and that is precisely
// what one wants to read before clicking.
import type { ReactNode } from "react";
import { Dialog } from "./Dialog";

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  tone = "neutral",
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  /** `warning` for what destroys or interrupts. */
  tone?: "neutral" | "warning";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const confirmStyle =
    tone === "warning"
      ? "border border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
      : "bg-olive-deep text-paper hover:bg-chartreuse hover:text-ink";

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-full border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`cursor-pointer rounded-full px-3 py-1 text-sm disabled:opacity-50 ${confirmStyle}`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      }
    >
      {children}
    </Dialog>
  );
}

/** The detail of an action, one row per outcome.
 *
 * A table rather than a sentence: what one wants to know before stopping a run is
 * how many cells fall in each case, and a figure is hard to find in the middle of
 * a paragraph. */
export function ConfirmRows({
  rows,
}: {
  rows: { label: string; count: number; fate: string }[];
}) {
  return (
    <dl className="space-y-1">
      {rows
        .filter((row) => row.count > 0)
        .map((row) => (
          <div key={row.label} className="flex gap-2">
            <dt className="w-28 shrink-0 text-zinc-500">{row.label}</dt>
            <dd>
              <strong className="font-medium">{row.count}</strong> — {row.fate}
            </dd>
          </div>
        ))}
    </dl>
  );
}

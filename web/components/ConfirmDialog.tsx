"use client";

// La confirmation d'une action qu'on ne peut pas défaire.
//
// `window.confirm` faisait le travail, mal : une fenêtre du système, sans mise
// en forme, dont le titre porte le nom du domaine et où un tableau de chiffres
// se lit comme un paragraphe. Ici les issues d'un arrêt tiennent dans un
// tableau, et c'est précisément ce qu'on veut lire avant de cliquer.
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
  /** `warning` pour ce qui détruit ou interrompt. */
  tone?: "neutral" | "warning";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const confirmStyle =
    tone === "warning"
      ? "border border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
      : "bg-zinc-900 text-white hover:bg-zinc-700";

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`cursor-pointer rounded px-3 py-1 text-sm disabled:opacity-50 ${confirmStyle}`}
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

/** Le détail d'une action, une ligne par issue.
 *
 * Un tableau plutôt qu'une phrase : ce qu'on veut savoir avant d'arrêter un run,
 * c'est combien de cases dans chaque cas, et un chiffre se trouve mal au milieu
 * d'un paragraphe. */
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

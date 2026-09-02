"use client";

// L'historique posé d'un scénario : des tours écrits d'avance, que le modèle
// reçoit comme s'il les avait vécus.
//
// Sert à mesurer ce qu'un modèle fait *depuis* un état sans avoir à l'y amener.
// Dérouler le préambule en vrais tours coûte des appels et, surtout, n'aboutit
// pas au même endroit à chaque répétition — le modèle accepte l'étape 1 une fois
// sur trois. Poser l'historique rend le point de départ identique pour toutes
// les cases, ce sans quoi une colonne ne se compare pas à sa voisine.
import type { SeededTurn } from "@/lib/types";

/** Le rôle qu'attend le prochain tour, l'historique alternant strictement. */
function nextRole(history: SeededTurn[]): "user" | "assistant" {
  return history.length % 2 === 0 ? "user" : "assistant";
}

export function HistoryEditor({
  history,
  onChange,
}: {
  history: SeededTurn[];
  onChange: (history: SeededTurn[]) => void;
}) {
  const incomplet = history.length > 0 && history.at(-1)?.role !== "assistant";

  return (
    <div className="space-y-2">
      {history.map((turn, index) => (
        <div key={index} className="flex gap-2">
          <span
            className={`mt-1 w-20 shrink-0 rounded px-2 py-0.5 text-center text-xs ${
              turn.role === "assistant"
                ? "bg-teal-100 text-teal-900"
                : "bg-zinc-200 text-zinc-700"
            }`}
          >
            {turn.role}
          </span>
          <textarea
            value={turn.content}
            rows={2}
            aria-label={`Seeded ${turn.role} turn ${index + 1}`}
            onChange={(event) =>
              onChange(
                history.map((entry, position) =>
                  position === index
                    ? { ...entry, content: event.target.value }
                    : entry,
                ),
              )
            }
            className="w-full rounded border border-zinc-300 p-2 font-mono text-sm"
          />
          {/* Seul le dernier tour se retire : ôter celui du milieu casserait
              l'alternance, et le formulaire refuserait sans qu'on comprenne. */}
          {index === history.length - 1 && (
            <button
              onClick={() => onChange(history.slice(0, -1))}
              title="Remove this turn"
              className="mt-1 h-6 shrink-0 cursor-pointer rounded border border-zinc-300 px-2 text-xs hover:bg-zinc-50"
            >
              Remove
            </button>
          )}
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          onClick={() =>
            onChange([...history, { role: nextRole(history), content: "" }])
          }
          className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
        >
          Add a {nextRole(history)} turn
        </button>
        <span className="text-xs text-zinc-500">
          {history.length === 0
            ? "Optional. The conversation starts from nothing unless you seed it."
            : incomplet
              ? "Add the assistant's reply — the opening message is the user turn that follows."
              : `${history.length} turn${history.length > 1 ? "s" : ""} seeded, then the opening message.`}
        </span>
      </div>
    </div>
  );
}

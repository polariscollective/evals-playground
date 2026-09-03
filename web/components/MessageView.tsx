import type { Message } from "@/lib/types";

/** Un tour de conversation, avec tout ce qui dit s'il faut le croire.
 *
 * Extrait de la page privée pour servir aussi la page publique : un tour posé
 * d'avance qui s'affiche comme une réponse du modèle, ou une bulle vide qui se
 * lit comme un refus alors que le fournisseur a bloqué la génération, sont
 * deux façons de faire dire à une conversation ce qu'elle n'a pas mesuré — et
 * c'est justement ce qu'un run publié est censé permettre de vérifier. */
export function MessageView({
  message,
  index,
}: {
  message: Message;
  index: number;
}) {
  return (
    <div
      className={
        // Un tour posé se distingue à l'œil : le modèle ne l'a pas produit,
        // et le lire comme sien fausserait toute la relecture d'une case.
        message.role === "tool"
          ? "rounded border border-dashed border-amber-300 bg-amber-50 p-3"
          : message.seeded
            ? "rounded border border-dashed border-zinc-400 bg-white p-3"
            : message.role === "assistant"
              ? "rounded bg-teal-50 p-3"
              : "rounded bg-zinc-100 p-3"
      }
    >
      <div className="mb-1 text-xs font-medium text-zinc-600">
        turn {index + 1} ·{" "}
        {message.role === "tool"
          ? `tool ${message.tool_name ?? ""} returned`
          : message.role === "assistant"
            ? "evaluated model"
            : "in"}
        {message.seeded && (
          <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-zinc-700">
            given as context — not produced, not graded
          </span>
        )}
      </div>
      {/* L'appel est souvent le comportement mesuré : l'afficher tel quel,
          arguments compris, plutôt que de le résumer. */}
      {(message.tool_calls ?? []).map((call) => (
        <div key={call.id} className="mb-1 font-mono text-xs text-teal-900">
          calls {call.name}({JSON.stringify(call.arguments)})
        </div>
      ))}
      {message.content.trim() ? (
        <div className="whitespace-pre-wrap text-sm">{message.content}</div>
      ) : (
        // Une bulle vide se lit comme un modèle qui n'a rien voulu dire.
        // C'est presque toujours faux : le fournisseur a bloqué la
        // génération, ce qui n'est ni un refus ni une capitulation.
        <div className="text-sm italic text-amber-800">
          No content returned
          {message.stop_reason === "content_filter"
            ? " — blocked by the provider's content filter"
            : message.stop_reason
              ? ` — stop reason: ${message.stop_reason}`
              : ""}
        </div>
      )}
    </div>
  );
}

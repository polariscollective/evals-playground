import type { Message } from "@/lib/types";

/** A conversation turn, with everything that says whether to believe it.
 *
 * Taken out of the private page so as to serve the public page too: a turn laid
 * down in advance showing as an answer from the model, or an empty bubble
 * reading as a refusal when the provider blocked the generation, are two ways of
 * making a conversation say what it did not measure — and that is precisely what
 * a published run is meant to let one check. */
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
        // A seeded turn stands out to the eye: the model did not produce it, and
        // reading it as its own would falsify a whole cell's rereading.
        message.role === "tool"
          ? "rounded border border-dashed border-amber-300 bg-amber-50 p-3"
          : message.seeded
            ? "rounded border border-dashed border-zinc-400 bg-paper p-3"
            : message.role === "assistant"
              ? "rounded bg-teal-50 p-3"
              : "rounded bg-zinc-100 p-3"
      }
    >
      <div className="mb-1 text-xs font-medium text-zinc-600">
        turn {index + 1},{" "}
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
      {/* The call is often the measured behaviour: show it as it stands,
          arguments included, rather than summarising it. */}
      {(message.tool_calls ?? []).map((call) => (
        <div key={call.id} className="mb-1 font-mono text-xs text-teal-900">
          calls {call.name}({JSON.stringify(call.arguments)})
        </div>
      ))}
      {message.content.trim() ? (
        <div className="whitespace-pre-wrap text-sm">{message.content}</div>
      ) : (message.tool_calls ?? []).length > 0 ? (
        // A turn that only calls a tool. The call is printed above and is the
        // whole content of the turn, so saying "no content returned" underneath
        // would report an absence where there is an action.
        null
      ) : (
        // Nothing at all: no text, no call. An empty bubble reads as a model
        // that would not say anything, which is almost always false. Usually
        // the provider stopped the generation, which is neither a refusal nor a
        // capitulation.
        <div className="text-sm text-amber-800">
          No content returned
          {message.stop_reason === "content_filter"
            ? ", blocked by the provider's content filter"
            : message.stop_reason
              ? `, stop reason: ${message.stop_reason}`
              : ""}
        </div>
      )}
    </div>
  );
}

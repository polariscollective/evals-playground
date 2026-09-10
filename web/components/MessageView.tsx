import type { Message } from "@/lib/types";
import type { ToolResultRow } from "@/lib/served";
import { Collapsible } from "@/components/Collapsible";

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
  served,
}: {
  message: Message;
  index: number;
  /** What the environment answered on this turn, when the turn is a served tool
   *  call and the run's results were loaded — see `servedForTurns`
   *  (`lib/served.ts`). A fixed tool has none: nothing was produced, so nothing
   *  was checked. */
  served?: { row: ToolResultRow; several: boolean } | null;
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
      {served && <ServedNote served={served.row} several={served.several} />}
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

/** What the environment's answer above is worth.
 *
 * The run's counter says "18 did not hold up" and stops there: which
 * conversation, which call, and on what grounds were nowhere to be read, so the
 * only way to act on the figure was to reread every transcript looking for
 * something odd. This is the same fault, said where it happened.
 *
 * Silent on the ordinary case — checked, and it held — for the reason the
 * indicator is silent on a run that served nothing: a line under every tool
 * turn saying all is well is a line nobody reads, and the one that matters
 * would sit in the middle of it. */
function ServedNote({
  served,
  several,
}: {
  served: ToolResultRow;
  several: boolean;
}) {
  const reasoning = served.reasoning?.trim();
  const held = served.faithful === true;
  return (
    <div className="mb-2 space-y-1">
      {served.faithful === false && (
        <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900">
          <p className="font-medium">This answer did not hold up.</p>
          {/* The checker's own sentence, never a summary of it: it names the
              file it invented or the earlier call it contradicted, which is
              what makes the world fixable. */}
          <p className="mt-0.5">{served.fault}</p>
          <p className="mt-0.5 text-red-800">
            Checked by {served.check_model ?? "another model"}
            {(served.attempts ?? 1) > 1
              ? ", and served anyway: the environment was asked again with this reason, and the second answer was refused too"
              : ""}
            . The evaluated model saw it regardless, which is the loudest tell
            there is.
          </p>
          {several && (
            <p className="mt-0.5 text-red-800">
              This call was served more than once in the run, the world having
              moved between them. The refusal above is the one that failed.
            </p>
          )}
        </div>
      )}
      {served.faithful === null && served.check_error && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          This answer was never checked: {served.check_error}. It is not a
          verdict — we do not know whether it holds.
        </div>
      )}
      {reasoning && (
        <Collapsible
          startOpen={false}
          title={
            <span className="text-xs text-zinc-500">
              {held
                ? "Why the environment answered this"
                : "What the environment was going on"}
            </span>
          }
        >
          <p className="whitespace-pre-wrap text-xs text-zinc-600">{reasoning}</p>
        </Collapsible>
      )}
    </div>
  );
}

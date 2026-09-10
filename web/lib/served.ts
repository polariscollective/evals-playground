// The served-results indicator, and its join with awareness.
//
// One figure at run level, not a mark in every cell — the same reasoning as
// `awareness.ts`, and for the same reason: the signal is empty in nearly every
// run, and doubling the load of the main screen for a column that is always
// green would spoil what works. When the indicator sounds, you drill in.
//
// The join is what justifies building all this. A high awareness grade is
// otherwise a dead end: you know the model sensed something, you do not know
// what. Yet both ends are in hand — the transcript says which calls a
// conversation made, the awareness judge says what it obtained — and the join
// costs nothing.
//
// See docs/superpowers/specs/2026-09-07-le-monde-des-outils.md.

/** One `tool_results` row, reduced to what this module reads. */
export interface ToolResultRow {
  scenario_index: number;
  tool_name: string;
  arguments: Record<string, unknown> | null;
  /** Null while the check has not run — what remains to be done, read rather
   *  than recomputed. */
  faithful: boolean | null;
  fault: string;
  /** Why the check could not happen, or `null`. `faithful` stays null in that
   *  case — we do not know, we only know why we could not know. Cleared as
   *  soon as a check succeeds (see the migration
   *  `20260907190000_tool_results_check_error.sql`): it is the latest reason,
   *  never a verdict, and distinct from a check simply not attempted yet. */
  check_error: string | null;
  /** How many times the environment answered this call. `2` says a repair took
   *  place — the check refused the first answer, its reason went back to the
   *  server, and the server tried again.
   *
   * With `faithful === false`, this is the **fifth outcome**: served despite a
   * failed repair. It is none of the other four, and this product never melts
   * two outcomes together. */
  attempts?: number;
  /** Who checked. Makes the spec's fallback visible: when it shares `model`'s
   *  provider, the checker carries the bias of the one it is checking — better
   *  than no check, but something to be known rather than guessed. */
  check_model?: string | null;
  /** The model that served this result, for the comparison above. */
  model?: string | null;
  /** Why the environment answered that, in its own words — when the run's
   *  transcripts are loaded. Absent otherwise: it is a paragraph per served
   *  call, and the indicator above needs none of it. */
  reasoning?: string | null;
}

/** A call's arguments in comparable form.
 *
 * The keys are sorted: two identical calls written in a different order are the
 * same call, and must be brought together.
 *
 * **Does not coincide with the Python form** (`world.arguments_key`), which
 * puts a space after the colon. Of no consequence: the primary key's hash is
 * computed on the Python side only, and this function serves only to bring
 * together two objects already read here. Never use it to reconstruct
 * `arguments_hash` — it would not find it. */
export function argumentsKey(args: Record<string, unknown> | null): string {
  const source = args ?? {};
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) sorted[key] = source[key];
  return JSON.stringify(sorted);
}

/** The identity of a served call, to match a transcript against a row. */
function callKey(
  scenarioIndex: number,
  toolName: string,
  args: Record<string, unknown> | null,
): string {
  return `${scenarioIndex}\0${toolName}\0${argumentsKey(args)}`;
}

export interface ServedSummary {
  /** How many distinct results this run served. */
  total: number;
  /** How many the check judged unfaithful. */
  unfaithful: number;
  /** How many have seen no attempt at a check yet. Distinct from "faithful":
   *  the check did not pass over them, it said nothing. Distinct too from
   *  `couldNotCheck` below: there, we know we do not know yet; here, we know
   *  we tried and failed. */
  unchecked: number;
  /** How many saw an attempt fail — `check_error` carries why. `faithful`
   *  stays null for these rows too: a check that fails does not condemn, it
   *  merely leaves the row to be checked. */
  couldNotCheck: number;
  /** How many were served despite a failed repair — the fifth outcome. The
   *  check refused twice, we served anyway: we cannot serve what does not
   *  exist, we can serve what we doubt. They are a subset of `unfaithful`: the
   *  same faulty row, seen closer up. */
  repaired: number;
  /** How many were checked by a model from the same family as the server. The
   *  fallback when the other family was not answering: the checker then shares
   *  the bias of the one it is checking. */
  sameFamily: number;
  /** The reason for one of those failed attempts, or `null` if there is none.
   *  One is enough: nearly all of a checker's failures share the same cause.
   *  Not necessarily the most recent: `loadRun` orders `tool_results` by
   *  scenario then by tool, never by time. */
  lastCheckError: string | null;
}

/** The run's indicator, counted on the rows themselves.
 *
 * Five outcomes, kept apart and never melted together, as everywhere else in
 * this product: checked and faithful, checked and faulty, never attempted,
 * attempted without getting there, and — since the world that changes — served
 * despite a failed repair. The fifth is a subset of the second, and the only
 * one that is: `repaired` counts rows `unfaithful` counts too. Confusing it
 * with a sixth category would announce the same fault twice.
 *
 * `sameFamily` is not an outcome but a circumstance: it says under what
 * conditions the verdict was given, not what the verdict is worth. */
export function servedSummary(rows: ToolResultRow[]): ServedSummary {
  const failed = rows.filter(
    (row) => row.faithful === null && Boolean(row.check_error),
  );
  const family = (model: string | null | undefined) =>
    (model ?? "").split("/")[0];
  return {
    total: rows.length,
    unfaithful: rows.filter((row) => row.faithful === false).length,
    repaired: rows.filter(
      (row) => row.faithful === false && (row.attempts ?? 1) > 1,
    ).length,
    sameFamily: rows.filter(
      (row) =>
        Boolean(row.check_model) && family(row.check_model) === family(row.model),
    ).length,
    unchecked: rows.filter((row) => row.faithful === null && !row.check_error)
      .length,
    couldNotCheck: failed.length,
    lastCheckError:
      failed.length > 0 ? failed[failed.length - 1].check_error : null,
  };
}

/** One transcript turn, reduced to the calls it carries. */
interface TranscriptTurn {
  role: string;
  tool_calls?:
    | { id?: string; name: string; arguments: Record<string, unknown> }[]
    | null;
  /** On a tool turn: the call this result answers — see `servedForTurns`. */
  tool_call_id?: string | null;
}

/** The calls a conversation actually made, in comparable form.
 *
 * Read from the `assistant` turns, which carry the decision to call — never
 * from the `tool` turns, which carry only what was returned and do not have the
 * arguments. */
export function callsMade(
  scenarioIndex: number,
  transcript: TranscriptTurn[],
): Set<string> {
  const keys = new Set<string>();
  for (const turn of transcript) {
    if (turn.role !== "assistant") continue;
    for (const call of turn.tool_calls ?? []) {
      keys.add(callKey(scenarioIndex, call.name, call.arguments));
    }
  }
  return keys;
}

/** The calls the check said could not have returned that. */
export function unfaithfulCalls(rows: ToolResultRow[]): Set<string> {
  return new Set(
    rows
      .filter((row) => row.faithful === false)
      .map((row) => callKey(row.scenario_index, row.tool_name, row.arguments)),
  );
}

/** One conversation, reduced to what the join reads. */
export interface JoinedSample {
  scenario_index: number;
  transcript: TranscriptTurn[];
  /** Did the awareness judge flag this conversation?
   *  Computed by the caller with `isAwarenessFlagged`, which carries the
   *  threshold — copying it here would make it a second rule to keep in
   *  agreement. */
  awake: boolean;
}

export interface AwarenessJoin {
  /** Conversations the awareness judge flagged. */
  awake: number;
  /** How many of them saw at least one unfaithful result. */
  awakeAfterFault: number;
  /** Conversations that saw an unfaithful result without awareness sounding.
   *  Anything at all was served and nobody noticed: the run is not invalidated
   *  by it, but it is better known. */
  faultUnnoticed: number;
}

/** The join, which answers the question one really asks in front of a high
 *  awareness grade: is this model perceptive, or did we break the setting?
 *
 * Without it, the transcripts are read one by one to find out. */
export function awarenessJoin(
  samples: JoinedSample[],
  rows: ToolResultRow[],
): AwarenessJoin {
  const faulty = unfaithfulCalls(rows);
  const join: AwarenessJoin = { awake: 0, awakeAfterFault: 0, faultUnnoticed: 0 };
  if (faulty.size === 0) {
    join.awake = samples.filter((sample) => sample.awake).length;
    return join;
  }
  for (const sample of samples) {
    const seen = callsMade(sample.scenario_index, sample.transcript);
    const sawAFault = [...seen].some((key) => faulty.has(key));
    if (sample.awake) {
      join.awake += 1;
      if (sawAFault) join.awakeAfterFault += 1;
    } else if (sawAFault) {
      join.faultUnnoticed += 1;
    }
  }
  return join;
}

/** The indicator's sentence, or `null` when this run served nothing.
 *
 * Silent on a run with no served tool: it must not read a line about calls it
 * never made.
 *
 * A null `join` says the join could not be made — the transcripts are loaded
 * only on demand, and without them we do not know which conversation saw which
 * result. The sentence then stays silent on that point rather than announcing
 * zero, which would read as "none" instead of "we do not know". */
export function servedSentence(
  summary: ServedSummary,
  join: AwarenessJoin | null,
): string | null {
  if (summary.total === 0) return null;
  const parts = [
    `${summary.total} tool ${summary.total === 1 ? "result" : "results"} served`,
  ];
  if (summary.unfaithful > 0) {
    // The repair is said in the same clause as the fault rather than in a
    // sentence of its own: it is the same row, seen closer up, and announcing
    // it separately would have anyone reading quickly count it twice.
    parts.push(
      summary.repaired > 0
        ? `${summary.unfaithful} did not hold up (${summary.repaired} after a` +
          " failed repair)"
        : `${summary.unfaithful} did not hold up`,
    );
  }
  if (summary.unchecked > 0) {
    parts.push(`${summary.unchecked} not checked yet`);
  }
  if (summary.couldNotCheck > 0) {
    parts.push(
      `${summary.couldNotCheck} could not be checked (${summary.lastCheckError})`,
    );
  }
  if (summary.sameFamily > 0) {
    parts.push(`${summary.sameFamily} checked by the world model's own family`);
  }
  let sentence = parts.join(", ") + ".";
  // The join is only written when it teaches something: with no awareness and
  // no fault, there is nothing to bring together.
  if (join === null) return sentence;
  if (join.awakeAfterFault > 0) {
    sentence +=
      ` ${join.awakeAfterFault} of the ${join.awake} conversations the` +
      ` awareness judge flagged saw one of them.`;
  } else if (summary.unfaithful > 0 && join.faultUnnoticed > 0) {
    sentence +=
      ` ${join.faultUnnoticed} ${join.faultUnnoticed === 1 ? "conversation" : "conversations"}` +
      " saw one without the awareness judge noticing.";
  }
  // Where to look. The figure was a dead end for as long as nothing said which
  // call it was about: a run of twelve scenarios × five repetitions is sixty
  // transcripts to reread on the strength of a number.
  if (summary.unfaithful > 0) {
    sentence +=
      " Open a conversation: the turn that received one says so, with the" +
      " reason the check gave.";
  }
  return sentence;
}


/** The served answer behind each turn of one conversation, or `null` where a
 *  turn has none: everything that is not a tool turn, a tool that was fixed
 *  rather than served, and a call whose row this run does not hold.
 *
 * Matched by the call, never by position: a tool turn carries what came back
 * and the id of the call it answers, and the arguments live on the assistant
 * turn that made it. That is the same key the indicator counts on, so a turn
 * marked here and a fault counted above are the same fault.
 *
 * A call served more than once in a run — the world changed between two
 * identical calls, so each state has its own row — resolves to the one that did
 * not hold up if there is one. That is the row worth showing, and `several`
 * says the choice was made, so the screen can say so rather than presenting one
 * of them as the whole truth. */
export function servedForTurns(
  scenarioIndex: number,
  transcript: TranscriptTurn[],
  rows: ToolResultRow[],
): ({ row: ToolResultRow; several: boolean } | null)[] {
  const byKey = new Map<string, ToolResultRow[]>();
  for (const row of rows) {
    if (row.scenario_index !== scenarioIndex) continue;
    const key = callKey(row.scenario_index, row.tool_name, row.arguments);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }

  const keyOfCall = new Map<string, string>();
  return transcript.map((turn) => {
    for (const call of turn.tool_calls ?? []) {
      if (call.id) {
        keyOfCall.set(call.id, callKey(scenarioIndex, call.name, call.arguments));
      }
    }
    if (turn.role !== "tool" || !turn.tool_call_id) return null;
    const found = byKey.get(keyOfCall.get(turn.tool_call_id) ?? "");
    if (!found || found.length === 0) return null;
    const faulty = found.find((row) => row.faithful === false);
    return { row: faulty ?? found[0], several: found.length > 1 };
  });
}

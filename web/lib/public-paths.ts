// What does not go through the door, in one single list.
//
// The proxy cannot call this function: Next demands that `matcher` be a constant
// analysable at compile time and ignores any computed value — the proxy would
// then run on every path, `_next/static` included. The literal therefore stays
// written over there, and a test holds their agreement.

/** The open directories, anchored on `/` or the exact end. Without the anchor,
 *  a plain prefix would let a longer neighbouring path through.
 *
 * Opening a path here does not make it safe: it only removes the door. What
 * remains behind must authorise itself. `prompt`, `validate` and
 * `scenario-advice` read nothing private — a fixed text, a verdict on what the
 * caller already sends, or the default advice, never the override a profile
 * might have written: with no session we do not know who is asking, so nothing
 * that depends on who is asking can leave here. `shared`, for its part, reads
 * the database: it is `loadPublicRun` that refuses an unpublished run, with the
 * same message as an unknown run, and it is that function which is
 * authoritative — not this list. Any future entry under that prefix inherits
 * the same obligation, silently: nothing here recalls it file by file. */
export const OPEN_PREFIXES = [
  // Signing in itself, without which nobody can get in.
  "api/auth",
  // The instructions and the checker: they address an agent, which has no
  // session and would not know how to obtain one.
  "prompt",
  "validate",
  // The scenario-writing advice, always its default version — see the head
  // comment. The same audience as `prompt` and `validate`: an agent with no
  // session, to which the prompt gives this address.
  "scenario-advice",
  // A published run.
  "shared",
  // Inspect's viewer and the logs it reads. The same obligation as `shared`,
  // and it is `canReadRun` that holds it: a run in the bin or unpublished is
  // refused to a stranger, with the 404 of a run that does not exist.
  "inspect-view",
  // The MCP connector and its authorisation server: a machine with no session,
  // like prompt and validate.
  "mcp",
  ".well-known",
  "_next/static",
  "_next/image",
];

/** The open files: anchored on the end, not on a directory.
 *
 * The tab's two icons, which Next serves under these exact names out of
 * `app/` and announces both of in the `<head>`. Closing the second would make
 * the badge vanish on `/shared` — the only place someone without a session
 * looks at a page, and so the only place the omission would show. The query
 * string Next appends behind them changes nothing: the matcher reads the path
 * alone. */
export const OPEN_FILES = ["favicon.ico", "icon.svg"];

/** The dot is the only character in these paths a regular expression would
 *  read as anything other than itself. */
function escaped(path: string): string {
  return path.replace(/\./g, "\\.");
}

/** The pattern Next gives the proxy: everything, except what precedes. */
export function proxyMatcher(): string {
  const alternatives = [
    ...OPEN_PREFIXES.map((prefix) => `${escaped(prefix)}(?:/|$)`),
    ...OPEN_FILES.map((file) => `${escaped(file)}$`),
  ];
  return `/((?!${alternatives.join("|")}).*)`;
}

/** Does this path go through without a session?
 *
 * Derived from the pattern and not rewritten beside it: two formulations of the
 * same rule would end up saying different things, and it is that drift the test
 * is for. */
export function isOpen(pathname: string): boolean {
  return !new RegExp(`^${proxyMatcher()}$`).test(pathname);
}

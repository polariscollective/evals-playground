/** Keeps the previous state when the data has not moved.
 *
 * Polling returns a fresh object every time, even when the database has
 * changed nothing. Putting it into state as it stands redraws the whole page
 * every three seconds: rows flicker, a text selection jumps, and the screen
 * seems to reload endlessly.
 *
 * The comparison goes through serialisation rather than a hand-written deep
 * equality: the payloads here are a few kilobytes,
 * et une comparaison qui oublierait un champ serait pire que pas de
 * comparison at all — the screen would stop reflecting the database. */
export function keepIfUnchanged<T>(previous: T | null, next: T): T | null {
  if (previous !== null && JSON.stringify(previous) === JSON.stringify(next)) {
    return previous;
  }
  return next;
}

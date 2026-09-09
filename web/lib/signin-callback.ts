/** What the door should carry across the sign-in, or null when it adds nothing.
 *
 * `login` already falls back to "/" when no `callbackUrl` reaches it, so
 * attaching one for the home page writes the default into the address bar and
 * says nothing more — `?callbackUrl=%2F` sitting on the most-visited URL of
 * the whole flow. Every other path is worth carrying: without it, a bookmark
 * to /runs/xyz comes back to the home page having forgotten the request.
 *
 * A query string alone is enough to make the home page worth carrying:
 * "/?tab=drafts" is not the default, even though its path is. */
export function callbackFor(pathname: string, search: string): string | null {
  const wanted = `${pathname}${search}`;
  return wanted === "/" ? null : wanted;
}

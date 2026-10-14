// Every row of a read, past the database's cap on one response.
//
// PostgREST answers at most `max_rows` rows per request (1000 on the evals
// project, polaris-supabase evals/supabase/config.toml), silently: the rest of
// a longer read simply never arrives. Three judges on a 486-conversation run
// hold 1458 grades, and the third judge's cells went missing on screen. Pure,
// for `node --test`.

/** Calls `fetchPage(offset, limit)` until a page comes back short, and returns
 *  every row in order. The caller must order its read, or rows may move
 *  between pages while the table is being written. */
export async function allPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  pageSize: number,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

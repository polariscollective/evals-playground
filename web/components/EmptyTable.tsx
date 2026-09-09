/** What shows when a list holds nothing.
 *
 * A sentence and a button, nothing more. The previous version explained where
 * the drafts come from and how to submit one — a set of instructions useful
 * once, served every time a filter sets everybody aside. Yet it is almost always
 * the filter that empties the table, not the database: the only thing one wants
 * at that moment is to be able to go back.
 *
 * The same component for both lists: they empty for the same reason and are
 * recovered by the same gesture.
 */
export function EmptyTable({
  onClear,
  onDefault,
}: {
  onClear: () => void;
  onDefault: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 py-6 text-sm text-zinc-600">
      <span>Empty table with this filter.</span>
      <button
        type="button"
        onClick={onClear}
        className="rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50"
      >
        clear filters
      </button>
      <button
        type="button"
        onClick={onDefault}
        className="rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50"
      >
        default filters
      </button>
    </div>
  );
}

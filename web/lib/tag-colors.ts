// The colours a tag can take, and their classes.
//
// Tailwind does not build classes at runtime: `bg-${color}-100` is purged at
// build time and paints nothing. The mapping is therefore written out in full,
// and it is a test that recalls it.
//
// The framework allows one energy colour, one gold and one olive, and forbids
// everything the earlier palette was made of — sky, rose, violet. Six tints of
// what is left are still told apart at the size of a chip: two greens, two
// golds, a grey-olive and a dark olive.

export const TAG_COLORS = [
  "chartreuse",
  "gold",
  "olive",
  "neutral",
  "deep",
  "sand",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

const CLASSES: Record<string, string> = {
  chartreuse: "bg-teal-100 text-teal-900",
  gold: "bg-amber-100 text-amber-900",
  olive: "bg-teal-300 text-teal-950",
  neutral: "bg-zinc-200 text-zinc-900",
  deep: "bg-teal-800 text-teal-50",
  sand: "bg-amber-200 text-amber-950",

  // What the tags already in the database are called. Their names are stored,
  // not their classes, and a tag whose colour no longer exists would fall back
  // on the neutral one — a table of live tags all painted the same. Each old
  // name is sent to the new tint nearest to what it used to be. They are not
  // handed out any more: `nextColor` rotates over `TAG_COLORS` alone.
  teal: "bg-teal-100 text-teal-900",
  amber: "bg-amber-100 text-amber-900",
  sky: "bg-teal-300 text-teal-950",
  rose: "bg-teal-800 text-teal-50",
  violet: "bg-zinc-200 text-zinc-900",
  lime: "bg-amber-200 text-amber-950",
};

const NEUTRAL = "bg-zinc-200 text-zinc-900";

/** The next tag's colour: the palette rotates, asking nobody anything. A
 *  colour picker would be one more interface for a choice nobody cares about
 *  at the moment of creating a tag. */
export function nextColor(usedCount: number): TagColor {
  return TAG_COLORS[usedCount % TAG_COLORS.length];
}

/** A colour's classes. An unknown value — hand-written in the database, or
 *  come from an older palette — returns the neutral one rather than nothing: a
 *  tag with no class would be invisible.
 *
 *  `Object.hasOwn` rather than a plain lookup: `CLASSES` stays an ordinary
 *  object, and a colour equal to `"toString"` or `"constructor"`
 *  would otherwise find a method inherited from the prototype instead of
 *  falling back on the neutral one — exactly the case this comment claims to
 *  cover. */
export function colorClasses(color: string): string {
  return Object.hasOwn(CLASSES, color) ? CLASSES[color] : NEUTRAL;
}

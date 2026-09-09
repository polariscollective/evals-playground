// The colours a tag can take, and their classes.
//
// Tailwind does not build classes at runtime: `bg-${color}-100` is purged at
// build time and paints nothing. The mapping is therefore written out in full,
// and it is a test that recalls it.

export const TAG_COLORS = [
  "teal",
  "amber",
  "sky",
  "rose",
  "violet",
  "lime",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

const CLASSES: Record<TagColor, string> = {
  teal: "bg-teal-100 text-teal-900",
  amber: "bg-amber-100 text-amber-900",
  sky: "bg-sky-100 text-sky-900",
  rose: "bg-rose-100 text-rose-900",
  violet: "bg-violet-100 text-violet-900",
  lime: "bg-lime-100 text-lime-900",
};

const NEUTRAL = "bg-zinc-100 text-zinc-900";

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
  return Object.hasOwn(CLASSES, color) ? CLASSES[color as TagColor] : NEUTRAL;
}

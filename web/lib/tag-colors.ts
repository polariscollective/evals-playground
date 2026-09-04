// Les couleurs qu'un tag peut prendre, et leurs classes.
//
// Tailwind ne construit pas de classe à l'exécution : `bg-${color}-100` est
// purgé au build et ne peint rien. La correspondance est donc écrite en
// toutes lettres, et c'est un test qui le rappelle.

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

/** La couleur du prochain tag : la palette tourne, sans rien demander à
 *  personne. Un sélecteur de couleur serait une interface de plus pour un
 *  choix qui n'intéresse personne au moment de créer un tag. */
export function nextColor(usedCount: number): TagColor {
  return TAG_COLORS[usedCount % TAG_COLORS.length];
}

/** Les classes d'une couleur. Une valeur inconnue — écrite à la main en base,
 *  ou venue d'une palette plus ancienne — rend du neutre plutôt que rien : un
 *  tag sans classe serait invisible. */
export function colorClasses(color: string): string {
  return CLASSES[color as TagColor] ?? NEUTRAL;
}

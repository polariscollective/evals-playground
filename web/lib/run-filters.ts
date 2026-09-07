/** Le filtre de la liste des runs et de celle des brouillons.
 *
 * Deux sortes de filtres, parce qu'il y a deux sortes de propriétés.
 *
 * Les TAGS et les STATUTS sont des ensembles : une ligne en porte plusieurs,
 * ou aucun. On les allume et on les éteint un par un, et l'état enregistré ne
 * nomme que les éteints — un tag créé demain naîtrait invisible si la liste
 * nommait les allumés.
 *
 * Les DIMENSIONS sont binaires : un run a tourné en local ou en ligne, il est
 * publié ou non, un agent l'a lancé ou un humain. Les traiter comme des tags
 * qu'on éteint ne répondait qu'à « je ne veux pas de ça », jamais à « je ne
 * veux QUE ça » : éteindre « MCP » montrait les runs humains, mais rien ne
 * montrait les runs d'agent seuls. D'où trois états — un côté, l'autre, ou les
 * deux — et un bouton qui tourne entre eux.
 *
 * Les libellés des deux côtés sont réservés en création (voir `isReservedTag`),
 * sans quoi un vrai tag nommé « local » se confondrait avec le pseudo-tag du
 * même nom, et l'un masquerait l'autre sans que rien ne le dise.
 *
 * Les vrais tags, eux, sont globaux à la base — une ligne par libellé, sans
 * colonne utilisateur, couleur portée par le tag. Deux personnes qui écrivent
 * le même mot partagent la même ligne et la même couleur.
 */

/** Les statuts d'un run, du plus banal au plus alarmant — et non dans l'ordre
 *  du type. Un ensemble et non une dimension : il y en a cinq. */
export const STATUS_TAGS = [
  "done",
  "running",
  "triggered",
  "cancelled",
  "error",
] as const;
export type StatusTag = (typeof STATUS_TAGS)[number];

/** Comment chaque statut s'écrit à l'écran.
 *
 * La valeur en base et le mot affiché diffèrent pour deux d'entre eux —
 * `error` se lit « failed », `triggered` se lit « starting ». Le badge de la
 * ligne le savait, le bouton du filtre non : on filtrait sur « error » un
 * statut affiché « failed », et les deux se contredisaient sur le même écran.
 * Une seule table, lue des deux côtés. */
export const STATUS_LABELS: Record<string, string> = {
  triggered: "starting",
  running: "running",
  done: "done",
  error: "failed",
  cancelled: "cancelled",
};

/** Quel côté d'une dimension une ligne occupe. `a` est le côté notable :
 *  celui qui vaut un badge sur la ligne, et celui qu'on vient chercher. */
export type Side = "a" | "b";

/** Ce qu'un bouton de dimension peut valoir. `both` ne filtre rien. */
export type Choice = Side | "both";

interface Dimension {
  a: string;
  b: string;
  /** Sur quelle liste ce bouton a un sens. */
  on: "runs" | "drafts" | "both";
}

/** Les dimensions, dans l'ordre où la barre les propose.
 *
 * Un brouillon n'a ni machine ni publication : il n'a pas encore tourné, et
 * rien n'est publiable tant que rien n'existe. */
export const DIMENSIONS = {
  machine: { a: "local", b: "live", on: "runs" },
  visibility: { a: "public", b: "private", on: "runs" },
  author: { a: "mcp", b: "manual", on: "both" },
  kind: { a: "extend", b: "creation", on: "drafts" },
  launch: { a: "launched", b: "waiting", on: "drafts" },
} as const satisfies Record<string, Dimension>;

export type DimensionKey = keyof typeof DIMENSIONS;

export const DIMENSION_KEYS = Object.keys(DIMENSIONS) as DimensionKey[];

/** Les classes de chaque pseudo-libellé, écrites une fois.
 *
 * Le badge sur la ligne et le bouton de la barre lisent la même entrée : sans
 * ça, les deux représentations du même concept dérivent au premier changement
 * de palette. Comme `tag-colors.ts`, elles sont en toutes lettres — Tailwind
 * ne construit aucune classe à l'exécution. Les statuts reprennent celles du
 * badge de la colonne « Status ». */
export const PSEUDO_TAG_CLASSES: Record<string, string> = {
  triggered: "bg-zinc-100 text-zinc-700",
  running: "bg-teal-100 text-teal-900",
  done: "bg-zinc-900 text-white",
  error: "bg-red-100 text-red-800",
  cancelled: "bg-amber-100 text-amber-900",
  local: "bg-zinc-100 text-zinc-600",
  live: "bg-zinc-100 text-zinc-600",
  public: "bg-amber-100 text-amber-800",
  private: "bg-zinc-100 text-zinc-600",
  mcp: "bg-teal-100 text-teal-900",
  manual: "bg-zinc-100 text-zinc-600",
  extend: "bg-zinc-900 text-white",
  creation: "bg-zinc-100 text-zinc-700",
  launched: "bg-zinc-200 text-zinc-700",
  waiting: "bg-zinc-100 text-zinc-700",
};

/** Tout ce que la machine produit, et qu'un humain ne peut donc pas créer
 *  comme tag sous peine de collision silencieuse dans la barre. */
const RESERVED: readonly string[] = [
  ...STATUS_TAGS,
  ...(Object.keys(DIMENSIONS) as DimensionKey[]).flatMap((key) => [
    DIMENSIONS[key].a,
    DIMENSIONS[key].b,
  ]),
];

/** Insensible à la casse, comme `createTag` qui déduplique en `ilike` :
 *  réserver « local » sans réserver « Local » ne réserverait rien. */
export function isReservedTag(label: string): boolean {
  const wanted = label.trim().toLowerCase();
  return RESERVED.some((name) => name.toLowerCase() === wanted);
}

/** Ce que le filtre lit d'un run. Volontairement minuscule : la logique se
 *  teste sans fabriquer un `RunListItem` entier. */
export interface FilterableRun {
  status: string;
  origin: "local" | "cloud-run";
  is_public: boolean;
  launched_via: "ui" | "mcp";
}

export interface FilterableDraft {
  kind: "run" | "extend";
  launched_at: string | null;
  origin: "manual" | "mcp";
}

export type Sides = Partial<Record<DimensionKey, Side>>;

export function runSides(run: FilterableRun): Sides {
  return {
    machine: run.origin === "local" ? "a" : "b",
    visibility: run.is_public ? "a" : "b",
    author: run.launched_via === "mcp" ? "a" : "b",
  };
}

export function draftSides(draft: FilterableDraft): Sides {
  return {
    author: draft.origin === "mcp" ? "a" : "b",
    kind: draft.kind === "extend" ? "a" : "b",
    launch: draft.launched_at !== null ? "a" : "b",
  };
}

/** Le mot que porte une ligne sur cette dimension — celui de son badge. */
export function sideLabel(key: DimensionKey, side: Side): string {
  return side === "a" ? DIMENSIONS[key].a : DIMENSIONS[key].b;
}

/** L'état du filtre.
 *
 * `dims` ne nomme que les dimensions RÉDUITES à un côté : une absence vaut
 * « les deux ». L'état par défaut est donc presque vide, et une dimension
 * ajoutée demain naît ouverte plutôt que fermée sans que personne ne l'ait
 * voulu. `off` ne nomme que les tags et statuts éteints, pour la même raison. */
export interface FilterState {
  dims: Sides;
  off: string[];
}

export const OPEN: FilterState = { dims: {}, off: [] };

/** Deux états sont-ils le même filtre ?
 *
 * Comparé champ par champ plutôt que par sérialisation : l'ordre des clés d'un
 * objet et celui d'un tableau ne sont pas garantis, et deux filtres identiques
 * écrits dans un ordre différent se seraient dits différents — le lien serait
 * resté actif en promettant un geste sans effet. */
export function sameFilter(a: FilterState, b: FilterState): boolean {
  for (const key of DIMENSION_KEYS) {
    if (a.dims[key] !== b.dims[key]) return false;
  }
  if (a.off.length !== b.off.length) return false;
  const known = new Set(a.off);
  return b.off.every((label) => known.has(label));
}

/** Le tour d'un bouton : le côté notable, l'autre, puis les deux.
 *
 * `a` d'abord parce que c'est celui qu'on vient chercher — on clique « MCP »
 * pour voir les runs d'agent, pas pour les exclure. */
export function nextChoice(current: Choice): Choice {
  if (current === "both") return "a";
  if (current === "a") return "b";
  return "both";
}

export function choiceOf(state: FilterState, key: DimensionKey): Choice {
  return state.dims[key] ?? "both";
}

/** Réduit une dimension au côté suivant, ou la rouvre. */
export function cycleDimension(
  state: FilterState,
  key: DimensionKey,
): FilterState {
  const next = nextChoice(choiceOf(state, key));
  const dims = { ...state.dims };
  if (next === "both") delete dims[key];
  else dims[key] = next;
  return { ...state, dims };
}

/** Allume ou éteint un tag, ou un statut. */
export function toggleOff(state: FilterState, label: string): FilterState {
  const off = state.off.includes(label)
    ? state.off.filter((entry) => entry !== label)
    : [...state.off, label];
  return { ...state, off };
}

/** Une ligne passe-t-elle le filtre ?
 *
 * Chaque dimension réduite doit tomber du bon côté, ET aucun des libellés
 * d'ensemble portés ne doit être éteint. Une ligne sans aucun tag n'est jamais
 * écartée par eux — elle ne porte rien qu'on ait éteint.
 *
 * Une dimension que la ligne ne connaît pas ne la disqualifie pas : un
 * brouillon n'a pas de machine, et un état partagé entre les deux listes ne
 * doit pas les effacer l'une par l'autre. */
export function passes(
  sides: Sides,
  labels: string[],
  state: FilterState,
): boolean {
  for (const key of DIMENSION_KEYS) {
    const wanted = state.dims[key];
    if (wanted === undefined) continue;
    const side = sides[key];
    if (side !== undefined && side !== wanted) return false;
  }
  const off = new Set(state.off);
  return !labels.some((label) => off.has(label));
}

/** La ligne répond-elle à la recherche ?
 *
 * Insensible à la casse et aux accents : on tape « regression » pour trouver
 * « régression », et personne ne devrait avoir à composer un accent pour
 * retrouver son propre run. La normalisation NFD sépare les lettres de leurs
 * diacritiques, que la classe `\p{Diacritic}` retire ensuite.
 *
 * Une recherche vide laisse tout passer : c'est l'état ordinaire du champ, et
 * il ne doit rien filtrer tant qu'on n'a rien écrit.
 *
 * Cherche dans tout ce qui identifie une ligne — son nom, et son identifiant.
 * L'identifiant parce que c'est ce qu'un agent rend et ce qu'on colle depuis
 * un journal ; le chercher est même le cas le plus fréquent. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function matchesQuery(haystacks: (string | null)[], query: string): boolean {
  const needle = fold(query.trim());
  if (needle === "") return true;
  return haystacks.some(
    (text) => text !== null && fold(text).includes(needle),
  );
}

/** Ce que la barre propose pour la liste en cours.
 *
 * Une dimension n'est proposée que si elle a un sens ici ET qu'au moins une
 * ligne occupe son côté notable : offrir « publié / privé » quand rien n'est
 * publié n'encombrerait que la barre. Statuts et tags : uniquement ce qu'au
 * moins une ligne porte.
 *
 * Le tout se calcule AVANT filtrage, sans quoi réduire une dimension ferait
 * disparaître son propre bouton et il n'y aurait plus moyen de la rouvrir. */
export function offered(
  mode: "runs" | "drafts",
  rows: { sides: Sides; labels: string[] }[],
): { dims: DimensionKey[]; statuses: string[]; tags: string[] } {
  const present = new Set(rows.flatMap((row) => row.labels));
  return {
    dims: DIMENSION_KEYS.filter((key) => {
      const dim = DIMENSIONS[key];
      if (dim.on !== "both" && dim.on !== mode) return false;
      return rows.some((row) => row.sides[key] === "a");
    }),
    statuses: STATUS_TAGS.filter((name) => present.has(name)),
    tags: [...present]
      .filter((label) => !RESERVED.includes(label))
      .sort((a, b) => a.localeCompare(b)),
  };
}

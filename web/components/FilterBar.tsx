"use client";

// La barre de filtres, et la bascule entre les deux listes.
//
// Deux gestes très différents s'y côtoient, d'où deux formes de bouton.
//
// Une DIMENSION tourne : un clic passe de « les deux » au côté notable, puis à
// l'autre, puis revient. Son icône ne change jamais — c'est elle qui dit de
// quelle question il s'agit — et seul le mot change. Ouverte, elle est pâle et
// dit « both » : rien n'est filtré, et le bouton ne se donne pas l'air d'agir.
//
// Un TAG ou un STATUT s'allume et s'éteint. Éteint, il est barré : on lui a
// retiré quelque chose, ce qui ne se lit pas comme un choix entre deux.
import { DimensionIcon } from "@/components/DimensionIcon";
import { colorClasses } from "@/lib/tag-colors";
import {
  DIMENSIONS,
  PSEUDO_TAG_CLASSES,
  OPEN,
  STATUS_LABELS,
  choiceOf,
  sameFilter,
  sideLabel,
  type DimensionKey,
  type FilterState,
} from "@/lib/run-filters";
import type { Tag } from "@/lib/types";

const PILL = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs";
/** Un contour en pointillé, sans fond : l'état où le bouton ne filtre rien. */
const OPEN_PILL = `${PILL} border border-dashed border-zinc-300 text-zinc-500 hover:text-zinc-800`;

function DimensionButton({
  dimension,
  state,
  onCycle,
}: {
  dimension: DimensionKey;
  state: FilterState;
  onCycle: () => void;
}) {
  const choice = choiceOf(state, dimension);
  const { a, b } = DIMENSIONS[dimension];
  const open = choice === "both";
  const word = open ? "both" : sideLabel(dimension, choice);

  return (
    <button
      type="button"
      onClick={onCycle}
      title={
        open
          ? `Showing both — click to see only ${a}`
          : choice === "a"
            ? `Showing only ${a} — click to see only ${b}`
            : `Showing only ${b} — click to see both`
      }
      aria-label={`${a} or ${b}: currently ${word}`}
      className={open ? OPEN_PILL : `${PILL} ${PSEUDO_TAG_CLASSES[word] ?? ""}`}
    >
      <DimensionIcon dimension={dimension} />
      {word}
    </button>
  );
}

export function FilterBar({
  mode,
  onMode,
  dims,
  statuses,
  tags,
  catalog,
  state,
  onCycle,
  onToggle,
  onClear,
  onDefault,
  defaults,
  query,
  onQuery,
  hidden,
}: {
  mode: "runs" | "drafts";
  onMode: (next: "runs" | "drafts") => void;
  dims: DimensionKey[];
  statuses: string[];
  tags: string[];
  catalog: Tag[];
  state: FilterState;
  onCycle: (key: DimensionKey) => void;
  onToggle: (label: string) => void;
  /** Tout montrer. */
  onClear: () => void;
  /** Revenir aux réglages de départ. */
  onDefault: () => void;
  /** Les réglages de départ de cette liste, pour savoir si on y est déjà. */
  defaults: FilterState;
  /** La recherche en cours. Volontairement hors de l'état enregistré : un
   *  filtre est une préférence, une recherche est un geste — la retrouver
   *  telle quelle au retour serait déroutant. Elle vaut pour les deux listes,
   *  et suit donc la bascule. */
  query: string;
  onQuery: (next: string) => void;
  /** Combien de lignes le filtre écarte, pour le dire plutôt que de laisser
   *  croire que la base est vide. */
  hidden: number;
}) {
  const off = new Set(state.off);
  // Un lien qui ne changerait rien s'éteint plutôt que de promettre un geste
  // sans effet : « clear » quand rien n'est filtré, « default » quand on est
  // déjà au réglage de départ.
  const cleared = sameFilter(state, OPEN);
  const atDefault = sameFilter(state, defaults);
  const LINK = "text-xs underline";
  const LIVE = `${LINK} text-zinc-500 hover:text-zinc-900`;
  const DEAD = `${LINK} cursor-default text-zinc-300`;

  return (
    <div className="space-y-2">
      {/* La bascule remplace l'ancien bouton « Show drafts » : ce ne sont pas
          deux sections dont l'une s'ouvre, mais deux listes dont on regarde
          l'une ou l'autre. Un interrupteur le dit mieux qu'un bouton. */}
      <div className="flex items-center gap-3">
      <div className="inline-flex rounded-full border border-zinc-300 p-0.5 text-xs">
        {(["runs", "drafts"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onMode(value)}
            aria-pressed={mode === value}
            className={`rounded-full px-3 py-1 capitalize ${
              mode === value
                ? "bg-zinc-900 text-white"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      {/* Deux gestes, parce qu'ils ne donnent pas le même écran : « clear »
          ouvre tout, « default » revient à ce que la page choisit de masquer
          au premier abord — les runs d'agent, les brouillons déjà lancés. Les
          confondre ferait passer un choix pour une absence de choix.

          Toujours présents, même quand rien ne s'en écarte : leur place fait
          partie de la barre, et des liens qui apparaissent et disparaissent
          feraient bouger la bascule à côté d'eux. */}
      <button
        type="button"
        onClick={onClear}
        disabled={cleared}
        title={
          cleared
            ? "Nothing is filtered"
            : "Show everything — no dimension reduced, no tag hidden"
        }
        className={cleared ? DEAD : LIVE}
      >
        clear filters
      </button>
      <button
        type="button"
        onClick={onDefault}
        disabled={atDefault}
        title={
          atDefault
            ? "Already at the default filters"
            : "Back to what this list shows on a first visit"
        }
        className={atDefault ? DEAD : LIVE}
      >
        default filters
      </button>
      </div>

      {(dims.length > 0 || statuses.length > 0 || tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Show</span>

          {dims.map((key) => (
            <DimensionButton
              key={key}
              dimension={key}
              state={state}
              onCycle={() => onCycle(key)}
            />
          ))}

          {/* Un filet entre les dimensions et les ensembles : les deux ne se
              cliquent pas de la même façon, et rien ne le dirait sinon. */}
          {dims.length > 0 && (statuses.length > 0 || tags.length > 0) && (
            <span aria-hidden="true" className="h-4 w-px bg-zinc-300" />
          )}

          {[statuses, tags].map((groupe, index) =>
            groupe.length === 0 ? null : (
              <div key={index} className="flex flex-wrap items-center gap-2">
                {index === 1 && statuses.length > 0 && (
                  <span aria-hidden="true" className="h-4 w-px bg-zinc-300" />
                )}
                {groupe.map((label) => {
                  const on = !off.has(label);
                  const couleur =
                    PSEUDO_TAG_CLASSES[label] ??
                    colorClasses(
                      catalog.find((tag) => tag.label === label)?.color ?? "",
                    );
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => onToggle(label)}
                      aria-pressed={on}
                      title={
                        on
                          ? `Hide ${STATUS_LABELS[label] ?? label}`
                          : `Show ${STATUS_LABELS[label] ?? label}`
                      }
                      className={
                        on
                          ? `rounded-full px-2 py-0.5 text-xs ${couleur}`
                          : "rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-400 line-through hover:text-zinc-600"
                      }
                    >
                      {STATUS_LABELS[label] ?? label}
                    </button>
                  );
                })}
              </div>
            ),
          )}

          {hidden > 0 && (
            <span className="text-xs text-zinc-500">{hidden} hidden</span>
          )}
        </div>
      )}

      {/* Sous les filtres, et non à côté : ce n'est pas un filtre de plus mais
          une façon de viser une ligne dont on connaît déjà le nom ou
          l'identifiant. Elle s'applique à la liste qu'on regarde, quelle
          qu'elle soit. */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={`Search ${mode} by name or id…`}
          aria-label={`Search ${mode}`}
          className="w-80 max-w-full border border-zinc-300 px-3 py-1 text-sm"
        />
        {query !== "" && (
          <button
            type="button"
            onClick={() => onQuery("")}
            className="text-xs text-zinc-500 underline hover:text-zinc-900"
          >
            clear search
          </button>
        )}
      </div>
    </div>
  );
}

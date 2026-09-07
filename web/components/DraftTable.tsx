"use client";

// La liste des brouillons, dans la forme exacte de celle des runs.
//
// Un brouillon n'est rien d'autre qu'un run qu'on n'a pas encore lancé : le
// lire demande les mêmes repères — un nom, une date, une taille, un coût —
// et deux mises en page différentes obligeraient l'œil à réapprendre à chaque
// bascule. Mêmes colonnes, mêmes largeurs, même en-tête collant.
//
// Ce qui change tient aux quatre colonnes du milieu : la date est celle du
// dépôt et non du lancement, la forme est celle que ce brouillon PRODUIRA, le
// statut dit sa nature plutôt que son avancement, et le coût est un devis. La
// dernière colonne remplace la note moyenne — un brouillon n'a rien été noté —
// par ce qui décide vraiment : peut-il partir ?
import Link from "next/link";
import { CopyId } from "@/components/CopyButton";
import { InfoDot } from "@/components/InfoDot";
import { EmptyTable } from "@/components/EmptyTable";
import { TagField } from "@/components/TagField";
import { setDraftTags } from "@/lib/api";
import {
  draftBlocker,
  draftCost,
  draftDestination,
  draftName,
  draftShape,
} from "@/lib/draft-row";
import { PSEUDO_TAG_CLASSES } from "@/lib/run-filters";
import { DimensionIcon } from "@/components/DimensionIcon";
import type { Draft, Tag } from "@/lib/types";

/** Une fusée : ouvrir ce brouillon là où on peut le lancer — ou, s'il a déjà
 *  servi, le run qu'il a produit. Elle ne lance rien elle-même. */
function RocketIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 10c-2 .5-3 2-3.5 4 2-.5 3.5-1.5 4-3.5" />
      <path d="M9.5 12.5 6 9 3.5 6.5C6 3 9 1.5 13 1.5c0 4-1.5 7-4.5 9.5Z" />
      <circle cx="10" cy="5" r="1.2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5 5 13h6l.5-8.5" />
    </svg>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function DraftTable({
  drafts,
  draftTags,
  catalog,
  onTagsSaved,
  onDiscard,
  onClear,
  onDefault,
}: {
  drafts: Draft[] | null;
  draftTags: Record<string, Tag[]>;
  catalog: Tag[];
  onTagsSaved: () => Promise<void>;
  onDiscard: (draft: Draft) => void;
  onClear: () => void;
  onDefault: () => void;
}) {
  return (
    <div className="max-h-[70vh] overflow-y-auto">
      <table className="w-full table-fixed text-sm">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500">
            <th className="py-3 pr-8 font-medium">Draft</th>
            <th className="w-40 py-3 pr-8 font-medium">Creation</th>
            <th className="relative w-24 py-3 pr-8 font-medium">
              Shape{" "}
              <InfoDot label="What Shape means">
                scénarios × modèles × répétitions — précédé d’un « + » pour une
                extension, qui ajoute au run plutôt que d’en faire un neuf
              </InfoDot>
            </th>
            <th className="w-32 py-3 pr-8 font-medium">Status</th>
            <th className="w-24 py-3 pr-8 font-medium">Cost</th>
            <th className="relative w-24 py-3 pr-8 font-medium">
              Ready{" "}
              <InfoDot label="What Ready means">
                Un brouillon du formulaire peut être incomplet — c’est sa raison
                d’être. Une extension ne se juge pas d’ici : son devis et sa
                validité dépendent du run qu’elle agrandit.
              </InfoDot>
            </th>
            <th className="w-14 py-3" />
          </tr>
        </thead>
        <tbody>
          {/* Le squelette reste, seul le corps attend. Les colonnes sont
              connues d'avance : les remplacer par un message ferait sauter
              toute la page au moment où la réponse arrive, pour une liste dont
              la forme n'a jamais été en question. */}
          {drafts === null && (
            <tr>
              <td colSpan={7} className="py-3 text-sm text-zinc-500">
                Loading drafts…
              </td>
            </tr>
          )}
          {drafts !== null && drafts.length === 0 && (
            <tr>
              <td colSpan={7}>
                <EmptyTable onClear={onClear} onDefault={onDefault} />
              </td>
            </tr>
          )}
          {(drafts ?? []).map((draft) => {
            const blocker = draftBlocker(draft);
            const cost = draftCost(draft);
            const launched = draft.launched_at !== null;
            return (
              <tr
                key={draft.id}
                className={`border-b border-zinc-200 align-top hover:bg-zinc-50${
                  // Déjà lancé : présent, mais visiblement plus dans la file.
                  launched ? " opacity-60" : ""
                }`}
              >
                <td className="w-full py-3 pr-8">
                  <Link
                    href={draftDestination(draft)}
                    className="run-title inline-block font-medium hover:text-teal-800"
                  >
                    {draftName(draft)}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    {/* L'identifiant se copie : c'est ce qu'on colle à un agent
                        pour qu'il reprenne ce brouillon. */}
                    <CopyId value={draft.id} title="Copy draft id" />
                  </div>
                  {/* Une extension ne dit rien d'elle-même : son nom est
                      générique, et ce qui l'identifie vraiment est le run
                      qu'elle agrandit. Le lien y mène, et la recherche le
                      trouve — voir `draftHaystacks`. */}
                  {draft.kind === "extend" && (
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span>extension of</span>
                      {/* Se copie plutôt que de mener au run : la fusée y va
                          déjà, et ce qu'on veut de cet identifiant est le
                          coller — dans un agent, dans une note. Deux chemins
                          vers la même page auraient été un de trop. */}
                      <CopyId
                        value={draft.extends_run_id}
                        title="Copy the extended run's id"
                      />
                    </div>
                  )}
                  <TagField
                    compact
                    tags={draftTags[draft.id] ?? []}
                    catalog={catalog}
                    onSave={(ids) => setDraftTags(draft.id, ids)}
                    onSaved={onTagsSaved}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>{draft.created_by}</span>
                    {/* Les deux côtés se valent : savoir qu'un humain a
                        déposé ce brouillon est une information, pas une
                        absence d'information. L'icône dit la question, le mot
                        dit la réponse. */}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                        draft.origin === "mcp"
                          ? PSEUDO_TAG_CLASSES.mcp
                          : PSEUDO_TAG_CLASSES.manual
                      }`}
                      title={
                        draft.origin === "mcp"
                          ? "Soumis par un agent — validé au dépôt"
                          : "Enregistré depuis le formulaire — peut être incomplet"
                      }
                    >
                      <DimensionIcon dimension="author" />
                      {draft.origin === "mcp" ? "mcp" : "manual"}
                    </span>
                    {/* « launched » seulement : attendre est l'état ordinaire
                        d'un brouillon, et la file entière le porterait. */}
                    {launched && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${PSEUDO_TAG_CLASSES.launched}`}
                        title={`Sorti de la file le ${formatDate(draft.launched_at!)} — son adresse reste ouverte`}
                      >
                        <DimensionIcon dimension="launch" />
                        launched
                      </span>
                    )}
                  </div>
                </td>

                <td className="whitespace-nowrap py-3 pr-8 text-zinc-600">
                  {formatDate(draft.created_at)}
                </td>

                <td className="whitespace-nowrap py-3 pr-8 text-zinc-700">
                  {draftShape(draft)}
                </td>

                <td className="whitespace-nowrap py-3 pr-8">
                  <span
                    className={`inline-flex w-24 items-center justify-center gap-1 rounded px-2 py-0.5 text-xs ${
                      draft.kind === "extend"
                        ? PSEUDO_TAG_CLASSES.extend
                        : PSEUDO_TAG_CLASSES.creation
                    }`}
                    title={
                      draft.kind === "extend"
                        ? "Agrandit un run existant"
                        : "Propose un run neuf"
                    }
                  >
                    <DimensionIcon dimension="kind" />
                    {draft.kind === "extend" ? "extend" : "creation"}
                  </span>
                </td>

                <td className="whitespace-nowrap py-3 pr-8 text-zinc-700">
                  {cost === null ? (
                    <span
                      className="text-zinc-400"
                      title={
                        draft.kind === "extend"
                          ? "Le devis d’une extension dépend du run qu’elle agrandit — il se lit sur la page de ce run."
                          : "Pas chiffrable tant que la configuration est incomplète."
                      }
                    >
                      —
                    </span>
                  ) : (
                    `~$${cost.toFixed(cost < 1 ? 3 : 2)}`
                  )}
                </td>

                <td className="py-3 pr-8 text-xs">
                  {/* Une icône et non la phrase : un motif de validation un
                      peu long triplait la hauteur de sa ligne et déformait
                      tout le tableau. Le motif entier s'ouvre au clic, là où
                      il ne coûte plus rien à personne. */}
                  {blocker === undefined ? (
                    <span
                      className="text-zinc-400"
                      title="Sa validité dépend du run qu’elle agrandit."
                    >
                      —
                    </span>
                  ) : blocker === null ? (
                    <span className="text-teal-700" title="Prêt à lancer">
                      ✓
                    </span>
                  ) : (
                    <InfoDot
                      label="Why this draft cannot launch"
                      glyph="⚠"
                      tone="text-amber-700 hover:text-amber-900"
                    >
                      {blocker}
                    </InfoDot>
                  )}
                </td>

                <td className="py-3 align-middle">
                  <div className="flex items-center justify-end gap-1">
                    {/* La fusée ne lance rien : elle ouvre là où on peut lancer,
                        après avoir relu. Un brouillon vient souvent d'un agent,
                        et dépenser sur un clic de liste serait un piège. */}
                    <Link
                      href={draftDestination(draft)}
                      title={
                        launched
                          ? draft.kind === "extend"
                            ? "Voir ce que cette extension a fait"
                            : "Voir le run produit"
                          : draft.kind === "extend"
                            ? "Ouvrir le run pour appliquer cette extension"
                            : "Ouvrir le formulaire pour le relire et le lancer"
                      }
                      aria-label={
                        launched
                          ? draft.kind === "extend"
                            ? "See what this extension did"
                            : "Show the produced run"
                          : "Open to launch"
                      }
                      // Un nouvel onglet : on parcourt une file, et ouvrir un
                      // brouillon ne doit pas coûter la liste qu'on était en
                      // train de lire. `noopener` parce que `_blank` sans lui
                      // donne à la page ouverte une prise sur celle-ci.
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full p-1 text-zinc-300 hover:text-teal-700"
                    >
                      <RocketIcon />
                    </Link>
                    <button
                      type="button"
                      onClick={() => onDiscard(draft)}
                      title="Discard this draft"
                      aria-label={`Discard draft ${draftName(draft)}`}
                      className="rounded p-1 text-zinc-300 hover:bg-red-100 hover:text-red-800"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

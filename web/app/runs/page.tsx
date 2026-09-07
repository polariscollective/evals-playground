"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  discardDraft,
  publishRun,
  getDrafts,
  getMe,
  setRunTags,
  softDeleteRun,
} from "@/lib/api";
import { formatMean, formatValue, rubricBounds } from "@/lib/rubric";
import { CopyId, PublicIcon } from "@/components/CopyButton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TagField } from "@/components/TagField";
import { Refreshing } from "@/components/Loading";
import { InfoDot } from "@/components/InfoDot";
import { RunTitle } from "@/components/RunTitle";
import { DraftTable } from "@/components/DraftTable";
import {
  PSEUDO_TAG_CLASSES,
  STATUS_LABELS,
  draftSides,
  offered,
  passes,
  matchesQuery,
  runSides,
} from "@/lib/run-filters";
import type { DimensionKey } from "@/lib/run-filters";
import {
  clearFilters,
  cycleDim,
  defaultFilters,
  toggleTag,
  useFilterState,
} from "@/lib/filter-store";
import { FilterBar } from "@/components/FilterBar";
import { defaultState } from "@/lib/filter-storage";
import { EmptyTable } from "@/components/EmptyTable";
import { draftHaystacks, draftName } from "@/lib/draft-row";
import { DimensionIcon } from "@/components/DimensionIcon";
import type { FilterMode } from "@/lib/filter-storage";
import type { Draft } from "@/lib/types";
import { forgetRun, refreshRuns, useRuns } from "@/lib/runs-store";
import { refreshTags, useTags } from "@/lib/tags-store";

const STATUS_STYLE: Record<string, string> = {
  triggered: "bg-zinc-100 text-zinc-700",
  running: "bg-teal-100 text-teal-900",
  done: "bg-zinc-900 text-white",
  error: "bg-red-100 text-red-800",
  cancelled: "bg-amber-100 text-amber-900",
};

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



/** Une corbeille, discrète jusqu'au survol : le geste est rare et réversible,
 *  il n'a pas à peser dans la page. */
function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4" />
    </svg>
  );
}

/** Les brouillons en attente — ce qu'un agent a proposé, pas encore lancé.
 *
 * Ouvrir mène au formulaire d'évaluation prérempli, pas à un écran de
 * lecture : ce qu'on veut faire d'un brouillon est le relire, le corriger et
 * le lancer. Un brouillon lancé disparaît d'ici — sans quoi on ne saurait plus
 * lequel reste à faire.
 *
 * De qui que ce soit : un brouillon est une proposition faite à l'équipe. */
/** Le bouton qui rouvre la liste aux brouillons déjà lancés. Sorti du titre
 *  pour que celui-ci continue de compter ce qui attend, et non ce qui est
 *  affiché. */


export default function RunsPage() {
  // La liste vient du magasin partagé, plus d'un état local : c'est ce qui
  // fait qu'un retour sur cet onglet retrouve les lignes déjà lues au lieu de
  // repartir d'un écran vide. Voir `lib/runs-store.ts`.
  const { runs, loading, error: runsError } = useRuns();
  const [error, setError] = useState<string | null>(null);
  // Les brouillons ne se chargent qu'à la demande : la plupart du temps il n'y
  // en a aucun, et une requête de plus à chaque ouverture de la liste des runs
  // se paierait pour rien.
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  // Quelle liste on regarde. La bascule au-dessus des filtres remplace
  // l'ancien bouton « Show drafts » : ce ne sont pas deux sections dont l'une
  // s'ouvre, mais deux listes dont on regarde l'une ou l'autre. Il
  // remplace le tableau, et chaque mode a sa barre de filtres et sa
  // préférence enregistrée — voir `filter-storage.ts`.
  const mode: FilterMode = showDrafts ? "drafts" : "runs";
  const filterState = useFilterState(mode);
  const [me, setMe] = useState<string | null>(null);
  // Les tags viennent du magasin partagé, comme la liste : ils sont
  // minuscules mais coûtaient deux allers-retours à chaque visite, et les
  // pastilles arrivaient une demi-seconde après leurs lignes.
  const { catalog: tagCatalog, assignments: tagAssignments } = useTags();
  // Les miens par défaut : la base est partagée, et la liste de tout le monde
  // enterre la sienne au bout de quelques semaines. Ce qu'on cherche en
  // ouvrant cette page est presque toujours un run qu'on a lancé soi-même.
  const [mineOnly, setMineOnly] = useState(true);
  // Ce qui attend d'être confirmé : un run, un brouillon, ou rien.
  const [confirming, setConfirming] = useState<
    { kind: "run"; id: string; label: string } | { kind: "draft"; draft: Draft } | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  /** Ce qu'on cherche. Dans l'état et non dans `localStorage` : un filtre est
   *  une préférence, une recherche est un geste. Partagée par les deux listes
   *  — taper un mot puis basculer cherche le même mot de l'autre côté. */
  const [query, setQuery] = useState("");
  /** Le run qu'on s'apprête à publier, ou `null`. Séparé de `confirming` :
   *  publier et jeter n'ont ni le même dialogue ni le même ton. */
  const [confirmingPublish, setConfirmingPublish] = useState<
    { id: string; label: string; next: boolean } | null
  >(null);
  /** L'identifiant du run dont la publication est en vol, pour n'éteindre que
   *  son bouton — pas les treize autres. */
  const [publishing, setPublishing] = useState<string | null>(null);

  // À chaque arrivée sur l'onglet : on revérifie, indicateur allumé. Les
  // lignes déjà en cache restent affichées pendant ce temps — c'est tout
  // l'intérêt, on ne repart pas d'un écran vide pour retrouver la même chose.
  useEffect(() => {
    const timer = setTimeout(() => void refreshRuns(), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Sans elle, « les miens » ne veut rien dire : on retombe sur tout, ce qui
    // est le comportement d'avant plutôt qu'une liste vide.
    getMe()
      .then(({ email }) => setMe(email))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refreshTags(), 0);
    return () => clearTimeout(timer);
  }, []);

  const confirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      if (confirming.kind === "run") {
        await softDeleteRun(confirming.id);
        forgetRun(confirming.id);
      } else {
        await discardDraft(confirming.draft.id);
        setDrafts((current) =>
          (current ?? []).filter((draft) => draft.id !== confirming.draft.id),
        );
      }
      setConfirming(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  /** Publier ou dépublier, puis relire la liste. Silencieux : le bouton dit
   *  déjà qu'il travaille, et un second voyant en haut de page ne dirait rien
   *  de plus. */
  const setPublished = async (runId: string, next: boolean) => {
    setPublishing(runId);
    try {
      await publishRun(runId, next);
      await refreshRuns({ silent: true });
      setConfirmingPublish(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(null);
    }
  };

  /* Les brouillons se chargent toujours entiers, lancés compris, et c'est le
     filtre qui les écarte. L'ancien bouton « Show launched » refaisait la
     requête ; devenu un bouton de la barre, il ne peut plus : un libellé ne
     s'y affiche que si une ligne le porte, et aucune ne le porterait tant que
     la requête les exclut. Le bouton n'apparaîtrait jamais.

     Ils se comptent en dizaines : tout ramener coûte moins qu'une requête de
     plus à chaque bascule. Le chargement lui-même est dans l'effet juste
     au-dessus. */

  // Le chargement suit l'état, il ne dépend pas du geste qui l'a changé.
  // Accroché au seul gestionnaire du bouton, il ne partait pas si la page
  // s'ouvrait déjà sur les brouillons — et la liste restait sur « Loading… »
  // pour toujours.
  useEffect(() => {
    if (!showDrafts || drafts !== null) return;
    // `alive` : la réponse peut arriver après qu'on a quitté la page, et
    // écrire dans un composant démonté ne sert personne.
    let alive = true;
    getDrafts(true)
      .then((loaded) => {
        if (alive) setDrafts(loaded);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [showDrafts, drafts]);

  // Tant qu'un run tourne, la liste se rafraîchit : c'est le seul endroit d'où
  // l'on peut suivre plusieurs runs à la fois.
  useEffect(() => {
    if (!runs?.some((r) => r.run.status === "running" || r.run.status === "triggered"))
      return;
    // Silencieux : un run qui tourne fait battre cette requête toutes les
    // trois secondes, et elle ne doit rien faire clignoter.
    const timer = setInterval(() => void refreshRuns({ silent: true }), 3000);
    return () => clearInterval(timer);
  }, [runs]);

  const shownError = error ?? runsError;
  if (shownError) {
    return (
      <main className="mx-auto max-w-6xl p-8">
        <p
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-red-800"
        >
          {shownError}
        </p>
      </main>
    );
  }

  // Seulement en mode runs : sinon, arriver sur cette page et basculer aussitôt
  // sur les brouillons ferait attendre devant un écran vide une liste de runs
  // qu'on ne regarde même pas.
  if (mode === "runs" && !runs) {
    return <main className="mx-auto max-w-6xl p-8">Loading…</main>;
  }

  // Le filtre ne s'applique que si l'on sait qui regarde : sans identité, tout
  // masquer donnerait une page vide sans expliquer pourquoi.
  const mien = mineOnly && me !== null;
  // `?? []` : en mode brouillons, la liste des runs peut n'être pas encore
  // arrivée — la garde ci-dessus ne l'attend plus dans ce cas.
  const chargés = runs ?? [];
  const runsDuPerimetre = mien
    ? chargés.filter((entry) => entry.run.user_email === me)
    : chargés;
  const draftsDuPerimetre =
    drafts === null ? [] : mien ? drafts.filter((d) => d.created_by === me) : drafts;

  // Ce que chaque ligne est, et ce qu'elle porte : deux choses distinctes, et
  // deux façons de filtrer. Voir `run-filters.ts`.
  const runRows = runsDuPerimetre.map((entry) => ({
    entry,
    sides: runSides(entry.run),
    labels: [
      entry.run.status,
      ...(tagAssignments.runs[entry.run.id] ?? []).map((tag) => tag.label),
    ],
  }));
  const draftRows = draftsDuPerimetre.map((draft) => ({
    draft,
    sides: draftSides(draft),
    labels: (tagAssignments.drafts[draft.id] ?? []).map((tag) => tag.label),
  }));

  // La barre ne propose que ce que porte la liste EN COURS, et se calcule
  // avant filtrage — sinon réduire une dimension ferait disparaître son
  // propre bouton et il n'y aurait plus moyen de la rouvrir.
  const bar = offered(mode, mode === "drafts" ? draftRows : runRows);

  const runsVus = runRows
    .filter(
      (row) =>
        passes(row.sides, row.labels, filterState) &&
        matchesQuery(
          [row.entry.run.label, row.entry.run.first_scenario_title, row.entry.run.id],
          query,
        ),
    )
    .map((row) => row.entry);
  const draftsVus = draftRows
    .filter(
      (row) =>
        passes(row.sides, row.labels, filterState) &&
        matchesQuery(draftHaystacks(row.draft), query),
    )
    .map((row) => row.draft);
  const masques =
    mode === "drafts"
      ? draftRows.length - draftsVus.length
      : runRows.length - runsVus.length;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-normal tracking-tight">Runs</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-zinc-600">
            {showDrafts
              ? "Everything waiting to be launched, newest first. Open one to review it."
              : "Every evaluation run, most recent first. Open one to see its matrix."}
            {/* Ne s'allume que par-dessus une liste déjà affichée : quand il
                n'y a encore rien à lire, c'est « Loading… » qui parle, et deux
                messages diraient la même chose. */}
            {loading && runs !== null && <Refreshing />}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setMineOnly(!mineOnly)}
            disabled={me === null}
            title={
              me === null
                ? "Could not tell who you are — showing everything"
                : `Yours: ${me}`
            }
            className={`rounded border px-3 py-1.5 text-sm disabled:opacity-40 ${
              mien
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            Show mine only
          </button>
        </div>
      </header>

      <FilterBar
        mode={mode}
        onMode={(next) => setShowDrafts(next === "drafts")}
        dims={bar.dims}
        statuses={bar.statuses}
        tags={bar.tags}
        catalog={tagCatalog}
        state={filterState}
        onCycle={(key: DimensionKey) => cycleDim(mode, key)}
        onToggle={(label: string) => toggleTag(mode, label)}
        onClear={() => clearFilters(mode)}
        onDefault={() => defaultFilters(mode)}
        defaults={defaultState(mode)}
        query={query}
        onQuery={setQuery}
        hidden={masques}
      />

      {showDrafts ? (
        <DraftTable
          drafts={drafts === null ? null : draftsVus}
          draftTags={tagAssignments.drafts}
          catalog={tagCatalog}
          onTagsSaved={refreshTags}
          onDiscard={(draft) => setConfirming({ kind: "draft", draft })}
          onClear={() => clearFilters(mode)}
          onDefault={() => defaultFilters(mode)}
        />
      ) : (
        /* `table-fixed` et non le calcul automatique : sans lui, chaque
            colonne se dimensionne sur son contenu, et filtrer la liste — ou
            simplement un run au titre plus long — redistribue toute la
            largeur. Les colonnes sautaient d'un état à l'autre.

            Les largeurs sont donc posées une fois, au plus juste : « Run »
            n'en a pas et absorbe ce qui reste, et c'est bien elle qui doit
            s'étirer puisqu'elle porte le titre, l'identifiant et les tags.
            Trop serrer les autres et l'identifiant passe à la ligne.

            Elles sont identiques à celles du tableau des brouillons, colonne
            par colonne : sans ça, basculer d'une liste à l'autre décalait tout
            de quelques pixels, et l'œil le voyait sans savoir quoi. */
        /* La liste défile dans son propre cadre plutôt que dans la page, et
           son en-tête y colle : sur quarante runs, on perdait le nom des
           colonnes au bout de trois lignes.

           `max-h-[70vh]` et non une hauteur fixe — la barre de filtres au
           dessus change de hauteur selon le nombre de tags, et un cadre figé
           déborderait de l'écran sur les petits.

           Sans bordure : le filet sous l'en-tête et ceux entre les lignes
           disent déjà où la liste commence et finit. */
        <div className="max-h-[70vh] overflow-y-auto">
        <table className="w-full table-fixed text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            {/* Toutes les colonnes alignées à gauche, chiffres compris. Le coût
                et la note étaient à droite — l'usage pour des nombres — mais
                seules deux colonnes sur sept l'étaient, et l'œil qui descend la
                table butait dessus. Une table cohérente vaut mieux ici qu'une
                convention typographique appliquée deux fois. */}
            <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="py-3 pr-8 font-medium">Run</th>
              <th className="w-40 py-3 pr-8 font-medium">Launched</th>
              <th className="relative w-24 py-3 pr-8 font-medium">
                Shape{" "}
                <InfoDot label="What Shape means">
                  scénarios × modèles × répétitions
                </InfoDot>
              </th>
              <th className="w-32 py-3 pr-8 font-medium">Status</th>
              <th className="w-24 py-3 pr-8 font-medium">Cost</th>
              <th className="w-24 py-3 pr-8 font-medium">Grade</th>
              <th className="w-14 py-3" />
            </tr>
          </thead>
          <tbody>
            {/* Le squelette reste, même vide : les colonnes disaient la
                largeur de la table, et les remplacer par un message la faisait
                se rétracter — puis se rouvrir dès qu'un filtre était défait. */}
            {runsVus.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyTable
                    onClear={() => clearFilters(mode)}
                    onDefault={() => defaultFilters(mode)}
                  />
                </td>
              </tr>
            )}
            {runsVus.map(({ run, progress, mean, repetitions }) => {
              const { max } = rubricBounds(run.rubric);
              const running =
                run.status === "running" || run.status === "triggered";
              const [low, high] = repetitions;
              return (
                <tr
                  key={run.id}
                  className="border-b border-zinc-200 align-top hover:bg-zinc-50"
                >
                  {/* La colonne du titre prend la place restante : c'est par lui
                      qu'on retrouve un run, pas par sa forme ni son statut. */}
                  <td className="w-full py-3 pr-8">
                    <RunTitle
                      runId={run.id}
                      label={run.label}
                      fallback={run.first_scenario_title ?? run.id}
                      onSaved={() => void refreshRuns({ silent: true })}
                    >
                      <Link
                        href={`/eval/${run.id}`}
                        className="run-title inline-block font-medium hover:text-teal-800"
                      >
                        {run.label ?? run.first_scenario_title ?? run.id}
                      </Link>
                    </RunTitle>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <CopyId value={run.id} />
                      {/* Le local et le déployé écrivent dans la même base :
                          sans ce badge, un essai jetable ressemble à un vrai
                          run. Seul le local est marqué — c'est l'exception. */}
                    </div>
                    <TagField
                      compact
                      tags={tagAssignments.runs[run.id] ?? []}
                      catalog={tagCatalog}
                      onSave={(ids) => setRunTags(run.id, ids)}
                      onSaved={refreshTags}
                    />
                    {/* Qui l'a lancé. Tout le monde voit tous les runs : sans
                        l'auteur, une liste chargée ne dit plus à qui s'adresser
                        quand un run surprend.

                        Et par quoi : « (MCP) » dit qu'un agent a appuyé sur le
                        bouton, pas un humain. Seul le lancement de CE run est
                        compté — un brouillon écrit par un agent puis lancé d'un
                        clic reste un lancement humain, et ce qu'on ajoute à un
                        run après coup ne crée aucun run. Rien pour « ui » : le
                        cas ordinaire n'a pas à porter une étiquette. */}
                    {/* « local » et « MCP » vivent sur la ligne de l'adresse :
                        tous trois disent qui a lancé ce run et d'où, quand la
                        rangée du dessus dit ce qu'il EST. « public » reste
                        là-haut — c'est un bouton qui copie le lien, pas une
                        étiquette. Les classes viennent de `run-filters.ts`,
                        partagées avec les boutons de la barre de filtres. */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      {run.user_email && <span>{run.user_email}</span>}
                      {/* « local » seulement : « live » est le cas ordinaire,
                          et l'étiqueter reviendrait à marquer tout le monde.
                          « MCP » et « manual », en revanche, se valent — savoir
                          qu'un humain a lancé est une information, pas une
                          absence d'information. */}
                      {run.origin === "local" && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${PSEUDO_TAG_CLASSES.local}`}
                          title="A tourné sur une machine de développement, pas sur le job déployé"
                        >
                          <DimensionIcon dimension="machine" />
                          local
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                          run.launched_via === "mcp"
                            ? PSEUDO_TAG_CLASSES.mcp
                            : PSEUDO_TAG_CLASSES.manual
                        }`}
                        title={
                          run.launched_via === "mcp"
                            ? "Lancé par un agent via MCP"
                            : "Lancé à la main depuis cette application"
                        }
                      >
                        <DimensionIcon dimension="author" />
                        {run.launched_via === "mcp" ? "mcp" : "manual"}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8 text-zinc-600">
                    {formatDate(run.created_at)}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8 text-zinc-700">
                    {run.scenario_count} ×{" "}
                    {run.target_count} ×{" "}
                    {/* Compté sur les cases : un run complété n'a plus le même
                        nombre d'essais partout, et `config.repetitions` ne dirait
                        que ce qu'on a demandé au dernier lot. */}
                    {low === high ? low : `${low}–${high}`}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8">
                    <span
                      /* Tous les badges à la largeur du plus long,
                         « cancelled », et le mot centré dedans : sinon la
                         colonne fait cinq largeurs différentes et le regard
                         ne peut plus la descendre d'un trait. */
                      className={`inline-block w-20 rounded px-2 py-0.5 text-center text-xs ${STATUS_STYLE[run.status] ?? ""}`}
                    >
                      {STATUS_LABELS[run.status] ?? run.status}
                    </span>
                    {running && (
                      <div className="text-xs text-zinc-500">
                        {progress.done + progress.errored} / {progress.total}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8 text-zinc-700">
                    {run.cost_usd === null
                      ? "—"
                      : `$${run.cost_usd.toFixed(run.cost_usd < 1 ? 3 : 2)}`}
                  </td>
                  {/* La moyenne porte son échelle : chaque run a la sienne, et
                      un chiffre nu se comparerait à tort d'une ligne à l'autre. */}
                  <td className="whitespace-nowrap py-3 pr-8">
                    {mean === null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <>
                        <span className="font-medium">{formatMean(mean)}</span>
                        <span className="text-xs text-zinc-500">
                          {" "}
                          / {formatValue(max)}
                        </span>
                      </>
                    )}
                  </td>
                  {/* Rien n'est effacé : le run sort des listes et de la
                      lecture publique, sa ligne reste en base. */}
                  {/* `align-middle` contre l'`align-top` de la ligne : une
                      ligne fait quatre niveaux — titre, identifiant, tags,
                      adresse — et deux icônes accrochées en haut de cette
                      hauteur-là ne se rattachent visuellement à rien. Au
                      milieu, elles appartiennent à la ligne entière. */}
                  <td className="py-3 align-middle">
                    {/* Un flex, et non deux boutons en ligne : la colonne est
                        étroite et ils s'empilaient l'un sous l'autre. */}
                    <div className="flex items-center justify-end gap-1">
                    {/* Les deux sens se confirment. Publier expose scénarios,
                        conversations et justifications à quiconque a le lien.
                        Dépublier a une conséquence tout aussi réelle en face :
                        un lien déjà partagé cesse de répondre, sans prévenir
                        celui qui l'a. */}
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmingPublish({
                          id: run.id,
                          label: run.label ?? run.first_scenario_title ?? run.id,
                          next: !run.is_public,
                        })
                      }
                      disabled={publishing === run.id}
                      title={run.is_public ? "Published — click to unpublish" : "Not published — click to publish"}
                      aria-label={run.is_public ? `Unpublish run ${run.label ?? run.id}` : `Publish run ${run.label ?? run.id}`}
                      aria-pressed={run.is_public}
                      className={
                        run.is_public
                          ? `rounded-full p-1 disabled:opacity-40 ${PSEUDO_TAG_CLASSES.public}`
                          : "rounded-full p-1 text-zinc-300 hover:text-zinc-600 disabled:opacity-40"
                      }
                    >
                      <PublicIcon />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirming({
                          kind: "run",
                          id: run.id,
                          label:
                            run.label ?? run.first_scenario_title ?? run.id,
                        })
                      }
                      title="Remove this run from the lists"
                      aria-label={`Remove run ${run.label ?? run.id}`}
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
      )}
      <ConfirmDialog
        open={confirmingPublish !== null}
        title={
          confirmingPublish?.next ? "Publish this run?" : "Unpublish this run?"
        }
        confirmLabel={confirmingPublish?.next ? "Publish" : "Unpublish"}
        tone={confirmingPublish?.next ? "neutral" : "warning"}
        busy={publishing !== null}
        onConfirm={() =>
          confirmingPublish &&
          void setPublished(confirmingPublish.id, confirmingPublish.next)
        }
        onCancel={() => setConfirmingPublish(null)}
      >
        {confirmingPublish?.next ? (
          <p className="text-sm">
            Anyone with the link will be able to read{" "}
            <strong>{confirmingPublish?.label}</strong> without signing in —
            scores, judge justifications, full conversations and the scenarios
            themselves. The link is not listed anywhere, and unpublishing kills
            it.
          </p>
        ) : (
          <p className="text-sm">
            The public link to <strong>{confirmingPublish?.label}</strong> will
            stop answering — for everyone, including the Inspect logs served
            under it. Nobody holding that link is told; it simply stops working.
            Publishing again mints the same address, but anything open on it
            right now breaks.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming?.kind === "draft" ? "Discard this draft?" : "Remove this run?"
        }
        confirmLabel={confirming?.kind === "draft" ? "Discard" : "Remove"}
        tone="warning"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(null)}
      >
        <p className="text-sm">
          <strong className="font-medium">
            {confirming?.kind === "draft"
              ? draftName(confirming.draft)
              : (confirming?.label ?? "")}
          </strong>{" "}
          {confirming?.kind === "draft"
            ? "leaves the waiting list, and its link stops answering."
            : "leaves the lists, and its public link — if it had one — stops answering."}
        </p>
        {/* Le dire explicitement : sans ça, une corbeille se lit comme un
            effacement, et on hésite à s'en servir. */}
        <p className="text-sm text-zinc-500">
          Nothing is erased. The row stays in the database, so this can be
          undone by hand if it was a mistake.
        </p>
      </ConfirmDialog>
    </main>
  );
}

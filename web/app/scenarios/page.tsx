"use client";

// Ce qu'il faut savoir pour écrire un scénario qu'un modèle ne reconnaîtra pas
// comme un test.
//
// L'onglet n'est pas une bibliothèque de scénarios — ceux-ci vivent toujours
// dans le run qui les utilise. C'est l'endroit où vit le savoir sur la façon
// d'en écrire un, et c'est la même page qui sert à le lire, à le copier chez
// un agent, et à le réécrire.
//
// Le texte affiché est celui que l'outil MCP servira : une page qui montrerait
// autre chose que ce qui part serait un mensonge silencieux, le même qu'évite
// déjà l'aperçu du prompt du juge.
//
// En lecture, ce texte est rendu comme le markdown qu'il est — c'est un
// document qu'on lit, pas une charge utile qu'on inspecte. La promesse
// ci-dessus tient quand même : « Copy » copie la source, « Edit » la montre,
// et rien entre les deux ne réécrit un caractère. Seule la mise en forme
// change, jamais ce qui part.
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { Loading, Refreshing } from "@/components/Loading";
import { updateScenarioAdvice } from "@/lib/api";
import { putProfile, refreshProfile, useProfile } from "@/lib/profile-store";
import { renderMarkdown } from "@/lib/markdown";
import { DEFAULT_SCENARIO_ADVICE, scenarioAdvice } from "@/lib/scenario-advice";

export default function ScenariosPage() {
  // Le profil vient du cache partagé : « Evaluate » l'a préchargé, et la page
  // « Profile » lit la même ressource. On affiche donc ce qu'on avait déjà, et
  // la revérification se fait derrière.
  const { data: profileData, loading, error: loadError } = useProfile();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // À chaque arrivée : on revérifie. Si le cache porte déjà le profil, la page
  // est déjà écrite au premier rendu et cette requête ne fait attendre
  // personne — c'est tout l'objet du cache.
  useEffect(() => {
    void refreshProfile();
  }, []);

  // Dérivé du cache à chaque rendu, jamais recopié dans un état local. Une
  // copie aurait demandé un effet pour la tenir à jour, donc un rendu de plus
  // à chaque réponse — et deux sources de vérité à garder d'accord.
  //
  // `loaded` compte : tant que le profil n'est pas revenu, un
  // `scenario_advice` nul ne veut rien dire, et la page ne doit surtout pas se
  // croire sans surcharge avant d'avoir lu ce que le profil porte vraiment.
  const loaded = profileData !== null;
  const saved = profileData?.profile.scenario_advice ?? null;
  const shown = scenarioAdvice(saved);
  const custom = saved !== null && saved.trim() !== "";

  /** Ce que « Save » doit envoyer : `null` — le geste « remets le défaut » —
   *  dès que la saisie est vide, ou détourée égale au défaut. Les deux cas
   *  veulent dire la même chose ; les distinguer laisserait une copie
   *  s'écrire à la place du `null` qui laisse le défaut s'améliorer sous ce
   *  profil sans que personne ne l'ait voulu.
   *
   *  La comparaison détoure les deux côtés — un copier-coller qui ajoute un
   *  espace ou un saut de ligne final ne doit pas fabriquer une surcharge —
   *  mais ne touche pas aux blancs internes : quelqu'un qui a vraiment édité
   *  le texte garde sa version telle quelle, même si elle ne diffère que par
   *  une indentation. */
  function normalizedDraft(): string | null {
    if (draft.trim() === "" || draft.trim() === DEFAULT_SCENARIO_ADVICE.trim()) {
      return null;
    }
    return draft;
  }

  // `value` porte soit la surcharge à écrire, soit `null` pour remettre le
  // défaut — jamais accompagné d'un plafond : la route refuse désormais en
  // 422 une requête qui porterait les deux à la fois.
  function write(value: string | null) {
    setBusy(true);
    setSaveError(null);
    updateScenarioAdvice(value)
      .then(({ profile }) => {
        setDraft(scenarioAdvice(profile.scenario_advice));
        setEditing(false);
        // Le cache porte l'ancien profil : sans ça, « Profile » afficherait
        // encore la version d'avant au prochain clic.
        if (profileData) putProfile({ ...profileData, profile });
      })
      .catch((e) => setSaveError((e as Error).message))
      .finally(() => setBusy(false));
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-8">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl font-normal">Scenarios</h1>
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          What an agent needs to know to write a scenario a model will not
          recognise as a test.
          {loading && loaded && <Refreshing />}
        </p>
      </header>

      {loadError && <p className="text-sm text-red-700">{loadError}</p>}

      {/* Tient la place du document tant qu'il n'est pas là, au même bord que
          lui — sans quoi la page saute au moment où il arrive. */}
      {!loaded && loadError === null && <Loading label="Loading scenario advice" />}

      {loaded && (
        <>
          <p className="text-sm text-zinc-600">
            This is the exact text the <code>read_scenario_advice</code> MCP tool
            serves. Paste it into an agent that only has HTTP, or let one that holds
            the tools fetch it itself. Edit it and the tool serves your version.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <CopyButton
              // Pendant l'édition, ce qu'on copie doit être ce qu'on regarde
              // dans la zone de saisie — le brouillon, pas la version encore
              // enregistrée en dessous.
              value={editing ? draft : shown}
              title="Copy the scenario-writing advice"
              className="rounded border px-3 py-1 text-sm hover:bg-zinc-100"
            >
              {(copied) => (copied ? "Copied" : "Copy")}
            </CopyButton>
            {!editing && (
              <button
                onClick={() => {
                  setDraft(shown);
                  setEditing(true);
                }}
                disabled={busy}
                className="rounded border px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
              >
                Edit
              </button>
            )}
            {custom && !editing && (
              <button
                onClick={() => write(null)}
                disabled={busy}
                className="rounded border px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
              >
                Back to default
              </button>
            )}
            {custom && (
              <span className="text-xs text-zinc-500">Edited — the default is no longer shown.</span>
            )}
          </div>

          {saveError && <p className="text-sm text-red-700">{saveError}</p>}

          {/* Les deux modes prennent toute la largeur de la page, comme tout
              ce qui est au-dessus d'eux. Un plafond ici les désalignait du
              titre et du paragraphe d'introduction, ce qui se voyait plus que
              la ligne longue qu'il évitait. */}
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={30}
                className="w-full rounded border border-zinc-300 p-3 font-mono text-xs"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => write(normalizedDraft())}
                  disabled={busy}
                  className="rounded border px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setDraft(shown);
                    setEditing(false);
                    setSaveError(null);
                  }}
                  disabled={busy}
                  className="rounded border px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              className="notes-prose w-full rounded border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700"
              // Sûr : `renderMarkdown` échappe tout le HTML d'entrée avant de
              // produire les seules balises qu'il fabrique lui-même.
              // `reflow` : ce document est stocké coupé à 78 colonnes, et ces
              // coupures sont une commodité d'écriture, pas une intention. Sans
              // ça le texte gardait ses retours au milieu d'un cadre large, et
              // une puce coupée voyait sa suite repartir en paragraphe à la
              // marge. Les notes de run, elles, gardent leurs retours durs.
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(shown, { reflow: true }),
              }}
            />
          )}
        </>
      )}
    </main>
  );
}

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
import { CopyButton, CopyIcon } from "@/components/CopyButton";
import { Loading, Refreshing } from "@/components/Loading";
import { updateAdvice } from "@/lib/api";
import { putProfile, refreshProfile, useProfile } from "@/lib/profile-store";
import { renderMarkdown } from "@/lib/markdown";
import {
  ADVICE_SUMMARY,
  ADVICE_TOPICS,
  DEFAULT_ADVICE,
  adviceFor,
  overridesOf,
  type AdviceTopic,
} from "@/lib/advice";

const LABEL: Record<AdviceTopic, string> = {
  scenario: "Writing a scenario",
  batch: "Putting a batch together",
  analysis: "Reading the results",
  judge: "Writing a judge",
};

export default function ScenariosPage() {
  // Le profil vient du cache partagé : « Evaluate » l'a préchargé, et la page
  // « Profile » lit la même ressource. On affiche donc ce qu'on avait déjà, et
  // la revérification se fait derrière.
  const { data: profileData, loading, error: loadError } = useProfile();
  // Quel document on regarde. Un état et non une adresse : la page est un
  // client, le profil est déjà en cache, et changer d'onglet ne doit rien
  // recharger.
  const [topic, setTopic] = useState<AdviceTopic>("scenario");
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
  const overrides = profileData ? overridesOf(profileData.profile) : {};
  const saved = overrides[topic] ?? null;
  const shown = adviceFor(topic, overrides);
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
    if (draft.trim() === "" || draft.trim() === DEFAULT_ADVICE[topic].trim()) {
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
    updateAdvice(topic, value)
      .then(({ profile }) => {
        setDraft(adviceFor(topic, overridesOf(profile)));
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
        <h1 className="font-serif text-2xl font-normal">Guidelines</h1>
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          {ADVICE_SUMMARY[topic]}
          {loading && loaded && <Refreshing />}
        </p>
      </header>

      {/* Quatre documents lus à quatre moments. Changer d'onglet abandonne une
          édition en cours plutôt que de la traîner sur un autre document, où
          elle s'écrirait par-dessus le mauvais texte. */}
      <nav className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2">
        {ADVICE_TOPICS.map((entry) => (
          <button
            key={entry}
            onClick={() => {
              setTopic(entry);
              setEditing(false);
              setSaveError(null);
            }}
            disabled={busy}
            className={`cursor-pointer rounded px-3 py-1 text-sm disabled:opacity-50 ${
              entry === topic
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {LABEL[entry]}
          </button>
        ))}
      </nav>

      {loadError && <p className="text-sm text-red-700">{loadError}</p>}

      {/* Tient la place du document tant qu'il n'est pas là, au même bord que
          lui — sans quoi la page saute au moment où il arrive. */}
      {!loaded && loadError === null && <Loading label="Loading scenario advice" />}

      {loaded && (
        <>
          <p className="text-sm text-zinc-600">
            This is the exact text the <code>read_advice</code> MCP tool serves for{" "}
            <code>{topic}</code>. Paste it into an agent that only has HTTP, or let
            one that holds the tools fetch it itself. Edit it and the tool serves
            your version.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <CopyButton
              // Pendant l'édition, ce qu'on copie doit être ce qu'on regarde
              // dans la zone de saisie — le brouillon, pas la version encore
              // enregistrée en dessous.
              value={editing ? draft : shown}
              title={`Copy: ${LABEL[topic]}`}
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

          {/* The link one hands to somebody with no account here. It always
              serves the default: say so plainly when this profile carries an
              override, or you believe you are sharing your own version and
              share something else. The copied link is absolute — whoever
              receives it has none of this window's context — and
              `window.location.origin` is read only on click, never during
              render, where it does not exist server-side. */}
          <p className="flex flex-wrap items-center gap-1 text-sm text-zinc-500">
            {custom
              ? "Public link — anyone can read it, but it serves the default, not your edit:"
              : "Public link — anyone can read this, no account needed:"}{" "}
            <code className="rounded bg-zinc-100 px-1">
              {topic === "scenario"
                ? "/shared/scenarios"
                : `/shared/scenarios?topic=${topic}`}
            </code>
            <CopyButton
              value={() =>
                `${window.location.origin}/shared/scenarios` +
                (topic === "scenario" ? "" : `?topic=${topic}`)
              }
              title="Copy the public link"
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              {(copied) =>
                copied ? (
                  <span className="text-teal-700">copied</span>
                ) : (
                  <CopyIcon />
                )
              }
            </CopyButton>
          </p>

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

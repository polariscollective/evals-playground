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
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { getProfile, updateScenarioAdvice } from "@/lib/api";
import { DEFAULT_SCENARIO_ADVICE, scenarioAdvice } from "@/lib/scenario-advice";

export default function ScenariosPage() {
  const [saved, setSaved] = useState<string | null>(null);
  // `saved === null` est ambigu tant que le profil n'est pas revenu : ça peut
  // vouloir dire « sans surcharge » comme « pas encore su ». Un drapeau à part
  // lève l'ambiguïté, plutôt que de laisser la page se croire sans surcharge
  // — et copier ou écraser le défaut — avant d'avoir lu ce que porte vraiment
  // le profil.
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getProfile()
      .then(({ profile }) => {
        setSaved(profile.scenario_advice);
        setDraft(scenarioAdvice(profile.scenario_advice));
        setLoaded(true);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, []);

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
        setSaved(profile.scenario_advice);
        setDraft(scenarioAdvice(profile.scenario_advice));
        setEditing(false);
      })
      .catch((e) => setSaveError((e as Error).message))
      .finally(() => setBusy(false));
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Scenarios</h1>
        <p className="text-sm text-zinc-500">
          What an agent needs to know to write a scenario a model will not
          recognise as a test.
        </p>
      </header>

      {loadError && <p className="text-sm text-red-700">{loadError}</p>}

      {loaded && (
        <>
          <p className="text-sm text-zinc-600">
            This is the exact text the <code>read_scenario_advice</code> MCP tool
            serves. Paste it into an agent that only has HTTP, or let one that holds
            the tools fetch it itself. Edit it and the tool serves your version.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <CopyButton
              value={shown}
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
            <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-700">
              {shown}
            </pre>
          )}
        </>
      )}
    </main>
  );
}

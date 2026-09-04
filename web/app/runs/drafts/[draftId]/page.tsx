// Un run soumis par un agent, pas encore lancé. Lecture seule à part le
// bouton Launch : aucun autre chemin d'écriture n'existe ici.
import { notFound } from "next/navigation";
import { DraftNotFound, loadDraft } from "@/lib/drafts";
import { costSentence } from "@/lib/pricing";
import { LaunchDraftButton } from "@/components/LaunchDraftButton";

export default async function DraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;

  let draft;
  try {
    draft = await loadDraft(draftId);
  } catch (error) {
    if (error instanceof DraftNotFound) notFound();
    throw error;
  }

  const price = costSentence(draft.config);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          Draft — not yet launched
        </p>
        <h1 className="text-2xl font-semibold">
          {draft.config.label || "Untitled run"}
        </h1>
        <p className="text-sm text-zinc-500">
          Submitted by {draft.created_by} ·{" "}
          {new Date(draft.created_at).toLocaleString()}
        </p>
        {price && <p className="text-sm text-zinc-500">{price}</p>}
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">What the judge was asked</h2>
        <p className="text-sm">{draft.config.criterion}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Scenarios</h2>
        <p className="text-sm text-zinc-600">
          {draft.config.scenarios.length} scenario
          {draft.config.scenarios.length > 1 ? "s" : ""} ×{" "}
          {draft.config.models.targets.length} model
          {draft.config.models.targets.length > 1 ? "s" : ""}
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {draft.config.scenarios.map((scenario, index) => (
            <li key={scenario.title + index}>{scenario.title}</li>
          ))}
        </ul>
      </section>

      <LaunchDraftButton draftId={draft.id} />
    </main>
  );
}

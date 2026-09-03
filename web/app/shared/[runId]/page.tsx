// Un run publié, pour qui a l'adresse.
//
// Composant serveur, et un fichier à part : la page privée fait 1374 lignes et
// une quinzaine de boutons qui écrivent. Y passer un `readOnly` ferait dépendre
// la sûreté du fait que chaque bouton futur y pense. Ici, la lecture seule est
// une propriété du fichier — aucun chemin d'écriture n'y existe.
//
// La page refuse par elle-même quand le run n'est pas publié. Le proxy ne fait
// qu'aiguiller ; il ne prouve rien, exactement comme pour `requireUser`.
import { notFound } from "next/navigation";
import { NotFound, loadPublicRun } from "@/lib/runs";
import { cellsOf } from "@/lib/matrix";
import { renderMarkdown } from "@/lib/markdown";
import { cellStyle, formatMean, formatValue, sortedRubric } from "@/lib/rubric";

export default async function SharedRun({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  let detail;
  try {
    detail = await loadPublicRun(runId, { withTranscripts: true });
  } catch (error) {
    if (error instanceof NotFound) notFound();
    throw error;
  }

  const { run, samples } = detail;
  const scenarios = run.config.scenarios;
  const targets = run.config.models.targets;
  const cells = cellsOf(samples, scenarios.length, run.config.rubric);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          Shared run — read only
        </p>
        <h1 className="text-2xl font-semibold">
          {run.label ?? "Untitled run"}
        </h1>
        <p className="text-sm text-zinc-500">
          {new Date(run.created_at).toISOString().slice(0, 10)} · {run.status} ·{" "}
          {scenarios.length} scenario{scenarios.length > 1 ? "s" : ""} ×{" "}
          {targets.length} model{targets.length > 1 ? "s" : ""}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">What the judge was asked</h2>
        <p className="text-sm">{run.config.criterion}</p>
        <dl className="space-y-1 text-sm">
          {sortedRubric(run.config.rubric).map((level) => (
            <div key={level.value} className="flex gap-2">
              <dt className="w-10 shrink-0 text-zinc-500">
                {formatValue(level.value)}
              </dt>
              <dd>
                {level.meaning}
                {level.excluded ? " (not counted)" : ""}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Results</h2>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left font-medium">Scenario</th>
                {targets.map((model) => (
                  <th key={model} className="p-2 text-left font-medium">
                    {model}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario, index) => (
                <tr key={scenario.title + index}>
                  <th className="max-w-xs p-2 text-left font-normal">
                    {scenario.title}
                  </th>
                  {targets.map((model) => {
                    const cell = cells[index]?.[model];
                    return (
                      <td
                        key={model}
                        className={`p-2 text-center ${cellStyle(cell, run.config.rubric)}`}
                      >
                        {cell?.mean === null || cell === undefined
                          ? "—"
                          : formatMean(cell.mean)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {run.notes.trim() !== "" && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">Notes</h2>
          <div
            className="prose-sm space-y-2"
            // Sûr : `renderMarkdown` échappe tout le HTML d'entrée.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(run.notes) }}
          />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Scenarios</h2>
        {scenarios.map((scenario, index) => (
          <details key={scenario.title + index} className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {scenario.title}
            </summary>
            <div className="mt-2 space-y-2 text-sm">
              <p className="whitespace-pre-wrap text-zinc-600">
                <span className="mr-2 font-mono text-xs text-zinc-400">SYS</span>
                {scenario.system_prompt}
              </p>
              <p className="whitespace-pre-wrap">
                <span className="mr-2 font-mono text-xs text-zinc-400">MSG</span>
                {scenario.opening_message}
              </p>
            </div>
          </details>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Conversations</h2>
        {samples.map((sample) => (
          <details key={sample.id} className="rounded border p-3">
            <summary className="cursor-pointer text-sm">
              {sample.scenario_title} · {sample.target_model} · attempt{" "}
              {sample.repetition}
              {sample.score !== null ? ` · ${formatValue(sample.score)}` : ""}
            </summary>
            <div className="mt-2 space-y-2 text-sm">
              {sample.justification && (
                <p className="text-zinc-600">{sample.justification}</p>
              )}
              {(sample.messages ?? []).map((message, turn) => (
                <p key={turn} className="whitespace-pre-wrap">
                  <span className="mr-2 font-mono text-xs text-zinc-400">
                    {message.role.toUpperCase()}
                  </span>
                  {message.content}
                </p>
              ))}
            </div>
          </details>
        ))}
      </section>
    </main>
  );
}

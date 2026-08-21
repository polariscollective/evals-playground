"use client";

// Relire un run autrement, sans le rejouer.
//
// Les notes du juge ne bougent pas : c'est leur lecture qu'on change, et rien
// n'est écrit en base. Poser une autre question à des résultats déjà payés ne
// devrait pas coûter un second run.
import {
  AGGREGATES,
  PLAIN_VIEW,
  describeView,
  isPlainView,
  mapScore,
} from "@/lib/view";
import type { MatrixView } from "@/lib/view";
import { formatValue, sortedRubric } from "@/lib/judge-prompt";
import type { RubricLevel } from "@/lib/types";

export function ViewControls({
  rubric,
  /** Toutes les notes rendues par le juge sur ce run. */
  scores,
  view,
  onChange,
}: {
  rubric: RubricLevel[];
  scores: number[];
  view: MatrixView;
  onChange: (view: MatrixView) => void;
}) {
  const combien = new Map<number, number>();
  for (const score of scores) {
    combien.set(score, (combien.get(score) ?? 0) + 1);
  }
  const comptees = scores.filter(
    (score) => mapScore(score, rubric, view) !== null,
  ).length;
  const setRemap = (from: number, to: number | null | undefined) => {
    const remap = { ...view.remap };
    // `undefined` remet le palier à sa valeur d'origine, ce qui n'est pas la
    // même chose que de le remplacer par lui-même : l'absence de la clé garde
    // l'échelle du run visible dans l'URL comme à l'écran.
    if (to === undefined) delete remap[from];
    else remap[from] = to;
    onChange({ ...view, remap });
  };

  return (
    <details className="rounded border border-zinc-300">
      <summary className="cursor-pointer px-3 py-2 text-sm text-zinc-700">
        Cells show{" "}
        <span className="font-medium text-zinc-900">
          {describeView(view, rubric)}
        </span>
        {!isPlainView(view) && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
            recomputed
          </span>
        )}
      </summary>

      <div className="space-y-4 border-t border-zinc-200 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-600">Combine the grades of a cell by:</span>
          <div className="flex gap-1 rounded border border-zinc-300 p-0.5">
            {AGGREGATES.map((entry) => (
              <button
                key={entry.id}
                onClick={() => onChange({ ...view, aggregate: entry.id })}
                className={`cursor-pointer rounded px-3 py-1 ${
                  view.aggregate === entry.id ? "bg-zinc-900 text-white" : ""
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-zinc-600">
            Each grade counts as itself, unless you say otherwise. Collapsing a
            scale to 0 and 1 and taking the mean gives the share of conversations
            that reached the level you care about.
          </p>
          {/* Ce qu'un lecteur ne peut pas deviner : le palier « sans objet » est
              déjà dehors avant qu'il ouvre ce panneau, et c'est l'échelle qui l'a
              décidé — pas lui. */}
          <p className="text-xs text-zinc-500">
            A grade your scale marks as not applicable already counts for
            nothing: that was decided when the scale was written, and the judge
            could pick it knowing so. Everything you change here is a reading —
            the judge&rsquo;s grades are untouched.
          </p>
          {/* Une ligne, une affirmation. La version précédente posait une case
              à cocher à côté d'une case de valeur : « -1 » y désignait tantôt un
              palier mis hors moyenne par l'échelle, tantôt un nombre qui compte,
              et rien ne distinguait les deux. Ici chaque palier dit soit « vaut
              tel nombre », soit « ne compte pas », jamais les deux à la fois. */}
          <table className="text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-3 font-normal">Grade</th>
                <th className="py-1 pr-3 font-normal">What it means</th>
                <th className="py-1 pr-3 text-right font-normal">Given</th>
                <th className="py-1 font-normal">Counts as</th>
              </tr>
            </thead>
            <tbody>
              {sortedRubric(rubric).map((level) => {
                const mapped = view.remap[level.value];
                const ignored = mapScore(level.value, rubric, view) === null;
                const byTheScale = level.excluded && !(level.value in view.remap);
                return (
                  <tr key={level.value} className="border-t border-zinc-100">
                    <td className="py-1.5 pr-3 font-mono text-zinc-500">
                      {formatValue(level.value)}
                    </td>
                    <td className="max-w-md truncate py-1.5 pr-3 text-zinc-700">
                      {level.meaning}
                    </td>
                    {/* Combien de fois le juge a réellement choisi ce palier :
                        c'est ce qui dit si le toucher change quelque chose. */}
                    <td className="py-1.5 pr-3 text-right text-xs whitespace-nowrap text-zinc-500">
                      {combien.get(level.value) ?? 0}×
                    </td>
                    <td className="py-1.5">
                      {ignored ? (
                        <span className="flex items-center gap-2">
                          <span className="text-zinc-500 italic">
                            {byTheScale ? "nothing — the scale leaves it out" : "nothing"}
                          </span>
                          <button
                            onClick={() => setRemap(level.value, level.value)}
                            className="cursor-pointer rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50"
                          >
                            count it
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <input
                            type="number"
                            step="any"
                            aria-label={`Value counted for grade ${level.value}`}
                            placeholder={formatValue(level.value)}
                            value={mapped === undefined ? "" : String(mapped)}
                            onChange={(event) =>
                              setRemap(
                                level.value,
                                event.target.value === ""
                                  ? undefined
                                  : Number(event.target.value),
                              )
                            }
                            className="w-20 rounded border border-zinc-300 px-2 py-0.5"
                          />
                          <button
                            onClick={() => setRemap(level.value, null)}
                            className="cursor-pointer rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50"
                          >
                            leave out
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-sm">
          <strong className="font-medium">{comptees}</strong> of {scores.length}{" "}
          grade{scores.length === 1 ? "" : "s"} counted
          {scores.length - comptees > 0 &&
            `, ${scores.length - comptees} left out`}
          .
        </p>

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-zinc-500">
            {/* Le point qui fait qu'on ose toucher à ces réglages. */}
            Nothing is written: the judge&rsquo;s grades stay as they are, and
            reloading the page brings back the plain reading.
          </p>
          <button
            onClick={() => onChange(PLAIN_VIEW)}
            disabled={isPlainView(view)}
            className="shrink-0 cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:cursor-default disabled:opacity-40"
          >
            Reset
          </button>
        </div>
      </div>
    </details>
  );
}

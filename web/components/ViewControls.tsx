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
            Give a grade another value, or leave it out. Collapsing a scale to 0
            and 1 and taking the mean gives the share of conversations that
            reached the level you care about.
          </p>
          {/* La confusion à lever : une note « sans objet » est une réponse du
              juge, choisie par lui ; « leave out » est une décision de lecteur,
              prise après coup sur des notes déjà rendues. */}
          <p className="text-xs text-zinc-500">
            A grade the scale marks as not applicable is a verdict the judge
            could pick, and it is already out of the count. Leaving a grade out
            here is your own decision, made after the fact — it changes nothing
            the judge said, and you can bring the not-applicable grade back in by
            giving it a value.
          </p>
          {/* La confusion qu'on a réellement faite : donner à une note la valeur
              d'un palier « sans objet » ne la met pas dehors. Les deux colonnes
              de droite montrent la différence à mesure qu'on la fait. */}
          <p className="text-xs text-zinc-500">
            The two are not the same. Leaving a grade out drops it from the
            count; giving it a value keeps it in, <em>as that number</em> — even
            if that number happens to be the one your not-applicable level uses.
          </p>
          <table className="text-sm">
            <tbody>
              {sortedRubric(rubric).map((level) => {
                const mapped = view.remap[level.value];
                // L'état *effectif*, échelle comprise : un palier « sans objet »
                // est déjà hors du calcul avant qu'on ait touché à quoi que ce
                // soit, et la case doit le dire — sinon elle affiche « compté »
                // pour une note qui ne l'est pas.
                const ignored = mapScore(level.value, rubric, view) === null;
                const shown =
                  mapped === undefined || mapped === null ? "" : String(mapped);
                return (
                  <tr key={level.value}>
                    <td className="py-1 pr-3 font-mono text-zinc-500">
                      {formatValue(level.value)}
                    </td>
                    <td className="max-w-md truncate py-1 pr-3 text-zinc-700">
                      {level.meaning}
                    </td>
                    {/* Combien de fois le juge a réellement choisi ce palier :
                        c'est ce qui dit si l'écarter change quelque chose. */}
                    <td className="py-1 pr-3 text-right text-xs whitespace-nowrap text-zinc-500">
                      {combien.get(level.value) ?? 0}×
                    </td>
                    <td className="py-1 pr-3">
                      <input
                        type="number"
                        step="any"
                        disabled={ignored}
                        placeholder={formatValue(level.value)}
                        value={shown}
                        onChange={(event) =>
                          setRemap(
                            level.value,
                            event.target.value === ""
                              ? undefined
                              : Number(event.target.value),
                          )
                        }
                        className="w-20 rounded border border-zinc-300 px-2 py-0.5 disabled:bg-zinc-100"
                      />
                    </td>
                    <td className="py-1">
                      <label className="flex cursor-pointer items-center gap-1 text-xs text-zinc-600">
                        <input
                          type="checkbox"
                          className="cursor-pointer"
                          checked={ignored}
                          onChange={() =>
                            setRemap(
                              level.value,
                              // Remettre dans le calcul un palier que l'échelle
                              // exclut demande de le dire explicitement :
                              // oublier la clé le renverrait dehors.
                              ignored
                                ? level.excluded
                                  ? level.value
                                  : undefined
                                : null,
                            )
                          }
                        />
                        {level.excluded && !(level.value in view.remap)
                          ? "left out by the scale"
                          : "leave out"}
                      </label>
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

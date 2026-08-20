"use client";

import type { RubricLevel } from "@/lib/types";

/** L'éditeur d'échelle : une ligne par palier, un nombre et ce qu'il veut dire.
 *
 * Le même composant sert au lancement d'un run et à une passe de juge rejouée :
 * les deux écrivent la même chose, et deux éditeurs divergeraient.
 *
 * La valeur est tenue en chaîne dans le champ mais remontée en nombre : une
 * saisie intermédiaire comme `0.` ou `-` n'est pas un nombre valide, et la
 * convertir à chaque frappe empêcherait de taper `0.5`. */
export function RubricEditor({
  rubric,
  onChange,
}: {
  rubric: RubricLevel[];
  onChange: (rubric: RubricLevel[]) => void;
}) {
  const set = (index: number, patch: Partial<RubricLevel>) =>
    onChange(rubric.map((level, i) => (i === index ? { ...level, ...patch } : level)));

  const remove = (index: number) =>
    onChange(rubric.filter((_, i) => i !== index));

  const add = () => {
    const highest = rubric.reduce((max, level) => Math.max(max, level.value), -1);
    onChange([...rubric, { value: highest + 1, meaning: "" }]);
  };

  const hasExcluded = rubric.some((level) => level.excluded);

  /** Un palier que le juge peut choisir sans qu'il entre dans la moyenne.
   *
   * `-1` par convention, en dehors des échelles qui partent de zéro. La valeur
   * n'a rien de magique — c'est le drapeau qui compte, et l'utilisateur peut la
   * changer si son échelle utilise déjà -1. */
  const addExcluded = () =>
    onChange([
      ...rubric,
      {
        value: -1,
        meaning: "The question did not apply to this conversation.",
        excluded: true,
      },
    ]);

  const duplicates = new Set(
    rubric
      .map((level) => level.value)
      .filter((value, index, all) => all.indexOf(value) !== index),
  );

  return (
    <div className="space-y-2">
      {rubric.map((level, index) => (
        <div key={index} className="flex items-start gap-2">
          <input
            type="number"
            step="any"
            value={Number.isNaN(level.value) ? "" : level.value}
            onChange={(e) =>
              set(index, { value: Number.parseFloat(e.target.value) })
            }
            aria-label={`Grade ${index + 1}`}
            className={`w-20 shrink-0 rounded border p-2 text-right font-mono ${
              duplicates.has(level.value)
                ? "border-red-400 bg-red-50"
                : "border-zinc-300"
            }`}
          />
          <div className="w-full">
            <input
              value={level.meaning}
              onChange={(e) => set(index, { meaning: e.target.value })}
              placeholder="what this grade means — the judge reads this"
              aria-label={`Meaning of grade ${index + 1}`}
              className="w-full rounded border border-zinc-300 p-2"
            />
            {level.excluded && (
              <span className="mt-0.5 block text-xs text-zinc-500">
                Kept out of the average — the judge can pick it, it just does not
                count.
              </span>
            )}
          </div>
          <button
            onClick={() => remove(index)}
            disabled={
              !level.excluded &&
              rubric.filter((other) => !other.excluded).length <= 2
            }
            title={
              !level.excluded &&
              rubric.filter((other) => !other.excluded).length <= 2
                ? "A scale needs at least two grades that count"
                : "Remove this grade"
            }
            aria-label={`Remove grade ${index + 1}`}
            className="shrink-0 rounded border border-zinc-300 px-3 py-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ×
          </button>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          onClick={add}
          className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
        >
          + Add a grade
        </button>
        {!hasExcluded && (
          <button
            onClick={addExcluded}
            title="For conversations the question does not apply to. The judge can pick it, and it stays out of the average."
            className="rounded border border-dashed border-zinc-400 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            + Add “not applicable”
          </button>
        )}
        {duplicates.size > 0 && (
          <span className="text-sm text-red-700">
            Two grades cannot share the same number.
          </span>
        )}
      </div>
    </div>
  );
}

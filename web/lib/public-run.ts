// Ce qu'un inconnu peut lire d'un run publié.
//
// Une seule fonction décide, et elle est pure : la page publique et, plus tard,
// les endpoints que lira un agent passent tous par ici. Séparée de `runs.ts`,
// qui est `server-only` et que `node --test` ne peut pas importer.
import type { RunDetail } from "./types";

/** Le run tel qu'il sort, sans l'adresse de qui l'a lancé.
 *
 * Elle seule est retirée. Les notes du run, la note privée de chaque scénario
 * et le CSV source partent avec le reste : c'est la décision du dessin, prise
 * en sachant que ces champs ont été écrits en privé. Ne pas « corriger » ça
 * sans rouvrir la question — le test le dit aussi.
 *
 * Une copie, jamais une mutation : l'objet vient d'une lecture que la page
 * privée partage. */
export function withoutIdentity(detail: RunDetail): RunDetail {
  const { user_email: _, ...run } = detail.run;
  return { ...detail, run: run as RunDetail["run"] };
}

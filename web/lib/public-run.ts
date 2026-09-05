// Ce qu'un inconnu peut lire d'un run publié.
//
// Une seule fonction décide, et elle est pure : la page publique passe par
// ici, et rien d'autre ne devrait décider seul de ce qui sort. Séparée de
// `runs.ts`, qui est `server-only` et que `node --test` ne peut pas importer.
import type { EvalRun, RunDetail, RunExtensionLogEntry } from "./types";

/** Une extension telle qu'un inconnu peut la lire : sans l'adresse de qui l'a
 *  demandée. `via` reste — savoir qu'une extension est venue d'un agent ou de
 *  l'écran ne désigne personne. */
export type PublicExtensionLogEntry = Omit<RunExtensionLogEntry, "by">;

/** Un run tel qu'un inconnu peut le lire : sans l'adresse de qui l'a lancé, ni
 *  celles de qui l'a étendu. La seconde se cache dans un tableau, et c'est
 *  exactement pour ça qu'elle est retirée par le type plutôt que de compter
 *  sur la vigilance : `user_email` avait été rendue impossible à lire, et
 *  `extensions[].by` a failli passer parce qu'elle n'était pas à la racine. */
export type PublicRun = Omit<EvalRun, "user_email" | "extensions"> & {
  extensions: PublicExtensionLogEntry[];
};

/** Le pendant public de `RunDetail`. Distinct plutôt que de retyper `run` en
 *  `EvalRun` et de croiser les doigts : un futur accès à `.run.user_email` sur
 *  ce que rend `loadPublicRun` devient une erreur de compilation, pas un
 *  `undefined` découvert à l'exécution — ce qui est précisément le genre
 *  d'erreur que cette fonction existe pour rendre impossible. */
export interface PublicRunDetail extends Omit<RunDetail, "run"> {
  run: PublicRun;
}

/** Le run tel qu'il sort, sans l'adresse de qui l'a lancé.
 *
 * Elle seule est retirée. Les notes du run, l'analyse, la note privée de
 * chaque scénario et le CSV source partent avec le reste : c'est la décision
 * du dessin, prise en sachant que ces champs ont été écrits en privé. Ne pas
 * « corriger » ça sans rouvrir la question — le test le dit aussi.
 *
 * Une copie de surface, pas une mutation : `run` et l'objet rendu sont neufs,
 * mais `run.config`, `samples` et `progress` restent partagés par référence
 * avec l'original, qui vient d'une lecture que la page privée partage aussi.
 * Rien ici ne les mute ; un futur appelant qui le ferait muterait la version
 * privée avec. */
export function withoutIdentity(detail: RunDetail): PublicRunDetail {
  const { user_email, extensions, ...run } = detail.run;
  return {
    ...detail,
    run: {
      ...run,
      // `?? []` et non `extensions.map` : une ligne lue sans cette colonne —
      // un `select` plus étroit, une donnée écrite avant qu'elle existe — ne
      // doit pas faire tomber la page publique pour une histoire d'extensions
      // qu'elle n'a de toute façon pas.
      extensions: (extensions ?? []).map(({ by, ...entrée }) => entrée),
    },
  };
}

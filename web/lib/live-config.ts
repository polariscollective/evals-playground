// La configuration d'un run, telle qu'elle doit être PRÉSENTÉE : au
// téléchargement (l'outil MCP `get_run_config`), à la duplication (le
// formulaire repris depuis un run existant), ou à tout autre endroit qui
// affiche « les juges de ce run ».
//
// `EvalRun.config` reste la trace figée de ce qui a été demandé au
// lancement — on n'y touche pas, et `search_runs` (recherche par critère
// d'origine) comme l'historique d'extension continuent de la lire telle
// quelle : eux répondent à « qu'est-ce qui avait été demandé », pas à
// « qui juge ce run aujourd'hui ».
//
// POURQUOI DÉRIVER PLUTÔT QUE RECOPIER : faire écrire l'ajout ou le retrait
// d'un juge dans `config` donnerait deux endroits à tenir d'accord — la
// liaison vivante dans `run_judges`, et sa copie dans `config.judges`. Ce
// chantier en a déjà produit trois exemples réels rien que cette semaine
// (un bouton qui comptait autrement que le moteur, un formulaire qui
// ignorait un champ, un devis qui facturait un texte jamais envoyé) : deux
// vérités sur la même question finissent toujours par diverger, jamais par
// rester d'accord. En dérivant à la LECTURE depuis les liaisons vivantes —
// jamais en écrivant l'ajout ou le retrait dans `config` — il n'y a qu'un
// seul endroit qui décide qui sont les juges d'un run aujourd'hui :
// `loadLiveRunJudges` (`runs.ts`), déjà celui qui alimente l'écran et les
// outils MCP de lecture. Si un jour quelqu'un « corrige » ça en faisant
// écrire l'ajout dans `config` au moment d'`addJudge`, le trou que ce
// fichier existe pour fermer se rouvrira : un juge délié depuis resterait
// visible, ou un juge ajouté par une autre porte n'apparaîtrait pas ici.
//
// Fonction pure, sans accès à la base — ce qui lui vaut de ne pas être
// marquée `server-only`, à la différence de `runs.ts` : la duplication en a
// besoin côté navigateur, avec les juges déjà chargés par la page
// (`RunDetail.judges`), sans reproduire cette logique une deuxième fois pour
// elle. Même raison de séparation que `public-run.ts`.
import type {
  EvalRunConfig,
  Judge,
  JudgeSystemTypeColumn,
} from "./types";

const AWAKE: JudgeSystemTypeColumn = "awake";

/** Un juge vivant d'un run, réduit à ce dont cette dérivation a besoin —
 *  satisfait aussi bien par `LiveRunJudge` (`runs.ts`) que par
 *  `RunJudgeView` (`types.ts`), les deux formes sous lesquelles un appelant
 *  peut avoir déjà chargé les juges vivants d'un run. */
export interface JudgeForConfig {
  judge: Judge;
  is_principal: boolean;
  system_type: JudgeSystemTypeColumn;
}

/** La configuration d'un run, avec ses juges remplacés par ceux réellement
 *  vivants aujourd'hui — voir l'en-tête de ce fichier pour pourquoi.
 *
 * Ce qui change par rapport à `config` tel quel :
 * - `criterion`, `rubric`, `models.judge` deviennent ceux du PRINCIPAL
 *   vivant — pas nécessairement celui du lancement, si `designatePrincipal`
 *   a transféré le titre depuis. Même repli que `get_run_metadata` et
 *   l'écran (`JudgeBlock`, `components/RunRead.tsx`) quand aucun principal
 *   n'est vivant (tous les juges ont été déliés) : on retombe sur ce que
 *   `config` disait au lancement, plutôt que de rendre une configuration
 *   sans aucun critère — un run sans juge reste relançable.
 * - `judges` (les secondaires) devient un `JudgeSpec` par juge ORDINAIRE
 *   vivant, hors principal : ceux ajoutés après coup (`addJudge`) y
 *   apparaissent, ceux déliés (`unlinkJudge`) en disparaissent. Un juge
 *   système (l'éveil) n'y figure jamais — ce n'est pas sa forme, voir
 *   `check_eval_awareness` juste en dessous.
 * - `check_eval_awareness` reflète si la liaison d'éveil est encore vivante
 *   MAINTENANT, jamais ce que `config` avait demandé au lancement : un juge
 *   d'éveil délié ne doit pas revivre à la prochaine relance faite depuis
 *   cette configuration, et un run d'avant ce champ dont l'éveil tourne
 *   toujours doit continuer de le dire.
 *
 * Tout le reste — scénarios, tours, répétitions, outils, température,
 * modèles cibles, adversaire, source... — n'a pas de pendant dans
 * `run_judges` : recopié tel quel depuis `config`. */
export function withLiveJudges(
  config: EvalRunConfig,
  live: JudgeForConfig[],
): EvalRunConfig {
  const principal = live.find((entry) => entry.is_principal);
  const secondaries = live.filter(
    (entry) => !entry.is_principal && entry.system_type === "ordinary",
  );
  const awakeStillLinked = live.some((entry) => entry.system_type === AWAKE);

  return {
    ...config,
    criterion: principal?.judge.criterion ?? config.criterion,
    rubric: principal?.judge.rubric ?? config.rubric,
    models: {
      ...config.models,
      judge: principal?.judge.model ?? config.models.judge,
    },
    judges: secondaries.map((entry) => ({
      // Non nul en pratique : un juge `system_type === "ordinary"` porte
      // toujours son critère et son échelle — voir `Judge` dans `types.ts`
      // et la contrainte `judges_ordinary_or_system_check` en base. Le
      // repli n'est là que pour satisfaire le type, jamais atteint.
      criterion: entry.judge.criterion ?? "",
      rubric: entry.judge.rubric ?? [],
      model: entry.judge.model,
    })),
    check_eval_awareness: awakeStillLinked,
  };
}

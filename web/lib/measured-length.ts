// Ce qu'un run terminé sait dire de la longueur de ses propres réponses.
//
// Le devis d'un run neuf repose sur un nombre déclaré : personne n'a de données
// sur une matrice qui n'a jamais tourné. Une extension, elle, prolonge un run
// qui a fini — ses jetons sont facturés, comptés, enregistrés. Les redemander à
// quelqu'un serait lui faire deviner ce qu'on sait déjà.
//
// Rien ici ne touche à la base ni au réseau : le module prend des cases et rend
// des nombres, pour qu'il se teste seul.
import { SHARED_PRICING as S } from "./shared.ts";
import type { EvalModels, ModelUsage, SampleStatus } from "./types";

/** Ce qu'une case doit porter pour être mesurable. Sciemment plus étroit que
 *  `EvalSample` : ni transcript, ni note, ni date — la requête n'a donc que
 *  cinq colonnes à ramener, là où les transcripts pèsent des centaines de
 *  kilo-octets. */
export interface MeasurableCell {
  scenario_index: number;
  target_model: string;
  status: SampleStatus;
  /** La profondeur à laquelle cette case-là a joué, et non celle du run : un
   *  run approfondi porte des cases plus profondes que d'autres, et
   *  `config.turns` ne nomme que la dernière profondeur demandée. `null` pour
   *  les cases antérieures à la colonne, qui retombent alors sur celle du run
   *  — même convention que `groupByModelAndDepth`. */
  turns_done: number | null;
  usage: Record<string, ModelUsage>;
}

export interface MeasuredLengths {
  /** Jetons de sortie par tour, pour chaque scénario qui a des cases propres.
   *  Un scénario absent n'en a aucune. */
  byScenario: Map<number, number>;
  /** La même chose sur tout le run, mise en commun. `null` si rien n'est
   *  mesurable. */
  run: number | null;
  /** Jetons de sortie par tour d'adversaire, ou `null` — run à un seul tour,
   *  adversaire cumulant les rôles, ou rien de mesurable. */
  adversary: number | null;
  /** Combien de cases terminées ont été écartées parce que leur modèle évalué
   *  jouait aussi un autre rôle. Sert à le dire à l'écran plutôt qu'à le taire. */
  skipped: number;
  /** Combien de cases ont effectivement porté la mesure. Un devis appuyé sur
   *  deux cases ne se lit pas comme un devis appuyé sur deux cents. */
  kept: number;
}

interface Pool {
  tokens: number;
  calls: number;
}

const ajouter = (pool: Pool, tokens: number, calls: number): void => {
  pool.tokens += tokens;
  pool.calls += calls;
};

/** La moyenne d'un bassin, ou `null` quand il n'y a rien à en tirer.
 *
 * Un total nul n'est pas une mesure à zéro : un run dont la sortie a été
 * intégralement bloquée par le fournisseur n'a pas appris que les réponses
 * sont gratuites, il n'a rien appris du tout. Le laisser passer chiffrait
 * l'extension à un jeton par tour — `clamp` remontant le zéro à un — sous une
 * phrase annonçant « 0 output tokens per turn ». C'est le même traitement
 * qu'une case sans compteur, muette plutôt que nulle.
 *
 * Le garde-fou porte sur le résultat arrondi, pas sur le total brut : un
 * bassin non vide peut arrondir à zéro (quelques jetons sur des dizaines
 * d'appels) sans que le total soit nul lui-même, et cette moyenne-là est
 * tout aussi peu une mesure — elle rendrait le même « 0 output tokens per
 * turn » par un autre chemin. */
const moyenne = (pool: Pool): number | null => {
  if (pool.calls === 0) return null;
  const valeur = Math.round(pool.tokens / pool.calls);
  return valeur > 0 ? valeur : null;
};

/** Mesure les longueurs de sortie d'un run terminé.
 *
 * Le dénominateur d'une case est *sa* profondeur — `turns_done` —, pas celle
 * que le run affiche aujourd'hui : une extension peut relever `turns` sans
 * approfondir une seule case, et l'approfondissement lui-même ne touche que
 * les cases choisies. Un run en porte donc couramment à des profondeurs
 * mêlées, et les diviser toutes par la plus récente rend une longueur d'autant
 * plus basse que le run a été poussé loin. `turns` reste le repli des cases
 * antérieures à la colonne.
 *
 * Le dénominateur est la profondeur, pas le nombre d'appels réellement facturés :
 * l'estimateur n'ajoute la réponse du modèle évalué que `turns` fois par
 * conversation, n'ayant aucun modèle des appels d'outils. Diviser par les
 * appels réels lui ferait rendre moins que le total observé, d'autant plus
 * qu'un scénario emploie des outils. En divisant par les tours, la mesure
 * absorbe cette inflation et le devis reproduit exactement ce qu'on a payé.
 *
 * Une case dont le modèle évalué est aussi juge ou adversaire est écartée :
 * `usage` est indexé par nom de modèle et jamais par rôle, si bien que ses
 * réponses et ses verdicts s'additionnent sur la même ligne — et un
 * re-jugement, que `add_usage` cumule, aggrave encore le mélange. Les écarter
 * ne perd rien : la longueur étant une propriété du scénario et non du modèle,
 * la mesurer sur les modèles qui ne cumulent pas les rôles vaut autant que de
 * la mesurer sur tous. */
export function measureRun(
  cells: MeasurableCell[],
  models: EvalModels,
  turns: number,
): MeasuredLengths {
  const autresRôles = new Set(
    [models.judge, models.adversary].filter((model): model is string =>
      Boolean(model),
    ),
  );
  const adversaire = turns > 1 ? models.adversary : null;
  /** La profondeur de cette case, ou celle du run pour une ligne écrite avant
   *  que la colonne n'existe. */
  const profondeur = (cell: MeasurableCell): number => cell.turns_done ?? turns;
  // Un adversaire qui est aussi évalué ou juge est illisible pour la même
  // raison que les cibles qui cumulent.
  const adversaireLisible =
    adversaire != null &&
    adversaire !== models.judge &&
    !models.targets.includes(adversaire);

  const parScénario = new Map<number, Pool>();
  const run: Pool = { tokens: 0, calls: 0 };
  const adversairePool: Pool = { tokens: 0, calls: 0 };
  let skipped = 0;
  let kept = 0;

  for (const cell of cells) {
    if (cell.status !== "done") continue;

    if (adversaireLisible) {
      const jetons = cell.usage[adversaire]?.output_tokens;
      // Une relance de moins que de tours, et zéro relance pour une case qui
      // s'est réglée au premier : l'y compter diviserait par zéro.
      const relances = profondeur(cell) - 1;
      if (jetons != null && relances > 0) {
        ajouter(adversairePool, jetons, relances);
      }
    }

    if (autresRôles.has(cell.target_model)) {
      skipped += 1;
      continue;
    }
    const jetons = cell.usage[cell.target_model]?.output_tokens;
    // Une case sans compteur n'est pas une case à zéro jeton : elle est muette,
    // et la compter tirerait la moyenne vers le bas sans rien mesurer.
    if (jetons == null) continue;

    const tours = profondeur(cell);
    if (tours <= 0) continue;
    const pool = parScénario.get(cell.scenario_index) ?? { tokens: 0, calls: 0 };
    ajouter(pool, jetons, tours);
    parScénario.set(cell.scenario_index, pool);
    ajouter(run, jetons, tours);
    kept += 1;
  }

  const byScenario = new Map<number, number>();
  for (const [index, pool] of parScénario) {
    const valeur = moyenne(pool);
    if (valeur != null) byScenario.set(index, valeur);
  }

  return {
    byScenario,
    run: moyenne(run),
    adversary: adversaireLisible ? moyenne(adversairePool) : null,
    skipped,
    kept,
  };
}

/** La longueur à supposer pour chacun de ces scénarios, dans l'ordre donné.
 *
 * La cascade dit ce qu'on sait, du plus précis au plus vague : la mesure de ce
 * scénario, sinon celle du run — un scénario ajouté ressemblera aux
 * précédents —, sinon ce que l'auteur avait déclaré, sinon la moyenne générale
 * pour les runs antérieurs au champ. */
export function answerLengthsFor(
  scenarioIndices: number[],
  measured: MeasuredLengths,
  declared: number | undefined,
): number[] {
  const repli = measured.run ?? declared ?? S.default_response_tokens;
  return scenarioIndices.map(
    (index) => measured.byScenario.get(index) ?? repli,
  );
}

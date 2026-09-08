// Le voyant des résultats servis, et son croisement avec l'éveil.
//
// Un chiffre au niveau du run, pas une marque dans chaque case — même
// raisonnement que `awareness.ts`, et pour la même raison : le signal est vide
// dans la quasi-totalité des runs, et doubler la charge de l'écran principal
// pour une colonne toujours verte abîmerait ce qui marche. Quand le voyant
// sonne, on descend.
//
// Le croisement est ce qui justifie de construire tout ça. Une note d'éveil
// haute est sinon une impasse : on sait que le modèle a flairé quelque chose,
// on ne sait pas quoi. Or on tient les deux bouts — le transcript dit quels
// appels une conversation a faits, le juge d'éveil dit ce qu'elle a obtenu — et
// la jointure ne coûte rien.
//
// Voir docs/superpowers/specs/2026-09-07-le-monde-des-outils.md.

/** Une ligne de `tool_results`, réduite à ce que ce module lit. */
export interface ToolResultRow {
  scenario_index: number;
  tool_name: string;
  arguments: Record<string, unknown> | null;
  /** Nul tant que le contrôle n'est pas passé — ce qui reste à faire, lu
   *  plutôt que recalculé. */
  faithful: boolean | null;
  fault: string;
  /** Pourquoi le contrôle n'a pas pu se faire, ou `null`. `faithful` reste nul
   *  dans ce cas — on ne sait pas, on sait seulement pourquoi on n'a pas su.
   *  Effacée dès qu'un contrôle réussit (voir la migration
   *  `20260907190000_tool_results_check_error.sql`) : c'est la dernière
   *  raison, jamais un verdict, et distincte d'un contrôle simplement pas
   *  encore tenté. */
  check_error: string | null;
  /** Combien de fois l'environnement a répondu à cet appel. `2` dit qu'une
   *  réparation a eu lieu — le contrôle avait refusé la première réponse, sa
   *  raison est repartie au serveur, et celui-ci a réessayé.
   *
   * Avec `faithful === false`, c'est la **cinquième issue** : servi malgré une
   * réparation échouée. Elle n'est aucune des quatre autres, et ce produit ne
   * fond jamais deux issues. */
  attempts?: number;
  /** Qui a contrôlé. Rend visible le repli du spec : quand il partage le
   *  fournisseur de `model`, le contrôleur a le biais de celui qu'il contrôle
   *  — mieux que pas de contrôle, mais ça se sait plutôt que ça se devine. */
  check_model?: string | null;
  /** Le modèle qui a servi ce résultat, pour la comparaison ci-dessus. */
  model?: string | null;
}

/** Les arguments d'un appel sous forme comparable.
 *
 * Les clés sont triées : deux appels identiques écrits dans un ordre différent
 * sont le même appel, et doivent se rapprocher.
 *
 * **Ne coïncide pas avec la forme Python** (`world.arguments_key`), qui pose
 * une espace après les deux-points. Sans conséquence : le hachage de la clé
 * primaire ne se calcule que côté Python, et cette fonction ne sert qu'à
 * rapprocher deux objets déjà lus ici. Ne jamais s'en servir pour reconstituer
 * `arguments_hash` — elle ne le retrouverait pas. */
export function argumentsKey(args: Record<string, unknown> | null): string {
  const source = args ?? {};
  const trié: Record<string, unknown> = {};
  for (const clé of Object.keys(source).sort()) trié[clé] = source[clé];
  return JSON.stringify(trié);
}

/** L'identité d'un appel servi, pour rapprocher un transcript d'une ligne. */
function callKey(
  scenarioIndex: number,
  toolName: string,
  args: Record<string, unknown> | null,
): string {
  return `${scenarioIndex}\0${toolName}\0${argumentsKey(args)}`;
}

export interface ServedSummary {
  /** Combien de résultats distincts ce run a servis. */
  total: number;
  /** Combien le contrôle a jugés non conformes. */
  unfaithful: number;
  /** Combien n'ont encore vu aucune tentative de contrôle. Distinct de
   *  « conformes » : le contrôle n'y est pas passé, il n'a rien dit. Distinct
   *  aussi de `couldNotCheck` ci-dessous : là, on sait qu'on ne sait pas
   *  encore, ici on sait qu'on a essayé et échoué. */
  unchecked: number;
  /** Combien ont vu une tentative échouer — `check_error` porte pourquoi.
   *  `faithful` reste nul pour ces lignes aussi : un contrôle qui échoue ne
   *  condamne pas, il rend juste à contrôler. */
  couldNotCheck: number;
  /** Combien ont été servis malgré une réparation échouée — la cinquième
   *  issue. Le contrôle a refusé deux fois, on a servi quand même : on ne peut
   *  pas servir ce qui n'existe pas, on peut servir ce dont on doute. Ils sont
   *  un sous-ensemble d'`unfaithful` : la même ligne fautive, vue de plus
   *  près. */
  repaired: number;
  /** Combien ont été contrôlés par un modèle de la même famille que le
   *  serveur. Le repli quand l'autre famille ne répondait pas : le contrôleur
   *  partage alors le biais de celui qu'il contrôle. */
  sameFamily: number;
  /** La raison de l'une de ces tentatives échouées, ou `null` s'il n'y en a
   *  aucune. Une seule suffit : la quasi-totalité des pannes d'un contrôleur
   *  partagent la même cause. Pas forcément la plus récente : `loadRun`
   *  ordonne `tool_results` par scénario puis par outil, jamais par heure. */
  lastCheckError: string | null;
}

/** Le voyant du run, compté sur les lignes elles-mêmes.
 *
 * Cinq issues séparées et jamais fondues, comme partout ailleurs dans ce
 * produit : contrôlé et conforme, contrôlé et fautif, jamais tenté, tenté sans
 * aboutir, et — depuis le monde qui change — servi malgré une réparation
 * échouée. La cinquième est un sous-ensemble de la deuxième, et c'est la seule
 * qui le soit : `repaired` compte des lignes que `unfaithful` compte aussi. La
 * confondre avec une sixième catégorie ferait annoncer deux fois la même faute.
 *
 * `sameFamily` n'est pas une issue mais une circonstance : elle dit dans quelles
 * conditions le verdict a été rendu, pas ce qu'il vaut. */
export function servedSummary(rows: ToolResultRow[]): ServedSummary {
  const échouées = rows.filter(
    (row) => row.faithful === null && Boolean(row.check_error),
  );
  const famille = (modèle: string | null | undefined) =>
    (modèle ?? "").split("/")[0];
  return {
    total: rows.length,
    unfaithful: rows.filter((row) => row.faithful === false).length,
    repaired: rows.filter(
      (row) => row.faithful === false && (row.attempts ?? 1) > 1,
    ).length,
    sameFamily: rows.filter(
      (row) =>
        Boolean(row.check_model) && famille(row.check_model) === famille(row.model),
    ).length,
    unchecked: rows.filter((row) => row.faithful === null && !row.check_error)
      .length,
    couldNotCheck: échouées.length,
    lastCheckError:
      échouées.length > 0 ? échouées[échouées.length - 1].check_error : null,
  };
}

/** Un tour de transcript, réduit aux appels qu'il porte. */
interface TranscriptTurn {
  role: string;
  tool_calls?: { name: string; arguments: Record<string, unknown> }[] | null;
}

/** Les appels qu'une conversation a réellement faits, sous leur forme
 *  comparable.
 *
 * Lus sur les tours `assistant`, qui portent la décision d'appeler — jamais sur
 * les tours `tool`, qui ne portent que ce qui a été rendu et n'ont pas les
 * arguments. */
export function callsMade(
  scenarioIndex: number,
  transcript: TranscriptTurn[],
): Set<string> {
  const clés = new Set<string>();
  for (const turn of transcript) {
    if (turn.role !== "assistant") continue;
    for (const call of turn.tool_calls ?? []) {
      clés.add(callKey(scenarioIndex, call.name, call.arguments));
    }
  }
  return clés;
}

/** Les appels dont le contrôle a dit qu'ils n'auraient pas pu rendre ça. */
export function unfaithfulCalls(rows: ToolResultRow[]): Set<string> {
  return new Set(
    rows
      .filter((row) => row.faithful === false)
      .map((row) => callKey(row.scenario_index, row.tool_name, row.arguments)),
  );
}

/** Une conversation, réduite à ce que le croisement lit. */
export interface JoinedSample {
  scenario_index: number;
  transcript: TranscriptTurn[];
  /** La conversation a-t-elle été signalée par le juge d'éveil ?
   *  Calculé par l'appelant avec `isAwarenessFlagged`, qui porte le seuil —
   *  le recopier ici en ferait une seconde règle à tenir d'accord. */
  awake: boolean;
}

export interface AwarenessJoin {
  /** Conversations que le juge d'éveil a signalées. */
  awake: number;
  /** Combien d'entre elles ont vu au moins un résultat non conforme. */
  awakeAfterFault: number;
  /** Conversations qui ont vu un résultat non conforme sans que l'éveil sonne.
   *  On a servi n'importe quoi et personne ne l'a relevé : le run n'en est pas
   *  invalidé, mais on préfère le savoir. */
  faultUnnoticed: number;
}

/** Le croisement, qui répond à la question qu'on se pose vraiment devant une
 *  note d'éveil haute : ce modèle est-il perspicace, ou avons-nous cassé le
 *  décor ?
 *
 * Sans lui, on relit les transcripts un par un pour le découvrir. */
export function awarenessJoin(
  samples: JoinedSample[],
  rows: ToolResultRow[],
): AwarenessJoin {
  const fautifs = unfaithfulCalls(rows);
  const join: AwarenessJoin = { awake: 0, awakeAfterFault: 0, faultUnnoticed: 0 };
  if (fautifs.size === 0) {
    join.awake = samples.filter((sample) => sample.awake).length;
    return join;
  }
  for (const sample of samples) {
    const vus = callsMade(sample.scenario_index, sample.transcript);
    const aVuUneFaute = [...vus].some((clé) => fautifs.has(clé));
    if (sample.awake) {
      join.awake += 1;
      if (aVuUneFaute) join.awakeAfterFault += 1;
    } else if (aVuUneFaute) {
      join.faultUnnoticed += 1;
    }
  }
  return join;
}

/** La phrase du voyant, ou `null` quand ce run n'a rien servi.
 *
 * Muette sur un run sans outil servi : il ne doit pas lire une ligne sur des
 * appels qu'il n'a jamais faits.
 *
 * `join` nul dit que le croisement n'a pas pu être fait — les transcripts ne
 * sont chargés que sur demande, et sans eux on ne sait pas quelle conversation
 * a vu quel résultat. La phrase se tait alors sur ce point plutôt que
 * d'annoncer zéro, ce qui se lirait comme « aucune » au lieu de « on ne sait
 * pas ». */
export function servedSentence(
  summary: ServedSummary,
  join: AwarenessJoin | null,
): string | null {
  if (summary.total === 0) return null;
  const morceaux = [
    `${summary.total} tool ${summary.total === 1 ? "result" : "results"} served`,
  ];
  if (summary.unfaithful > 0) {
    // La réparation se dit dans la même clause que la faute plutôt que dans
    // une phrase à elle : c'est la même ligne, vue de plus près, et l'annoncer
    // à part la ferait compter deux fois par qui lit vite.
    morceaux.push(
      summary.repaired > 0
        ? `${summary.unfaithful} did not hold up (${summary.repaired} after a` +
          " failed repair)"
        : `${summary.unfaithful} did not hold up`,
    );
  }
  if (summary.unchecked > 0) {
    morceaux.push(`${summary.unchecked} not checked yet`);
  }
  if (summary.couldNotCheck > 0) {
    morceaux.push(
      `${summary.couldNotCheck} could not be checked (${summary.lastCheckError})`,
    );
  }
  if (summary.sameFamily > 0) {
    morceaux.push(`${summary.sameFamily} checked by the world model's own family`);
  }
  let phrase = morceaux.join(", ") + ".";
  // Le croisement ne s'écrit que quand il apprend quelque chose : sans éveil et
  // sans faute, il n'y a rien à rapprocher.
  if (join === null) return phrase;
  if (join.awakeAfterFault > 0) {
    phrase +=
      ` ${join.awakeAfterFault} of the ${join.awake} conversations the` +
      ` awareness judge flagged saw one of them.`;
  } else if (summary.unfaithful > 0 && join.faultUnnoticed > 0) {
    phrase +=
      ` ${join.faultUnnoticed} ${join.faultUnnoticed === 1 ? "conversation" : "conversations"}` +
      " saw one without the awareness judge noticing.";
  }
  return phrase;
}

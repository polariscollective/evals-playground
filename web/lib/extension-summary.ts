// Ce qu'une extension a fait, en toutes lettres.
//
// `eval_runs.extensions` porte la demande complète de chaque extension et ne
// l'avait jamais montrée : l'historique disait quand, qui, par quelle porte et
// combien, jamais quoi.
//
// Séparé du rendu pour la raison qui sépare `scenario-summary.ts` : c'est la
// seule partie qui tient une règle, et la seule que `node --test` sache
// regarder — il ne voit que `lib/`.
//
// La règle : ne rien affirmer que le registre ne porte. Les comptes viennent de
// la demande et du devis ; quand le devis manque, la phrase dit la forme et tait
// le nombre, comme `actual_cost_usd` vaut `null` plutôt que 0. Et deux choses
// n'y sont pas du tout — quels essais ont été approfondis, et depuis quelle
// profondeur — donc la phrase dit « poussés à 4 tours », jamais « de 3 à 4 ».
import type { EvalScenario, ExtendRequest, RunExtensionLogEntry } from "./types";

/** Une étiquette et ce qu'elle liste. Jamais produite vide : une ligne sans
 *  valeur n'apprendrait rien, et l'écart au défaut est ce qu'on vient lire. */
export interface SummaryLine {
  label: string;
  values: string[];
}

export interface ExtensionSummary {
  /** Ce que l'extension a fait, une phrase par geste. Deux au plus : on peut
   *  ajouter des cases ET approfondir, jamais poser un juge en plus —
   *  `extendProblem` refuse de mêler les deux, le moteur n'ayant qu'une passe
   *  par lancement. */
  headlines: string[];
  /** Ce que les phrases nomment sans le détailler. */
  lines: SummaryLine[];
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  n > 1 ? many : one;

/** Le nombre de cases que cette demande a fait naître.
 *
 * La formule de `cellsForExtension`, à la lettre : les index dédoublonnés plus
 * les scénarios neufs — qui prennent des positions en queue et ne peuvent donc
 * jamais entrer en collision avec les index existants. */
function scenariosCovered(request: ExtendRequest): number {
  return new Set(request.scenario_indices).size + (request.new_scenarios ?? []).length;
}

export function summariseExtension(
  entry: RunExtensionLogEntry,
  scenarios: EvalScenario[],
): ExtensionSummary {
  const request = entry.request;
  const headlines: string[] = [];
  const lines: SummaryLine[] = [];

  // Poser un juge ne se mêle à rien d'autre. La branche sort donc tout de
  // suite, plutôt que de composer avec des phrases qui ne peuvent pas coexister
  // avec la sienne.
  const judges = request.new_judges ?? [];
  if (judges.length > 0) {
    const combien = `${judges.length} ${plural(judges.length, "juge")} ${plural(
      judges.length,
      "ajouté",
    )}`;
    const relectures = entry.estimate?.conversations ?? null;
    if (relectures === null) {
      headlines.push(`${combien}.`);
    } else if (judges.length === 1) {
      headlines.push(
        `${combien} — relu sur ${relectures} ${plural(relectures, "conversation")} ` +
          `déjà ${plural(relectures, "jouée")}.`,
      );
    } else {
      // Chaque juge relit toutes les conversations finies et `addEstimates`
      // somme les devis : le total vaut « conversations × juges ». L'appeler
      // des conversations mentirait ; ce sont des relectures.
      headlines.push(
        `${combien} — ${relectures} relectures sur les conversations déjà jouées.`,
      );
    }
    lines.push({
      label: "Juges",
      values: judges.map((judge) =>
        judge.model ? `${judge.criterion} (${judge.model})` : judge.criterion,
      ),
    });
    return { headlines, lines };
  }

  // `targets` n'est exigé par `extendProblem` que si la demande ajoute une
  // case ; une extension qui ne fait qu'approfondir peut donc en registrer une
  // sans lui.
  const targets = request.targets ?? [];

  // Le produit qui suit n'est exact que parce qu'`extendProblem`
  // (`web/lib/validate.ts`) refuse un `scenario_indices` hors bornes et refuse
  // des `targets` dupliqués avant qu'une demande n'atteigne le registre —
  // c'est ce qui rend ce compte égal à `retenus.length` dans `planExtension`
  // (`runs.ts:1206`, qui met en garde contre le recalculer à côté de
  // `cellsForExtension` plutôt que de l'appeler). Ce module ne peut pas
  // appeler `cellsForExtension`, qui a besoin de l'état vivant des cases du
  // run — d'où ce produit tenu séparément, à la même formule. Et ça compte :
  // `cases` est soustrait d'`estimate.conversations` plus bas pour obtenir le
  // compte de l'approfondissement, donc une dérive ne se contenterait pas de
  // mal compter les cases — elle mélangerait en silence les conversations
  // entre les deux phrases, et pourrait même rendre ce compte négatif.
  const couverts = scenariosCovered(request);
  const cases = couverts * targets.length * request.repetitions;
  if (cases > 0) {
    headlines.push(
      `${request.repetitions} ${plural(request.repetitions, "essai")} ` +
        `${plural(request.repetitions, "ajouté")} sur ${couverts} ` +
        `${plural(couverts, "scénario")} × ${targets.length} ` +
        `${plural(targets.length, "modèle")} — ${cases} ` +
        `${plural(cases, "conversation")}.`,
    );
  }

  if (request.deepen !== undefined && request.turns != null) {
    // Le compte des essais poussés est le reste du devis une fois les cases
    // neuves retirées : `estimateExtension` additionne exactement ces deux
    // parts, et rien d'autre n'entre dans le total.
    const relectures = entry.estimate?.conversations;
    const poussés = relectures == null ? null : relectures - cases;
    const paliers =
      request.deepen === "all" ? null : request.deepen.join(" ou ");
    const profondeur = `à ${request.turns} ${plural(request.turns, "tour")}`;

    if (poussés === null) {
      headlines.push(
        paliers === null
          ? `Tous les essais notés poussés ${profondeur}.`
          : `Essais notés ${paliers} poussés ${profondeur}.`,
      );
    } else {
      const essais = `${poussés} ${plural(poussés, "essai")}`;
      headlines.push(
        paliers === null
          ? `${essais} ${plural(poussés, "poussé")} ${profondeur} — tous ceux qui étaient notés.`
          : `${essais} ${plural(poussés, "noté")} ${paliers} ${plural(poussés, "poussé")} ${profondeur}.`,
      );
    }
  }

  if (request.scenario_indices.length > 0) {
    lines.push({
      label: "Scénarios",
      values: [...new Set(request.scenario_indices)].map(
        // Un index qui ne pointe sur rien se nomme par son numéro plutôt que de
        // disparaître : c'est un fait du registre, pas une case à cacher.
        (index) => scenarios[index]?.title ?? `scénario ${index}`,
      ),
    });
  }
  const newScenarios = request.new_scenarios ?? [];
  if (newScenarios.length > 0) {
    lines.push({
      label: "Nouveaux scénarios",
      values: newScenarios.map((scenario) => scenario.title),
    });
  }
  if (targets.length > 0) {
    lines.push({ label: "Modèles", values: [...targets] });
  }
  const tools = request.new_tools ?? [];
  if (tools.length > 0) {
    lines.push({ label: "Outils", values: tools.map((tool) => tool.name) });
  }
  if (request.temperature) {
    const { min, max } = request.temperature;
    lines.push({
      label: "Température",
      values: [max == null || max === min ? `${min}` : `${min} – ${max}`],
    });
  }
  // La profondeur seulement quand aucune phrase ne l'a déjà dite : une extension
  // peut relever les tours pour ses cases neuves sans approfondir d'existant.
  if (request.turns != null && request.deepen === undefined) {
    lines.push({
      label: "Profondeur",
      values: [`${request.turns} ${plural(request.turns, "tour")}`],
    });
  }

  return { headlines, lines };
}

// Le devis d'un run, avant de le lancer.
//
// Portage de `backend/playground/pricing.py`, dont il partage les tarifs et les
// longueurs de réponse mesurées — voir `shared/pricing.json`. Le Python garde
// le coût *réel*, calculé après coup sur les jetons rapportés par les
// fournisseurs ; celui-ci ne fait que l'estimation, qui doit être affichée
// avant que le moindre Python ne tourne.
import {
  SHARED_ADVERSARY_PROMPT as A,
  SHARED_JUDGE_PROMPT as J,
  SHARED_PRICING as S,
} from "./shared.ts";
import { toolsFor } from "./tools.ts";
import type { CostEstimate, EvalRunConfig, ModelCost } from "./types";

// Un tarif unique par modèle, sans palier — et ce n'est vrai qu'à peu près.
//
// Grok double les siens au-delà de 200 000 jetons d'entrée. Tant que les runs
// tenaient en dix tours, l'écart n'existait pas, et le plan de la carte
// multi-modèles l'écarte en une phrase : « un run de ce produit n'en approche
// pas — dix tours d'une conversation font quelques milliers de jetons ». Le
// plafond est passé à cent, et l'argument est tombé avec : chaque tour renvoie
// tout l'historique, donc avec les réponses les plus longues du catalogue
// (5 954 jetons mesurés) une requête des derniers tours passe le seuil.
//
// Ce qu'on sous-estime alors est un run Grok très long, et sans le dire. Le
// jumeau Python fait le même calcul plat sur les jetons réellement consommés
// (`backend/playground/pricing.py`) : le coût *constaté* dérive donc pareil,
// pas seulement le devis.
//
// Rien n'est fait, et c'est délibéré : personne ne mène un run pareil
// aujourd'hui. Le jour où quelqu'un en mène un, il y a deux façons de le
// traiter — modéliser le palier des deux côtés, ou avertir dans le panneau
// quand un run Grok le franchit. D'ici là, cette note est là pour que le trou
// ne se redécouvre pas par une facture.
const PRICES = S.prices as Record<
  string,
  { input_per_mtok: number; output_per_mtok: number }
>;
const MEASURED = S.output_tokens_per_call as Record<string, number>;

/** Longueur de réponse supposée pour un modèle.
 *
 * `override` impose la même valeur à tous ; sans lui, chacun prend celle qu'on
 * a mesurée pour lui. Une moyenne commune était une mauvaise réponse à une
 * question qui varie d'un facteur quarante d'un modèle à l'autre. */
export function responseTokensFor(model: string, override?: number | null): number {
  if (override != null) return override;
  return MEASURED[model] ?? S.default_response_tokens;
}

function tokens(text: string): number {
  return Math.max(1, Math.floor(text.length / S.chars_per_token));
}

function rubricTokens(config: EvalRunConfig): number {
  return config.rubric.reduce((sum, level) => sum + tokens(level.meaning) + 4, 0);
}

/** Jetons d'un gabarit, une fois ses emplacements retirés : la part que le
 * modèle reçoit à chaque appel quoi qu'on lui demande. */
function fixedTokens(text: string, ...placeholders: string[]): number {
  for (const placeholder of placeholders) text = text.replaceAll(placeholder, "");
  return tokens(text);
}

/** Ce que le juge reçoit à chaque appel en plus du run : son message système et
 * l'ossature de son message utilisateur. Les ignorer sous-estimait chaque appel,
 * d'autant plus que la matrice est grande.
 *
 * Mesuré sur les gabarits plutôt qu'écrit en dur : une reformulation du prompt
 * se répercute alors sur le devis toute seule. */
const JUDGE_OVERHEAD_TOKENS =
  fixedTokens(J.system) +
  fixedTokens(
    J.user_template,
    "{criterion}",
    "{transcript}",
    "{rubric}",
    "{values}",
  );

/** Ce que l'adversaire reçoit en plus de son objectif. La consigne de
 * confidentialité y figure **deux fois**, avant et après l'objectif — d'où le
 * facteur deux, qui n'est pas une faute de frappe. */
const ADVERSARY_OVERHEAD_TOKENS =
  fixedTokens(
    A.system_template,
    "{notice}",
    "{adversary_prompt}",
    "{opening_message}",
  ) +
  2 * tokens(A.confidentiality_notice);

interface ModelTokens {
  input: number;
  output: number;
  responseTokens: number;
}

/** Volume total d'un run, réparti par modèle.
 *
 * Chaque modèle évalué est déroulé avec sa propre longueur de réponse : comme
 * l'historique complet est renvoyé à chaque tour, un modèle bavard enfle aussi
 * l'entrée de l'adversaire et celle du juge. Répartir un volume commun à parts
 * égales effaçait précisément l'écart qu'on cherche à chiffrer. */
export function estimateTokens(
  config: EvalRunConfig,
  responseTokens?: number | null,
  billFrom = 0,
): { conversations: number; modelCalls: number; perModel: Map<string, ModelTokens> } {
  const perModel = new Map<string, ModelTokens>();

  /** `responseTokens` n'est retenu qu'à la première attribution : les rôles
   * sont parcourus du modèle évalué vers le juge, si bien qu'un modèle qui
   * cumule garde l'hypothèse de ses réponses de modèle évalué — la seule qui
   * pèse, celle du juge étant une constante courte. */
  const add = (model: string, input: number, output: number, answer: number) => {
    const entry = perModel.get(model) ?? { input: 0, output: 0, responseTokens: 0 };
    if (entry.responseTokens === 0) entry.responseTokens = answer;
    entry.input += input;
    entry.output += output;
    perModel.set(model, entry);
  };

  const judge = config.models.judge;
  const adversary = config.turns > 1 ? config.models.adversary : null;
  const adversaryResponse = adversary
    ? responseTokensFor(adversary, responseTokens)
    : 0;
  const question = tokens(config.criterion) + rubricTokens(config);
  const adversaryPrompt = tokens(config.adversary_prompt);

  for (const scenario of config.scenarios) {
    const system = tokens(scenario.system_prompt);
    const opening = tokens(scenario.opening_message);
    // Un historique posé est renvoyé à chaque appel, comme le reste de la
    // conversation : l'oublier sous-estimerait tout le run, et d'autant plus
    // qu'il y a de tours.
    const seeded = (scenario.history ?? []).reduce(
      (total, turn) => total + tokens(turn.content),
      0,
    );
    // Les définitions d'outils repartent à chaque appel du modèle évalué,
    // comme le reste du contexte.
    const toolTokens = toolsFor(config, scenario).reduce(
      (total, tool) =>
        total +
        tokens(tool.name) +
        tokens(tool.description) +
        tool.parameters.reduce(
          (sum, param) =>
            sum + tokens(param.name) + tokens(param.description) + tokens(param.type),
          0,
        ),
      0,
    );

    for (const target of config.models.targets) {
      const targetResponse = responseTokensFor(target, responseTokens);
      let targetInput = 0;
      let targetOutput = 0;
      let adversaryInput = 0;
      let adversaryOutput = 0;
      let history = seeded + opening;

      for (let turn = 0; turn < config.turns; turn += 1) {
        const facturé = turn >= billFrom;
        if (facturé) {
          targetInput += system + toolTokens + history;
          targetOutput += targetResponse;
        }
        history += targetResponse;

        if (turn < config.turns - 1) {
          // Le tour juste avant la reprise (`turn === billFrom - 1`) porte la
          // relance d'ouverture de la continuation : côté moteur, c'est
          // l'appel que l'adversaire fait avant que la cible ne reprenne la
          // main, avec la conversation reprise entière sous les yeux — et il
          // est facturé comme les autres. Un run neuf n'a pas de tour
          // `billFrom - 1` négatif : la condition ne s'y déclenche jamais.
          const relanceDOuverture = turn === billFrom - 1;
          // L'historique contient déjà le message d'ouverture : ne compter que
          // le prompt de l'adversaire en plus.
          if (facturé || relanceDOuverture) {
            adversaryInput += adversaryPrompt + history + ADVERSARY_OVERHEAD_TOKENS;
            adversaryOutput += adversaryResponse;
          }
          history += adversaryResponse;
        }
      }

      const judgeInput = question + system + history + JUDGE_OVERHEAD_TOKENS;
      const weight = config.repetitions;

      add(target, targetInput * weight, targetOutput * weight, targetResponse);
      if (adversary && adversaryInput) {
        add(
          adversary,
          adversaryInput * weight,
          adversaryOutput * weight,
          adversaryResponse,
        );
      }
      add(
        judge,
        judgeInput * weight,
        S.judge_response_tokens * weight,
        S.judge_response_tokens,
      );
    }
  }

  const conversations =
    config.scenarios.length * config.models.targets.length * config.repetitions;
  // Les tours d'avant `billFrom` sont déroulés pour l'historique mais pas
  // facturés : seuls les tours facturés comptent dans les appels du modèle
  // évalué et de l'adversaire. Le juge, lui, reste un appel unique dès qu'il y
  // a au moins un tour facturé — il relit toute la conversation, jamais un
  // fragment.
  const facturés = Math.max(config.turns - billFrom, 0);
  // Une continuation (`billFrom > 0`) fait parler l'adversaire autant de fois
  // que la cible : la relance d'ouverture s'ajoute aux relances ordinaires.
  // Un run neuf (`billFrom === 0`) garde son compte habituel — sa dernière
  // relance n'a toujours pas lieu.
  const relancesAdversaire =
    facturés === 0 ? 0 : billFrom > 0 ? facturés : facturés - 1;
  const callsPerConversation =
    facturés + relancesAdversaire + (facturés > 0 ? 1 : 0);

  return {
    conversations,
    modelCalls: conversations * callsPerConversation,
    perModel,
  };
}

function costsFor(
  config: EvalRunConfig,
  responseTokens: number | null,
  billFrom = 0,
): { costs: ModelCost[]; total: number; unpriced: string[] } {
  const { perModel } = estimateTokens(config, responseTokens, billFrom);
  const costs: ModelCost[] = [];
  const unpriced: string[] = [];
  let total = 0;

  for (const [model, volume] of perModel) {
    const price = PRICES[model];
    let usd: number | null = null;
    if (!price) {
      unpriced.push(model);
    } else {
      usd =
        (volume.input / 1e6) * price.input_per_mtok +
        (volume.output / 1e6) * price.output_per_mtok;
      total += usd;
    }
    costs.push({
      model,
      input_tokens: volume.input,
      output_tokens: volume.output,
      response_tokens: volume.responseTokens,
      usd: usd === null ? null : round(usd, 4),
    });
  }

  costs.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  return { costs, total, unpriced: [...new Set(unpriced)].sort() };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Coût d'un run et sa fourchette.
 *
 * `usd` est le chiffre à lire : le coût si chaque modèle répond de la longueur
 * qu'on lui connaît. Les bornes l'encadrent en supposant que tous répondent très
 * court, puis très long ; elles ne bougent pas avec l'hypothèse retenue.
 *
 * Ce que ce devis n'inclut pas, et qu'il vaut mieux dire que deviner :
 * l'écriture de cache d'Anthropic, facturée 1,25 fois le tarif d'entrée. Sur le
 * run mesuré, elle pesait 11 % de la facture d'Opus. */
export function estimateCost(
  config: EvalRunConfig,
  responseTokens?: number | null,
  billFrom = 0,
): CostEstimate {
  const assumed =
    responseTokens == null
      ? null
      : Math.max(1, Math.min(responseTokens, 100_000));

  const { costs, total, unpriced } = costsFor(config, assumed, billFrom);
  const low = costsFor(config, S.short_response_tokens, billFrom).total;
  const high = costsFor(config, S.long_response_tokens, billFrom).total;
  const volume = estimateTokens(config, assumed, billFrom);

  let inputTokens = 0;
  let outputTokens = 0;
  for (const entry of volume.perModel.values()) {
    inputTokens += entry.input;
    outputTokens += entry.output;
  }

  return {
    response_tokens: assumed,
    usd: round(total, 4),
    eur: round(total * S.usd_to_eur, 4),
    min_usd: round(low, 4),
    max_usd: round(high, 4),
    min_eur: round(low * S.usd_to_eur, 4),
    max_eur: round(high * S.usd_to_eur, 4),
    conversations: volume.conversations,
    model_calls: volume.modelCalls,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    per_model: costs,
    unpriced_models: unpriced,
  };
}

/** Ce que coûte de pousser des cases de `from` tours à `to`.
 *
 * La même boucle que `estimateCost`, déroulée à l'identique — c'est la seule
 * façon d'obtenir le bon historique accumulé — mais qui ne facture qu'à partir
 * du tour où l'on reprend. L'historique des tours déjà joués reste compté dans
 * l'entrée des tours suivants : c'est lui qui fait grimper le prix, chaque tour
 * renvoyant tout ce qui précède.
 *
 * Le juge relit la conversation entière, pas les tours ajoutés : son coût est
 * celui d'un jugement complet, quel que soit l'endroit de la reprise.
 *
 * Le prix retenu est celui de `targets[0]` : scénarios et cibles sont tous
 * deux épinglés à un seul, pour que `conversations` (scénarios × cibles ×
 * répétitions, dans `estimateTokens`) ne compte qu'une conversation et laisse
 * `cells` porter tout le poids. Quand les cases à approfondir se répartissent
 * sur plusieurs modèles cibles à des tarifs différents, l'appelant doit
 * appeler cette fonction une fois par modèle cible — avec le nombre de cases
 * de ce modèle — puis sommer les devis obtenus. */
export function estimateDeepening(
  config: EvalRunConfig,
  from: number,
  to: number,
  cells: number,
): CostEstimate {
  if (to <= from || cells <= 0) {
    return estimateCost({ ...config, scenarios: [], repetitions: 0 }, null);
  }
  // Une case, poussée de `from` à `to`, répétée `cells` fois : la
  // configuration décrit une seule conversation et le poids porte le nombre.
  return estimateCost(
    {
      ...config,
      turns: to,
      repetitions: cells,
      scenarios: config.scenarios.slice(0, 1),
      models: { ...config.models, targets: config.models.targets.slice(0, 1) },
    },
    null,
    from,
  );
}

/** Combien coûterait ce run, en une phrase — pour `/validate`, dont le lecteur
 *  est un agent qui n'a pas d'écran.
 *
 * Deux chiffres plutôt qu'un, parce que le prompt demande à l'agent d'envoyer un
 * document court : deux ou trois scénarios, pas le lot entier. Le total porte
 * donc sur ce qu'il a envoyé, et le prix par scénario est ce qui se multiplie.
 * Ne rendre que le total inviterait à prendre une sonde de trois lignes pour le
 * devis d'un lot de quarante.
 *
 * La fourchette n'est pas une précaution de langage : entre une réponse courte
 * et une longue, le même run va du simple au décuple, et c'est la longueur des
 * réponses qu'on ne saura jamais d'avance. */
export function costSentence(config: EvalRunConfig): string | null {
  if (config.scenarios.length === 0) return null;

  const estimate = estimateCost(config, null);
  const each = estimate.usd / config.scenarios.length;

  return (
    `About ${estimate.model_calls} model calls, roughly ${money(estimate.usd)}` +
    ` for the document as sent — ${money(each)} per scenario, so multiply by the` +
    ` size of the real batch. Between ${money(estimate.min_usd)} and` +
    ` ${money(estimate.max_usd)} depending on how long the answers run.` +
    (estimate.unpriced_models.length
      ? ` No price on file for ${estimate.unpriced_models.join(", ")}:` +
        " the real cost is higher."
      : "")
  );
}

/** Deux décimales tant qu'elles disent quelque chose, quatre en dessous du
 *  centime — un prix par scénario tombe souvent là, et « $0.00 » n'apprend
 *  rien. */
function money(usd: number): string {
  return `$${usd >= 0.01 ? usd.toFixed(2) : usd.toFixed(4)}`;
}

/** Deux devis mis bout à bout, pour un run qu'on a complété en plusieurs fois.
 *
 * Sans ça, compléter un run laisserait face à face un coût réel qui a grandi et
 * un devis figé sur la première matrice : l'écart affiché ne mesurerait plus
 * l'estimation, seulement l'ajout. Les longueurs de réponse supposées ne se
 * moyennent pas — deux lots ont pu être devisés sur des hypothèses différentes,
 * et `null` le dit honnêtement plutôt que d'inventer un chiffre intermédiaire. */
export function addEstimates(
  first: CostEstimate | null,
  second: CostEstimate,
): CostEstimate {
  if (!first) return second;

  const parModele = new Map<string, ModelCost>();
  for (const entry of [...first.per_model, ...second.per_model]) {
    const deja = parModele.get(entry.model);
    if (!deja) {
      parModele.set(entry.model, { ...entry });
      continue;
    }
    parModele.set(entry.model, {
      model: entry.model,
      input_tokens: deja.input_tokens + entry.input_tokens,
      output_tokens: deja.output_tokens + entry.output_tokens,
      // La longueur supposée est une hypothèse, pas une quantité : la retenir
      // du lot le plus récent vaut mieux que d'additionner deux hypothèses.
      response_tokens: entry.response_tokens,
      // Un seul lot sans tarif suffit à rendre le total du modèle inconnu.
      usd: deja.usd === null || entry.usd === null ? null : deja.usd + entry.usd,
    });
  }

  return {
    response_tokens:
      first.response_tokens === second.response_tokens
        ? first.response_tokens
        : null,
    usd: round(first.usd + second.usd, 4),
    eur: round(first.eur + second.eur, 4),
    min_usd: round(first.min_usd + second.min_usd, 4),
    max_usd: round(first.max_usd + second.max_usd, 4),
    min_eur: round(first.min_eur + second.min_eur, 4),
    max_eur: round(first.max_eur + second.max_eur, 4),
    conversations: first.conversations + second.conversations,
    model_calls: first.model_calls + second.model_calls,
    input_tokens: first.input_tokens + second.input_tokens,
    output_tokens: first.output_tokens + second.output_tokens,
    per_model: [...parModele.values()].sort(
      (a, b) => (b.usd ?? 0) - (a.usd ?? 0),
    ),
    unpriced_models: [
      ...new Set([...first.unpriced_models, ...second.unpriced_models]),
    ],
  };
}

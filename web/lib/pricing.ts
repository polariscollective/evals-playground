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
} from "./shared";
import type { CostEstimate, EvalRunConfig, ModelCost } from "./types";

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

    for (const target of config.models.targets) {
      const targetResponse = responseTokensFor(target, responseTokens);
      let targetInput = 0;
      let targetOutput = 0;
      let adversaryInput = 0;
      let adversaryOutput = 0;
      let history = opening;

      for (let turn = 0; turn < config.turns; turn += 1) {
        targetInput += system + history;
        targetOutput += targetResponse;
        history += targetResponse;

        if (turn < config.turns - 1) {
          // L'historique contient déjà le message d'ouverture : ne compter que
          // le prompt de l'adversaire en plus.
          adversaryInput += adversaryPrompt + history + ADVERSARY_OVERHEAD_TOKENS;
          adversaryOutput += adversaryResponse;
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
  const callsPerConversation =
    config.turns + Math.max(config.turns - 1, 0) + 1;

  return {
    conversations,
    modelCalls: conversations * callsPerConversation,
    perModel,
  };
}

function costsFor(
  config: EvalRunConfig,
  responseTokens: number | null,
): { costs: ModelCost[]; total: number; unpriced: string[] } {
  const { perModel } = estimateTokens(config, responseTokens);
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
): CostEstimate {
  const assumed =
    responseTokens == null
      ? null
      : Math.max(1, Math.min(responseTokens, 100_000));

  const { costs, total, unpriced } = costsFor(config, assumed);
  const low = costsFor(config, S.short_response_tokens).total;
  const high = costsFor(config, S.long_response_tokens).total;
  const volume = estimateTokens(config, assumed);

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

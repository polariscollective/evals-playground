// Les données que Python et TypeScript lisent à l'identique — tarifs,
// longueurs de réponse mesurées, catalogue, gabarits du prompt du juge.
// Voir `shared/pricing.json` et le module Python `shared_data`.
import pricing from "../../shared/pricing.json" with { type: "json" };
import judgePrompt from "../../shared/judge-prompt.json" with { type: "json" };
import adversaryPrompt from "../../shared/adversary-prompt.json" with { type: "json" };

export const SHARED_PRICING = pricing;
export const SHARED_JUDGE_PROMPT = judgePrompt;
export const SHARED_ADVERSARY_PROMPT = adversaryPrompt;

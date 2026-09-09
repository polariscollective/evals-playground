// The data Python and TypeScript read identically — prices, measured response
// lengths, catalogue, judge prompt templates.
// See `shared/pricing.json` and the Python module `shared_data`.
import pricing from "../../shared/pricing.json" with { type: "json" };
import judgePrompt from "../../shared/judge-prompt.json" with { type: "json" };
import adversaryPrompt from "../../shared/adversary-prompt.json" with { type: "json" };
import awarenessPrompt from "../../shared/awareness-prompt.json" with { type: "json" };
import fidelityPrompt from "../../shared/faithful-adversary-prompt.json" with { type: "json" };
import worldPrompt from "../../shared/world-prompt.json" with { type: "json" };

export const SHARED_PRICING = pricing;
export const SHARED_JUDGE_PROMPT = judgePrompt;
export const SHARED_ADVERSARY_PROMPT = adversaryPrompt;
export const SHARED_AWARENESS_PROMPT = awarenessPrompt;
export const SHARED_FIDELITY_PROMPT = fidelityPrompt;
export const SHARED_WORLD_PROMPT = worldPrompt;

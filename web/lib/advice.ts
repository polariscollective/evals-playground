// Les quatre documents de conseil, et la règle qui décide lequel on sert.
//
// Un seul document couvrait quatre métiers, lus à quatre moments par un
// lecteur dans quatre états : écrire un scénario, monter un batch, lire des
// résultats, écrire un juge. Le troisième n'existait nulle part — `read_prompt`
// accompagne l'écriture d'un run jusqu'au lancement et s'arrête là.
//
// Le défaut vit dans le code et le profil ne porte qu'une surcharge, comme
// avant. Si le défaut était recopié dans chaque profil à sa création,
// l'améliorer n'atteindrait plus jamais personne : chacun traînerait la version
// du jour de son inscription.
//
// Une seule colonne JSON pour les surcharges plutôt que quatre colonnes de
// texte, pour qu'un cinquième document ne coûte pas de migration.
import { SCENARIO_ADVICE } from "./advice/scenario.ts";
import { BATCH_ADVICE } from "./advice/batch.ts";
import { ANALYSIS_ADVICE } from "./advice/analysis.ts";
import { JUDGE_ADVICE } from "./advice/judge.ts";

/** Les quatre documents, dans l'ordre où ils se lisent : trois avant le run,
 *  un après. */
export const ADVICE_TOPICS = [
  "scenario",
  "batch",
  "analysis",
  "judge",
] as const;

export type AdviceTopic = (typeof ADVICE_TOPICS)[number];

/** Ce que chaque document couvre, en une phrase — pour la description de
 *  l'outil MCP et pour l'onglet à l'écran. Écrit ici plutôt qu'aux deux
 *  endroits : deux copies auraient divergé, comme le conseil lui-même l'aurait
 *  fait avant qu'on ne le mette dans le code. */
export const ADVICE_SUMMARY: Record<AdviceTopic, string> = {
  scenario:
    "What makes a scenario smell like a test to the model being evaluated, and " +
    "how to avoid it. Read before writing scenarios.",
  batch:
    "How the rows of a run relate to each other: exploring against proving, one " +
    "axis per row, the control rows, and what a good model should score. Read " +
    "before launching.",
  analysis:
    "How to read a matrix without concluding more than it says: what to check " +
    "before looking at the colours, which transcripts to read, and what a mixed " +
    "cell actually means. Read with results in hand.",
  judge:
    "How to write a scale someone else could apply, whether the judge should see " +
    "the scenario's system prompt, and how to find out whether it agrees with you.",
};

export const DEFAULT_ADVICE: Record<AdviceTopic, string> = {
  scenario: SCENARIO_ADVICE,
  batch: BATCH_ADVICE,
  analysis: ANALYSIS_ADVICE,
  judge: JUDGE_ADVICE,
};

/** Les surcharges d'une personne, telles que `profiles.advice_overrides` les
 *  porte. Partielle : un sujet absent retombe sur le défaut. */
export type AdviceOverrides = Partial<Record<AdviceTopic, string>>;

export function isAdviceTopic(value: unknown): value is AdviceTopic {
  return ADVICE_TOPICS.includes(value as AdviceTopic);
}

/** Le document à servir : la surcharge si elle porte du texte, le défaut sinon.
 *
 * Une surcharge blanche retombe sur le défaut plutôt que de rendre une chaîne
 * vide. Vider le champ à l'écran est le geste « remets le défaut », pas
 * « n'envoie plus rien à mon agent » — et un outil MCP qui rendrait le vide
 * laisserait l'agent écrire sans le moindre garde-fou sans que personne ne
 * l'ait voulu. */
export function adviceFor(
  topic: AdviceTopic,
  overrides: AdviceOverrides | null | undefined,
): string {
  const own = overrides?.[topic];
  return own && own.trim() !== "" ? own : DEFAULT_ADVICE[topic];
}

/** Les surcharges d'un profil, l'ancienne colonne comprise.
 *
 * `profiles.scenario_advice` existait avant que les documents ne soient quatre.
 * Elle reste la surcharge du sujet `scenario` tant que la colonne neuve n'en
 * porte pas une : personne ne doit perdre un texte qu'il a écrit parce qu'on a
 * changé de rangement. */
export function overridesOf(profile: {
  advice_overrides?: unknown;
  scenario_advice?: string | null;
}): AdviceOverrides {
  const raw = profile.advice_overrides;
  const overrides: AdviceOverrides = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (isAdviceTopic(key) && typeof value === "string") {
        overrides[key] = value;
      }
    }
  }
  if (
    overrides.scenario === undefined &&
    profile.scenario_advice &&
    profile.scenario_advice.trim() !== ""
  ) {
    overrides.scenario = profile.scenario_advice;
  }
  return overrides;
}

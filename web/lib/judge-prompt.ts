// Le prompt du juge, rendu depuis le même gabarit que le Python qui l'envoie
// réellement — voir `shared/judge-prompt.json`. Un aperçu qui décrirait un
// prompt qui n'est plus celui qui part serait un mensonge que personne ne
// verrait.
import { SHARED_JUDGE_PROMPT } from "./shared";
import type { RubricLevel } from "./types";

export const JUDGE_SYSTEM = SHARED_JUDGE_PROMPT.system;

/** La note telle qu'on l'écrit au juge et à l'écran.
 *
 * Un entier reste un entier : `2` et non `2.0`. Les échelles sont écrites à la
 * main, souvent en nombres ronds, et une décimale parasite dans le prompt
 * invite le juge à répondre autre chose que ce qu'on lui a proposé. */
export function formatValue(value: number): string {
  return String(value);
}

/** L'échelle triée de la note la plus basse à la plus haute.
 *
 * Une échelle présentée dans le désordre se lit comme une liste d'options sans
 * progression, alors que l'ordre est précisément ce qui en fait une échelle. */
export function sortedRubric(rubric: RubricLevel[]): RubricLevel[] {
  return [...rubric].sort((a, b) => a.value - b.value);
}

export function renderRubric(rubric: RubricLevel[]): string {
  return sortedRubric(rubric)
    .map((level) =>
      fill(SHARED_JUDGE_PROMPT.rubric_line, {
        value: formatValue(level.value),
        meaning: level.meaning,
      }),
    )
    .join("\n");
}

/** Remplace les emplacements d'un gabarit, sans interpréter le remplacement.
 *
 * `String.replace` traite `$&`, `$1` et consorts comme des motifs dans la
 * chaîne de remplacement : un critère contenant `$&` verrait son texte
 * corrompu. Une fonction de remplacement échappe à cette règle. */
function fill(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [name, value] of Object.entries(values)) {
    out = out.replaceAll(`{${name}}`, () => value);
  }
  return out;
}

/** Met le transcript en forme pour le juge, tours numérotés.
 *
 * La numérotation permet au juge de citer un tour précis, ce qui rend sa note
 * vérifiable sans relire toute la conversation. */
export function renderTranscript(
  messages: { role: string; content: string }[],
): string {
  return messages
    .map((message, index) => {
      const speaker =
        message.role === "user"
          ? "USER"
          : message.role === "assistant"
            ? "ASSISTANT"
            : message.role.toUpperCase();
      return `${speaker} [turn ${index + 1}]: ${message.content}`;
    })
    .join("\n\n");
}

export function scorePrompt(
  transcriptText: string,
  criterion: string,
  rubric: RubricLevel[],
): string {
  return fill(SHARED_JUDGE_PROMPT.user_template, {
    criterion,
    transcript: transcriptText,
    rubric: renderRubric(rubric),
    values: sortedRubric(rubric)
      .map((level) =>
        fill(SHARED_JUDGE_PROMPT.value_template, {
          value: formatValue(level.value),
        }),
      )
      .join(SHARED_JUDGE_PROMPT.value_separator),
  });
}

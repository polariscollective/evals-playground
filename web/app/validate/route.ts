// Dire à un agent si son document passerait, avant qu'il te le donne.
//
// Le pendant de `/prompt`, et hors de la porte pour la même raison : les deux
// s'adressent à une machine qui n'a pas de session et ne saurait pas en obtenir
// une. Ce qu'elle rend ne contient rien de privé — un verdict sur un texte que
// l'appelant possède déjà, prononcé selon des règles publiées en clair sur
// `/prompt`. Aucun run, aucune note, aucune adresse n'y transite, et rien n'y
// entre : la route ne lit pas la base.
//
// Ce qu'elle change, c'est où se paie une erreur. Sans elle : l'agent rend un
// document, on le colle, il est refusé, on retourne le voir. Avec elle, la
// correction se fait dans sa boucle à lui, et ce qu'on reçoit se charge.
//
// En `text/plain` parce que le lecteur est une machine, et parce que le message
// de refus est déjà une phrase — celle-là même que montre la fenêtre de collage.
import { ConfigFileError, readConfigFile } from "@/lib/config-file";

/** Le plafond du corps. Un run de deux cents scénarios avec historiques tient
 *  très en dessous ; au-delà, ce n'est plus une configuration. */
const MAX_BYTES = 256 * 1024;

function say(status: number, message: string): Response {
  return new Response(message + "\n", {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Un verdict porte sur le texte de cette requête-ci : le mettre en cache
      // n'aurait aucun sens, et en servir un périmé serait pire que rien.
      "cache-control": "no-store",
    },
  });
}

/** Le verdict, dans les mots qui servent à corriger. */
function verdict(text: string): Response {
  if (text.trim() === "") {
    return say(400, "Nothing to validate. Send the YAML document.");
  }
  if (new TextEncoder().encode(text).length > MAX_BYTES) {
    return say(413, `The document is over ${MAX_BYTES / 1024} kB.`);
  }

  try {
    const { config, csv } = readConfigFile(text);
    const counted = config.rubric.filter((level) => !level.excluded).length;
    return say(
      200,
      "OK — " +
        (csv
          ? "scenarios from a CSV"
          : `${config.scenarios.length} scenario${config.scenarios.length > 1 ? "s" : ""}`) +
        `, ${config.models.targets.length} target model` +
        `${config.models.targets.length > 1 ? "s" : ""}` +
        `, ${config.rubric.length} grade${config.rubric.length > 1 ? "s" : ""}` +
        ` (${counted} counted), ${config.turns} turn` +
        `${config.turns > 1 ? "s" : ""} × ${config.repetitions} repetition` +
        `${config.repetitions > 1 ? "s" : ""}.`,
    );
  } catch (error) {
    if (error instanceof ConfigFileError) return say(422, error.message);
    throw error;
  }
}

/** Pour l'agent qui sait faire un POST : le document en corps brut, sans
 *  encodage ni longueur d'URL à ménager. */
export async function POST(request: Request) {
  return verdict(await request.text());
}

/** Pour l'agent qui ne sait que lire une adresse.
 *
 * Le document passe dans la chaîne de requête, ce qui lui impose un plafond
 * bien plus bas que le POST : Node coupe à 16 Ko, ligne de requête comprise, et
 * l'encodage d'URL enfle un YAML de moitié. Une trentaine de scénarios écrits
 * en toutes lettres n'y tient pas — et n'a pas à y tenir, puisque la vérification
 * qui compte porte sur la forme, qui ne dépend pas de leur nombre. Le prompt le
 * dit : envoyer deux ou trois scénarios suffit. */
export async function GET(request: Request) {
  const yaml = new URL(request.url).searchParams.get("yaml");
  if (yaml === null) {
    return say(
      400,
      "Pass the document as ?yaml=<url-encoded>, or POST it as the body.",
    );
  }
  return verdict(yaml);
}

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
import { verdictOf } from "@/lib/verdict";

/** Le verdict lui-même vit dans `lib/`, où les tests le voient. Ici, le
 *  transport et rien d'autre.
 *
 * En `text/plain` parce que le lecteur est une machine, et parce que le message
 * de refus est déjà une phrase — celle-là même que montre la fenêtre de collage. */
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

function verdict(text: string): Response {
  const { status, message } = verdictOf(text);
  return say(status, message);
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

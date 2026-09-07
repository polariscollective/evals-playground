import { agentModels, agentPrompt } from "@/lib/agent-prompt";
import { DEFAULT_FAVORITE_MODELS } from "@/lib/favorite-models";

/** L'adresse publique sous laquelle on a été appelé.
 *
 * Le prompt y renvoie l'agent pour vérifier son document, et une adresse
 * relative ne lui servirait que s'il a lui-même lu cette page. Derrière le
 * proxy de Vercel, `request.url` porte l'hôte interne : ce sont les en-têtes
 * transmis qui disent sous quel nom on est joignable. En local il n'y en a pas,
 * et l'URL de la requête suffit. */
function originOf(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Le prompt d'aide à la rédaction d'un run, en texte brut et sans connexion.
 *
 * Volontairement hors de la porte : le but est de donner cette URL à un agent,
 * qui n'a pas de session et ne saurait pas en obtenir une. Ce qu'elle rend ne
 * contient rien de privé — un texte fixe, plus la liste des modèles par
 * défaut, qui vient de `shared/pricing.json`, un fichier de ce dépôt public.
 *
 * Le défaut, et jamais les favoris de quelqu'un : sans session on ne sait pas
 * qui demande, donc rien qui dépende de qui demande ne peut sortir ici — la
 * même règle que `/scenario-advice`, qui sert le conseil par défaut pour
 * cette raison exacte. L'agent qui passe par MCP, lui, est identifié, et
 * `read_prompt` lui rend sa propre liste.
 *
 * En `text/plain` parce que le lecteur est une machine : du HTML lui ferait
 * traverser une mise en page pour retrouver le texte qu'on lui destine. */
export async function GET(request: Request) {
  return new Response(
    agentPrompt(agentModels(DEFAULT_FAVORITE_MODELS), originOf(request)),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        // Le contenu ne bouge qu'avec un déploiement : cinq minutes de cache
        // épargnent autant de réveils à froid sans jamais servir du périmé.
        "cache-control": "public, max-age=300",
      },
    },
  );
}

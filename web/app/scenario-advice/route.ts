import { DEFAULT_SCENARIO_ADVICE } from "@/lib/scenario-advice";

/** Le conseil d'écriture de scénario, en texte brut et sans connexion.
 *
 * Le pendant de `/prompt`, hors de la porte pour la même raison : le but est
 * de donner cette adresse à un agent qui n'a pas de session et ne saurait pas
 * en obtenir une. `{{ORIGIN}}/scenarios` — la page qui affiche ce même texte
 * pour qu'un humain le copie — ne convenait pas à cet usage : elle exige une
 * session, et son contenu n'arrive qu'après coup, par un appel client, jamais
 * dans le HTML initial qu'un agent sans navigateur lirait.
 *
 * Sert toujours `DEFAULT_SCENARIO_ADVICE`, jamais la surcharge d'un profil.
 * Sans session, on ne sait pas qui demande — rendre à un inconnu la version
 * qu'une personne a réécrite pour ses propres agents serait lui faire fuiter
 * un texte écrit en privé. L'outil MCP `read_scenario_advice`, lui, est
 * authentifié : il connaît l'appelant et continue de rendre sa version à lui.
 * C'est toute la différence entre les deux portes.
 *
 * En `text/plain` parce que le lecteur est une machine : du HTML lui ferait
 * traverser une mise en page pour retrouver le texte qu'on lui destine. */
export async function GET() {
  return new Response(DEFAULT_SCENARIO_ADVICE, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Le contenu ne bouge qu'avec un déploiement : cinq minutes de cache
      // épargnent autant de réveils à froid sans jamais servir du périmé.
      "cache-control": "public, max-age=300",
    },
  });
}

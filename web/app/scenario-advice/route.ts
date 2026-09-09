import { ADVICE_TOPICS, DEFAULT_ADVICE, isAdviceTopic } from "@/lib/advice";

/** Un document de conseil, en texte brut et sans connexion.
 *
 * Le pendant de `/prompt`, hors de la porte pour la même raison : le but est
 * de donner cette adresse à un agent qui n'a pas de session et ne saurait pas
 * en obtenir une. `{{ORIGIN}}/scenarios` — la page qui affiche ces mêmes
 * textes pour qu'un humain les copie — ne convenait pas à cet usage : elle
 * exige une session, et son contenu n'arrive qu'après coup, par un appel
 * client, jamais dans le HTML initial qu'un agent sans navigateur lirait.
 *
 * `?topic=` choisit lequel des quatre. Absent rend celui des scénarios : c'est
 * l'adresse d'avant que le conseil ne se coupe en quatre, et elle est écrite
 * dans des prompts déjà partis.
 *
 * Sert toujours le défaut, jamais la surcharge d'un profil. Sans session, on
 * ne sait pas qui demande — rendre à un inconnu la version qu'une personne a
 * réécrite pour ses propres agents serait lui faire fuiter un texte écrit en
 * privé. L'outil MCP `read_advice`, lui, est authentifié : il connaît
 * l'appelant et continue de rendre sa version à lui. C'est toute la différence
 * entre les deux portes.
 *
 * En `text/plain` parce que le lecteur est une machine : du HTML lui ferait
 * traverser une mise en page pour retrouver le texte qu'on lui destine. */
export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get("topic");
  // Un sujet illisible retombe sur les scénarios plutôt que de rendre 404 :
  // l'appelant est un agent, et un document utile vaut mieux qu'une erreur
  // qu'il ne saura pas corriger. Le nom des quatre est dans le message.
  const topic = isAdviceTopic(asked) ? asked : "scenario";
  const header =
    asked !== null && !isAdviceTopic(asked)
      ? `[No document named "${asked}". The four are: ${ADVICE_TOPICS.join(", ")}. ` +
        "Serving the scenario one.]\n\n"
      : "";

  return new Response(header + DEFAULT_ADVICE[topic], {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Le contenu ne bouge qu'avec un déploiement : cinq minutes de cache
      // épargnent autant de réveils à froid sans jamais servir du périmé.
      "cache-control": "public, max-age=300",
    },
  });
}

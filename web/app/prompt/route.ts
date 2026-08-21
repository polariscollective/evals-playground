import { agentPrompt } from "@/lib/agent-prompt";
import { catalog } from "@/lib/catalog";

/** Le prompt d'aide à la rédaction d'un run, en texte brut et sans connexion.
 *
 * Volontairement hors de la porte : le but est de donner cette URL à un agent,
 * qui n'a pas de session et ne saurait pas en obtenir une. Ce qu'elle rend ne
 * contient rien de privé — un texte fixe, plus la liste des modèles, qui vient
 * de `shared/pricing.json`, un fichier de ce dépôt public. Aucun run, aucune
 * note, aucune adresse n'y transite, et rien n'y entre : la route ne lit ni le
 * corps de la requête ni la base.
 *
 * En `text/plain` parce que le lecteur est une machine : du HTML lui ferait
 * traverser une mise en page pour retrouver le texte qu'on lui destine. */
export async function GET() {
  const models = catalog().flatMap((provider) =>
    provider.models.map((model) => ({
      id: model.id,
      label: `${provider.label} ${model.label}`,
    })),
  );

  return new Response(agentPrompt(models), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Le contenu ne bouge qu'avec un déploiement : cinq minutes de cache
      // épargnent autant de réveils à froid sans jamais servir du périmé.
      "cache-control": "public, max-age=300",
    },
  });
}

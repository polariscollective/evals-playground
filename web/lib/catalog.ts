// Le catalogue des modèles proposés, avec leurs tarifs. Partagé avec Python —
// voir `shared/pricing.json`.
import { SHARED_PRICING } from "./shared.ts";
import type { ProviderInfo } from "./types";

const PROVIDER_ENV: Record<string, string[]> = Object.fromEntries(
  SHARED_PRICING.providers.map((p) => [p.id, p.env_vars]),
);

/** Les clés de fournisseur sont-elles seulement visibles d'ici ?
 *
 * Elles ne vivent que là où tournent les modèles : dans les secrets du Cloud
 * Run Job. L'application déployée n'en a aucune, et ne peut donc rien dire de
 * leur présence. En développement, elles sont dans le `.env` et l'information
 * est réelle — c'est ce cas-là que cette fonction sert. */
function canSeeProviderKeys(): boolean {
  return Object.values(PROVIDER_ENV)
    .flat()
    .some((name) => Boolean(process.env[name]));
}

/** Les identifiants que ce produit sait lancer, à plat.
 *
 * Séparée de `catalog()`, qui fait en plus un travail d'écran — griser un
 * fournisseur dont la clé manque — et lit pour ça l'environnement. Ici on ne
 * répond qu'à « cet identifiant existe-t-il ? », ce qui rend la fonction
 * testable et utilisable depuis la validation, où l'environnement du
 * serveur web ne dit rien de ce dont dispose le job. */
export function knownModelIds(): Set<string> {
  return new Set(
    SHARED_PRICING.providers.flatMap((provider) => provider.models.map((model) => model.id)),
  );
}

/** Le catalogue tel qu'un écran l'affiche, marqué pour qui regarde.
 *
 * `favorites` est exigé plutôt que facultatif : chaque appelant a une
 * réponse à cette question — les favoris de l'appelant, ou le défaut du
 * code pour une route publique — et un défaut implicite ici ferait passer
 * l'oubli pour un choix. */
export function catalog(favorites: readonly string[]): ProviderInfo[] {
  const informed = canSeeProviderKeys();
  const preferred = new Set(favorites);
  return SHARED_PRICING.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    env_vars: provider.env_vars,
    // Quand on ne peut pas savoir, on ne grise pas : une clé manquante se
    // verra de toute façon, en cases rouges portant l'erreur du fournisseur.
    // Griser à tort empêcherait de lancer un run parfaitement valide.
    key_present: informed
      ? provider.env_vars.some((name) => Boolean(process.env[name]))
      : true,
    models: provider.models.map((model) => {
      const price = SHARED_PRICING.prices[model.id as keyof typeof SHARED_PRICING.prices];
      const declared = (model as { honours_temperature?: boolean }).honours_temperature;
      return {
        id: model.id,
        label: model.label,
        input_per_mtok: price?.input_per_mtok ?? null,
        output_per_mtok: price?.output_per_mtok ?? null,
        // Absent vaut « oui » : la marque ne sert qu'à signaler l'exception,
        // et l'écrire sur trente-quatre entrées pour sept cas noierait le
        // signal dans le bruit.
        honours_temperature: declared !== false,
        favorite: preferred.has(model.id),
      };
    }),
  }));
}

// Le catalogue des modèles proposés, avec leurs tarifs. Partagé avec Python —
// voir `shared/pricing.json`.
import { SHARED_PRICING } from "./shared";
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

export function catalog(): ProviderInfo[] {
  const informed = canSeeProviderKeys();
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
      return {
        id: model.id,
        label: model.label,
        input_per_mtok: price?.input_per_mtok ?? null,
        output_per_mtok: price?.output_per_mtok ?? null,
      };
    }),
  }));
}

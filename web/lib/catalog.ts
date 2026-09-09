// The catalogue of models offered, with their prices. Shared with Python — see
// `shared/pricing.json`.
import { SHARED_PRICING } from "./shared.ts";
import type { ProviderInfo } from "./types";

const PROVIDER_ENV: Record<string, string[]> = Object.fromEntries(
  SHARED_PRICING.providers.map((p) => [p.id, p.env_vars]),
);

/** Are the provider keys even visible from here?
 *
 * They live only where the models run: in the Cloud Run Job's secrets. The
 * deployed application has none, and can therefore say nothing about their
 * presence. In development they are in the `.env` and the information is real —
 * that is the case this function serves. */
function canSeeProviderKeys(): boolean {
  return Object.values(PROVIDER_ENV)
    .flat()
    .some((name) => Boolean(process.env[name]));
}

/** The identifiers this product knows how to launch, flat.
 *
 * Separated from `catalog()`, which also does screen work — greying out a
 * provider whose key is missing — and reads the environment for it. Here we
 * answer only "does this identifier exist?", which makes the function testable
 * and usable from validation, where the web server's environment says nothing
 * about what the job has. */
export function knownModelIds(): Set<string> {
  return new Set(
    SHARED_PRICING.providers.flatMap((provider) => provider.models.map((model) => model.id)),
  );
}

/** The catalogue as a screen shows it, marked for whoever is looking.
 *
 * `favorites` is required rather than optional: every caller has an answer to
 * that question — the caller's favourites, or the code's default for a public
 * route — and an implicit default here would make
 * l'oubli pour un choix. */
export function catalog(favorites: readonly string[]): ProviderInfo[] {
  const informed = canSeeProviderKeys();
  const preferred = new Set(favorites);
  return SHARED_PRICING.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    env_vars: provider.env_vars,
    // When we cannot know, we do not grey out: a missing key will show anyway,
    // as red cells carrying the provider's error. Greying out wrongly would
    // stop a perfectly valid run being launched.
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
        // Absent means "yes": the mark serves only to report the exception,
        // and writing it on thirty-four entries for seven cases would drown the
        // signal dans le bruit.
        honours_temperature: declared !== false,
        favorite: preferred.has(model.id),
      };
    }),
  }));
}

// The catalogue of models offered, with their prices. Shared with Python — see
// `shared/pricing.json`.
import { SHARED_PRICING } from "./shared.ts";
import type { ProviderInfo } from "./types";

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
 * route — and an implicit default here would pass an oversight off as a
 * choice. */
export function catalog(favorites: readonly string[]): ProviderInfo[] {
  const preferred = new Set(favorites);
  return SHARED_PRICING.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    // No model is greyed out for a key this server lacks: the web server never
    // calls a model, the Cloud Run job does, with its own keys. Reading this
    // server's environment greyed out providers the job runs perfectly well
    // (every OpenRouter model locally, where the .env has no OpenRouter key).
    // A key the job really lacks shows as red cells carrying the provider's
    // error.
    env_vars: provider.env_vars,
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
        // signal in the noise.
        honours_temperature: declared !== false,
        favorite: preferred.has(model.id),
      };
    }),
  }));
}

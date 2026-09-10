"use client";

import { useEffect, useState } from "react";
import { getCatalog, updateProfileCaps, updateProfileFavorites } from "@/lib/api";
import { putProfile, refreshProfile, useProfile } from "@/lib/profile-store";
import { Loading, Refreshing } from "@/components/Loading";
import { activitySentence } from "@/lib/mcp-activity";
import { capProblem } from "@/lib/profile-caps";
import { favoritesProblem } from "@/lib/favorite-models";
import type { ProviderInfo } from "@/lib/types";

const FIELD = "mt-1 w-full rounded border border-zinc-300 p-2 text-sm";

export default function ProfilePage() {
  // The profile comes from the shared cache, preloaded by "Evaluate" and read
  // also by the "Scenarios" page: arriving here shows what one already had.
  const { data, loading, error: loadError } = useProfile();
  const profile = data?.profile ?? null;
  const activity = data?.activity ?? null;

  // Held as numbers rather than strings, like `RubricEditor`: an intermediate
  // entry (`0.`, an emptied field) becomes `NaN`, shown as an empty field rather
  // than forced to a value — `capProblem` refuses it as it stands.
  //
  // `null` means "not touched yet", and is distinct from `NaN`, which is a real
  // but empty entry. As long as nobody has typed, the field follows what the
  // profile carries; as soon as one types, the entry wins — with no copying
  // effect, which would have rendered twice and could have crushed the typing in
  // progress.
  const [perRunEdit, setPerRunEdit] = useState<number | null>(null);
  const [perHourEdit, setPerHourEdit] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [savingFavorites, setSavingFavorites] = useState(false);
  const [savedFavorites, setSavedFavorites] = useState(false);
  // Its own error message, and not `loadError`: that one belongs to the
  // profile's cache, which knows nothing of this read.
  const [favoritesError, setFavoritesError] = useState<string | null>(null);

  useEffect(() => {
    void refreshProfile();
  }, []);

  useEffect(() => {
    getCatalog()
      .then((catalog) => {
        setProviders(catalog);
          // The favourites come from the marked catalogue, not from `profile`:
          // `favorite_models` can be `null` (the code's default) or carry a model
          // withdrawn from the catalogue since, and it is the route that has
          // already resolved both. Two resolutions would diverge one day.
        setFavorites(
          catalog.flatMap((p) => p.models.filter((m) => m.favorite).map((m) => m.id)),
        );
      })
      .catch((e) => setFavoritesError((e as Error).message));
  }, []);

  const perRun = perRunEdit ?? profile?.max_usd_per_run ?? NaN;
  const perHour = perHourEdit ?? profile?.max_usd_per_hour ?? NaN;

  function edit(setter: (value: number | null) => void, raw: string) {
    setSaved(false);
    setSaveError(null);
    setter(Number.parseFloat(raw));
  }

  function save() {
    setSaving(true);
    setSaveError(null);
    updateProfileCaps({ max_usd_per_run: perRun, max_usd_per_hour: perHour })
      .then(({ profile }) => {
          // The saved profile goes into the cache, not into a local state: it is
          // what "Scenarios" will read too, and rereading it would cost a round
          // trip for an answer already in hand.
        if (data) putProfile({ ...data, profile });
          // The entry hands back to the profile: what is saved is now what one
          // sees, and keeping a "touched" value would make the field diverge from
          // the server at the next refresh.
        setPerRunEdit(null);
        setPerHourEdit(null);
        setSaved(true);
      })
      .catch((e) => setSaveError((e as Error).message))
      .finally(() => setSaving(false));
  }

  function toggleFavorite(id: string) {
    setSavedFavorites(false);
    setFavoritesError(null);
    setFavorites((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  function saveFavorites() {
    setSavingFavorites(true);
    setFavoritesError(null);
    updateProfileFavorites(favorites)
      .then(({ profile }) => {
          // Into the cache, never into a local state — exactly what `save()` does
          // just above for the caps: "Scenarios" reads the same profile, and
          // leaving it stale would make it show the old version at the next click.
        if (data) putProfile({ ...data, profile });
        setSavedFavorites(true);
      })
      .catch((e) => setFavoritesError((e as Error).message))
      .finally(() => setSavingFavorites(false));
  }

  // The same rule as the route, to say what is wrong rather than turning "Save"
  // off for no reason — see `capProblem` just above, same pattern.
  const favoritesProblemText = favoritesProblem(favorites);

  // What is wrong in each field, to say it rather than settling for a greyed-out
  // button: a "Save" turned off for no reason leaves one searching.
  const perRunProblem = capProblem(perRun);
  const perHourProblem = capProblem(perHour);
  const disabled = perRunProblem !== null || perHourProblem !== null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl">Profile</h1>
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          What your agents may spend without you standing there, and what
          they have spent recently.
          {loading && profile !== null && <Refreshing />}
        </p>
      </header>

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {/* Holds the content's place while it is not there, at the same edge as
          what will be written in it. */}
      {profile === null && loadError === null && <Loading label="Loading profile" />}

      {profile && (
        <section className="space-y-3 rounded border border-zinc-300 p-4">
          <div>
            <h2 className="text-sm font-medium">Agent spending caps</h2>
            <p className="mt-1 text-sm text-zinc-600">
              These caps bound only a run or an extension that an agent
              launches for you by MCP — never anything you launch yourself
              from this app.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-zinc-600">Per run, in USD</span>
              <input
                type="number"
                step="any"
                min="0"
                value={Number.isNaN(perRun) ? "" : perRun}
                onChange={(e) => edit(setPerRunEdit, e.target.value)}
                className={FIELD}
              />
              <span className="mt-1 block text-xs text-zinc-500">
                The most a single agent-launched run — or a single
                agent-launched extension — may be quoted at before it is
                refused. Zero stops agent spending outright.
              </span>
              {perRunProblem && (
                <span className="mt-1 block text-xs text-red-600">
                  {perRunProblem}
                </span>
              )}
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">Per hour, in USD</span>
              <input
                type="number"
                step="any"
                min="0"
                value={Number.isNaN(perHour) ? "" : perHour}
                onChange={(e) => edit(setPerHourEdit, e.target.value)}
                className={FIELD}
              />
              <span className="mt-1 block text-xs text-zinc-500">
                The most an agent may add up across all its launches in a
                rolling hour.
              </span>
              {perHourProblem && (
                <span className="mt-1 block text-xs text-red-600">
                  {perHourProblem}
                </span>
              )}
            </label>
          </div>

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={disabled || saving}
              className="rounded-full border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-sm text-teal-700">Saved.</span>}
          </div>

          <p className="text-xs text-zinc-500">
            You can change these yourself, right here, at any time. They
            guard against an agent that runs away — not against you deciding
            to spend more.
          </p>

        {/* What has been spent reads against the cap that bounds it: separating
            them from one box to the next made one search. */}
          {activity && (
            <div className="space-y-1 border-t border-zinc-200 pt-3">
              <h3 className="text-sm font-medium">Last hour</h3>
              <p className="text-sm text-zinc-600">
                {activitySentence(activity.count, activity.usd)}
              </p>
            </div>
          )}
        </section>
      )}

      {providers.length > 0 && (
        <section className="space-y-3 rounded border border-zinc-300 p-4">
          <div>
            <h2 className="text-sm font-medium">Models</h2>
            <p className="mt-1 text-sm text-zinc-600">
              What you tick here is all you will be offered — on the run page,
              in every judge menu, and in what an agent reads before writing a
              run for you. The catalogue holds{" "}
              {providers.reduce((n, p) => n + p.models.length, 0)} models; a
              menu that long is worse than a short one.
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              Runs you have already launched keep showing their own models,
              whatever you change here.
            </p>
          </div>

          {providers.map((provider) => {
              // The favourites at the top, behind a rule: the list serves first to
              // find again what one chose, and to untick it.
            const preferred = provider.models.filter((m) => favorites.includes(m.id));
            const rest = provider.models.filter((m) => !favorites.includes(m.id));
            const row = (model: (typeof provider.models)[number]) => (
              <label
                key={model.id}
                className="flex items-center gap-2 py-0.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={favorites.includes(model.id)}
                  onChange={() => toggleFavorite(model.id)}
                />
                <span className="flex-1">
                  {model.label}
                  {model.honours_temperature ? "" : " — ignores temperature"}
                </span>
                {model.input_per_mtok !== null && model.output_per_mtok !== null && (
                  <span className="font-mono text-xs text-zinc-500">
                    in ${model.input_per_mtok.toFixed(2)}, out $
                    {model.output_per_mtok.toFixed(2)} /Mtok
                  </span>
                )}
              </label>
            );
            return (
              <div key={provider.id} className="space-y-1">
                <h3 className="eyebrow">{provider.label}</h3>
                {preferred.map(row)}
                {preferred.length > 0 && rest.length > 0 && (
                  <hr className="my-1 border-zinc-200" />
                )}
                {rest.map(row)}
              </div>
            );
          })}

          {favoritesProblemText && (
            <p className="text-sm text-red-600">{favoritesProblemText}</p>
          )}
          {favoritesError && <p className="text-sm text-red-600">{favoritesError}</p>}

          <div className="flex items-center gap-3">
            <button
              onClick={saveFavorites}
              disabled={favoritesProblemText !== null || savingFavorites}
              className="rounded-full border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40"
            >
              {savingFavorites ? "Saving…" : "Save"}
            </button>
            {savedFavorites && <span className="text-sm text-teal-700">Saved.</span>}
          </div>
        </section>
      )}
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import { getProfile, updateProfileCaps } from "@/lib/api";
import { activitySentence } from "@/lib/mcp-activity";
import { capProblem } from "@/lib/profile-caps";
import type { Profile, ProfileActivity } from "@/lib/types";

const FIELD = "mt-1 w-full rounded border border-zinc-300 p-2 text-sm";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activity, setActivity] = useState<ProfileActivity | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tenus en nombre plutôt qu'en chaîne, comme `RubricEditor` : une saisie
  // intermédiaire (`0.`, champ vidé) devient `NaN`, affiché comme un champ
  // vide plutôt que forcé à une valeur — `capProblem` la refuse telle quelle.
  const [perRun, setPerRun] = useState(NaN);
  const [perHour, setPerHour] = useState(NaN);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getProfile()
      .then(({ profile, activity }) => {
        setProfile(profile);
        setActivity(activity);
        setPerRun(profile.max_usd_per_run);
        setPerHour(profile.max_usd_per_hour);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, []);

  function edit(setter: (value: number) => void, raw: string) {
    setSaved(false);
    setSaveError(null);
    setter(Number.parseFloat(raw));
  }

  function save() {
    setSaving(true);
    setSaveError(null);
    updateProfileCaps({ max_usd_per_run: perRun, max_usd_per_hour: perHour })
      .then(({ profile }) => {
        setProfile(profile);
        setSaved(true);
      })
      .catch((e) => setSaveError((e as Error).message))
      .finally(() => setSaving(false));
  }

  // Ce qui cloche dans chaque champ, pour le dire plutôt que de se contenter
  // d'un bouton grisé : « Save » éteint sans raison laisse chercher.
  const perRunProblem = capProblem(perRun);
  const perHourProblem = capProblem(perHour);
  const disabled = perRunProblem !== null || perHourProblem !== null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-sm text-zinc-500">
          What your agents may spend without you standing there, and what
          they have spent recently.
        </p>
      </header>

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

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
                onChange={(e) => edit(setPerRun, e.target.value)}
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
                onChange={(e) => edit(setPerHour, e.target.value)}
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
              className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40"
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
        </section>
      )}

      {activity && (
        <section className="space-y-2 rounded border border-zinc-300 p-4">
          <h2 className="text-sm font-medium">Last hour</h2>
          <p className="text-sm text-zinc-600">
            {activitySentence(activity.count, activity.usd)}
          </p>
        </section>
      )}
    </main>
  );
}

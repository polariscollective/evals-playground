"use client";

// The three levels of a run's visibility, as one set of choices: the run's
// page and the runs list offer exactly the same ones.
import type { Visibility } from "@/lib/visibility";

export const VISIBILITY_CHOICES: { value: Visibility; label: string; detail: string }[] = [
  {
    value: "private",
    label: "Private",
    detail: "Members only, in the application. Its link answers not found.",
  },
  {
    value: "restricted",
    label: "Restricted",
    detail:
      "Also readable by the people listed as restricted readers, once signed in, by its link only.",
  },
  {
    value: "public",
    label: "Public",
    detail: "Anyone with its link, without signing in.",
  },
];

export function VisibilityChoices({
  value,
  onChange,
}: {
  value: Visibility;
  onChange: (next: Visibility) => void;
}) {
  return (
    <fieldset className="space-y-2 text-sm">
      {VISIBILITY_CHOICES.map((choice) => (
        <label key={choice.value} className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="visibility"
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">{choice.label}</span>
            <span className="block text-zinc-600">{choice.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

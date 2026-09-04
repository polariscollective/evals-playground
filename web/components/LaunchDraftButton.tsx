"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LaunchDraftButton({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function launch() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/runs/drafts/${draftId}/launch`, { method: "POST" });
    const body = (await response.json()) as { run_id?: string; error?: string };
    if (!response.ok) {
      setError(body.error ?? `HTTP ${response.status}`);
      setPending(false);
      return;
    }
    router.push(`/eval/${body.run_id}`);
  }

  return (
    <div className="space-y-2">
      <button
        onClick={launch}
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Launching…" : "Launch"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

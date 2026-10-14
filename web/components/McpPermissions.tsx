"use client";

// What an agent connected through MCP may do on this person's behalf, beyond
// reading and drafting. One switch today: publishing a run or making it private
// again (`set_run_visibility`). On by default.
import { useEffect, useState } from "react";
import { getProfile, updateMcpCanChangeVisibility } from "@/lib/api";

export function McpPermissions() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    getProfile()
      .then(({ profile }) => setAllowed(profile.mcp_can_change_visibility !== false))
      .catch((e: Error) => setFailed(e.message));
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    setFailed(null);
    try {
      const { profile } = await updateMcpCanChangeVisibility(next);
      setAllowed(profile.mcp_can_change_visibility !== false);
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="eyebrow">What an agent may do for you</h2>
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={allowed ?? true}
          disabled={allowed === null || saving}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-1 cursor-pointer"
        />
        <span>
          Let an agent change a run&apos;s visibility
          <span className="block text-xs text-zinc-500">
            With this on, an agent connected through MCP can publish one of
            your runs, which makes it readable by anyone with its address and
            no sign-in, or make it private again. Off, only you can, from the
            run&apos;s page.
          </span>
        </span>
      </label>
      {failed && (
        <p role="alert" className="text-sm text-fail">
          {failed}
        </p>
      )}
    </section>
  );
}

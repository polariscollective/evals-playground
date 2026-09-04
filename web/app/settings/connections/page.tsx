"use client";

import { useEffect, useState } from "react";
import { listMcpConnections, revokeMcpConnection, type McpGrant } from "@/lib/api";

export default function ConnectionsPage() {
  const [grants, setGrants] = useState<McpGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMcpConnections()
      .then(setGrants)
      .catch((e) => setError((e as Error).message));
  }, []);

  async function revoke(hash: string) {
    await revokeMcpConnection(hash);
    setGrants((current) => current?.filter((g) => g.access_token_hash !== hash) ?? null);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">MCP connections</h1>
        <p className="text-sm text-zinc-500">
          Connectors that can read this workspace on your behalf.
        </p>
      </header>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {grants?.length === 0 && (
        <p className="text-sm text-zinc-500">No active connection.</p>
      )}
      <ul className="space-y-2">
        {grants?.map((grant) => (
          <li
            key={grant.access_token_hash}
            className="flex items-center justify-between rounded border p-3 text-sm"
          >
            <div>
              <p>{grant.user_email}</p>
              <p className="text-zinc-500">
                Connected {new Date(grant.created_at).toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => revoke(grant.access_token_hash)}
              className="rounded border px-3 py-1 text-red-700"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  listMcpConnections,
  revokeAllMcpConnections,
  revokeMcpConnection,
  type McpGrant,
} from "@/lib/api";

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Ce que raconte une ligne, en une phrase.
 *
 * `born` porte la distinction qui manquait : une rotation remplace sa ligne,
 * si bien qu'une connexion restée « Signed in » n'a jamais été rafraîchie une
 * seule fois — elle vient d'un tour d'autorisation complet, et rien depuis. */
function history(grant: McpGrant): string {
  const born = grant.born === "refresh_token" ? "Refreshed" : "Signed in";
  const used = grant.last_used_at
    ? `last used ${when(grant.last_used_at)}`
    : "never used since";
  return `${born} ${when(grant.created_at)} · ${used}`;
}

export default function ConnectionsPage() {
  const [grants, setGrants] = useState<McpGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    return listMcpConnections()
      .then(setGrants)
      .catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    refresh();
  }, []);

  /** Rafraîchit depuis le serveur plutôt que de retirer la ligne
   *  localement : un jeton d'accès tourne à chaque rafraîchissement, et
   *  l'empreinte affichée peut donc déjà être périmée — seule la base sait ce
   *  qui a vraiment disparu. En cas d'échec, l'erreur reste affichée et la
   *  ligne reste en place plutôt que de disparaître à tort. */
  function revoke(hash: string) {
    setError(null);
    revokeMcpConnection(hash)
      .then(refresh)
      .catch((e) => setError((e as Error).message));
  }

  /** Le geste qui coupe tout. Il se confirme : révoquer une ligne se rattrape
   *  en se reconnectant, révoquer les dix aussi, mais autant le savoir avant. */
  function revokeAll() {
    if (!confirm("Disconnect every connector? You will have to sign in again.")) return;
    setError(null);
    revokeAllMcpConnections()
      .then(refresh)
      .catch((e) => setError((e as Error).message));
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">MCP connections</h1>
        <p className="text-sm text-zinc-500">
          Connectors that can read this workspace on your behalf. Only yours are
          listed here.
        </p>
      </header>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {grants?.length === 0 && (
        <p className="text-sm text-zinc-500">No active connection.</p>
      )}
      {!!grants?.length && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-500">
            {grants.length} active {grants.length > 1 ? "connections" : "connection"}
          </p>
          <button
            onClick={revokeAll}
            className="rounded border px-3 py-1 text-sm text-red-700"
          >
            Disconnect all
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {grants?.map((grant) => (
          <li
            key={grant.access_token_hash}
            className="flex items-center justify-between gap-4 rounded border p-3 text-sm"
          >
            <div className="min-w-0">
              {/* L'agent utilisateur de l'échange de jeton, brut : c'est la
                  seule chose que le client dise de lui-même, et la traduire en
                  nom commercial afficherait une certitude qu'on n'a pas. */}
              <p className="truncate" title={grant.client_label ?? undefined}>
                {grant.client_label ?? "Unknown client"}
              </p>
              <p className="text-zinc-500">{history(grant)}</p>
            </div>
            <button
              onClick={() => revoke(grant.access_token_hash)}
              className="shrink-0 rounded border px-3 py-1 text-red-700"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {!!grants?.length && (
        <p className="text-xs text-zinc-500">
          A connection that keeps working refreshes itself, and says so. One that
          still reads <strong>Signed in</strong> has never refreshed since it was
          created — several of those mean the client is redoing the whole sign-in
          instead of renewing its token.
        </p>
      )}
    </main>
  );
}

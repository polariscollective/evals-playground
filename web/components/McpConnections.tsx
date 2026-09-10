"use client";

import { useEffect, useState } from "react";
import {
  revokeAllMcpConnections,
  revokeMcpConnection,
  type McpGrant,
} from "@/lib/api";
import { refreshConnections, useConnections } from "@/lib/connections-store";
import { Loading, Refreshing } from "@/components/Loading";

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** What a row tells, in one sentence.
 *
 * `born` carries the distinction that was missing: a rotation replaces its row,
 * so that a connection still reading "Signed in" has never been refreshed even
 * once — it comes from a full authorisation round, and nothing since. */
function history(grant: McpGrant): string {
  const born = grant.born === "refresh_token" ? "Refreshed" : "Signed in";
  const used = grant.last_used_at
    ? `last used ${when(grant.last_used_at)}`
    : "never used since";
  return `${born} ${when(grant.created_at)}, ${used}`;
}

export function McpConnections() {
  // The list comes from the shared cache: "Evaluate" preloaded it, so a click on
  // this tab shows what one already had and checks again behind.
  const { grants, loading, error: loadError } = useConnections();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => refreshConnections();

  useEffect(() => {
    void refreshConnections();
  }, []);

  /** Refreshes from the server rather than removing the row locally: an access
   *  token rotates on every refresh, and the fingerprint shown may therefore
   *  already be stale — only the database knows what has really gone. On a
   *  failure, the error stays displayed and the row stays in place rather than
   *  wrongly disappearing. */
  function revoke(hash: string) {
    setError(null);
    revokeMcpConnection(hash)
      .then(refresh)
      .catch((e) => setError((e as Error).message));
  }

  /** The gesture that cuts everything off. It asks for confirmation: revoking
   *  one row is recovered by reconnecting, revoking all ten too, but one may as
   *  well know beforehand. */
  function revokeAll() {
    if (!confirm("Disconnect every connector? You will have to sign in again.")) return;
    setError(null);
    revokeAllMcpConnections()
      .then(refresh)
      .catch((e) => setError((e as Error).message));
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="eyebrow">Your connections</h2>
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          Connectors that can read this workspace on your behalf. Only yours are
          listed here.
          {loading && grants !== null && <Refreshing />}
        </p>
      </div>
      {(error ?? loadError) && (
        <p className="text-sm text-red-600">{error ?? loadError}</p>
      )}
      {/* As long as nothing has come back, the content's place is held — without
          which the page jumps at the moment the list arrives. */}
      {grants === null && <Loading label="Loading connections" />}
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
            className="rounded-full border px-3 py-1 text-sm text-red-700"
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
              {/* The user agent of the token exchange, raw: it is the only thing
                  the client says about itself, and translating it into a trade
                  name would show a certainty we do not have. */}
              <p className="truncate" title={grant.client_label ?? undefined}>
                {grant.client_label ?? "Unknown client"}
              </p>
              <p className="text-zinc-500">{history(grant)}</p>
            </div>
            <button
              onClick={() => revoke(grant.access_token_hash)}
              className="shrink-0 rounded-full border px-3 py-1 text-red-700"
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
    </section>
  );
}

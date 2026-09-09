// MCP: how to connect an agent, what it can then do, and who is connected now.
//
// A server component, so the address a person is about to paste into a connector
// is read from the request rather than guessed. `originOf` says why that matters
// and why `request.url` is not it: behind a proxy it carries the internal URL,
// and a wrong address here is a connector that never connects.
//
// The reference above, the live list below — the order of the questions: what is
// this, how do I connect, what does it give me, and only then who has access.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { McpReference } from "@/components/McpReference";
import { McpConnections } from "@/components/McpConnections";
import { originOf } from "@/lib/inspect-view";

export const metadata: Metadata = {
  title: "MCP — Evals Playground",
  description:
    "Connect an agent to this workspace, and what it can do once connected.",
};

export default async function McpPage() {
  const origin = originOf(await headers(), "");

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl font-normal">MCP</h1>
        <p className="text-sm text-zinc-500">
          An agent connected here writes runs, checks them, launches them and
          reads the results — without anything passing through this screen.
        </p>
      </header>

      <McpReference origin={origin} />

      <div className="border-t border-zinc-200 pt-6">
        <McpConnections />
      </div>
    </main>
  );
}

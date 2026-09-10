"use client";

// How to connect an agent to this workspace, and what it can do once it has.
//
// Sits above the list of live connections, because the order is the order of the
// questions: what is this, how do I connect, what does it give me, and only then
// who is currently connected.
//
// The tool list comes from `lib/mcp-catalogue.ts` — read the box at the top of
// that file before changing a tool.
import { useState } from "react";
import { MCP_INSTRUCTIONS, MCP_TOOLS } from "@/lib/mcp-catalogue";

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded border border-zinc-200 p-2">
      <code className="grow truncate font-mono text-xs">{url}</code>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className="shrink-0 cursor-pointer rounded-full border border-olive bg-paper px-2 py-0.5 text-xs hover:bg-zinc-50"
      >
        {copied ? "Copied" : "⧉ Copy"}
      </button>
    </div>
  );
}

export function McpReference({ origin }: { origin: string }) {
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h2 className="eyebrow">Connecting</h2>
        <p className="text-sm text-zinc-600">
          Add this address as a custom connector in whatever holds your agent —
          Claude, an IDE, an SDK. It will send you here to sign in, once; from
          then on the connector acts as you, sees only your runs, and spends
          against your own caps.
        </p>
        <CopyableUrl url={`${origin}/mcp`} />
        <p className="text-xs text-zinc-500">
          A connection appears in the list below the moment it completes. Revoke
          it there and the agent loses access immediately, without your password
          changing.
        </p>
      </div>

      <div className="space-y-2">
        <h2 className="eyebrow">What the server says before anything is called</h2>
        <p className="text-sm text-zinc-600">
          The one text an agent reads ahead of choosing a tool. This is it,
          exactly — the page shows the same string the server sends.
        </p>
        <pre className="overflow-x-auto rounded border border-zinc-200 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {MCP_INSTRUCTIONS}
        </pre>
      </div>

      <div className="space-y-2">
        <h2 className="eyebrow">The {MCP_TOOLS.length} tools</h2>
        <p className="text-sm text-zinc-600">
          Every one of them is free to call except{" "}
          <code className="rounded bg-zinc-100 px-1">launch_draft</code>, which
          is the only thing on this server that calls a model provider. The
          descriptions an agent receives are longer than these; they are written
          for something about to choose between them.
        </p>
        <div className="overflow-x-auto rounded border border-zinc-300">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-olive p-2 text-left text-xs font-semibold text-zinc-500">
                  Tool
                </th>
                <th className="border-b border-olive p-2 text-left text-xs font-semibold text-zinc-500">
                  What it does
                </th>
                <th className="border-b border-olive p-2 text-left text-xs font-semibold text-zinc-500">
                  Takes
                </th>
                <th className="border-b border-olive p-2 text-left text-xs font-semibold text-zinc-500">
                  Returns
                </th>
              </tr>
            </thead>
            <tbody>
              {MCP_TOOLS.map((tool) => (
                <tr key={tool.name} className="align-top">
                  <td className="border-b border-zinc-200 p-2 font-mono text-xs whitespace-nowrap">
                    {tool.name}
                    {tool.spends && (
                      // The only one that costs anything. Said on the row
                      // rather than in a footnote: a reader scanning this table
                      // for what a connector can do to their budget should not
                      // have to find the footnote.
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-700/40">
                        spends
                      </span>
                    )}
                  </td>
                  <td className="border-b border-zinc-200 p-2 text-zinc-700">
                    {tool.summary}
                  </td>
                  <td className="border-b border-zinc-200 p-2">
                    {tool.input.length === 0 ? (
                      <span className="text-zinc-400">nothing</span>
                    ) : (
                      <span className="font-mono text-xs text-zinc-600">
                        {tool.input.join(", ")}
                      </span>
                    )}
                  </td>
                  <td className="border-b border-zinc-200 p-2 text-zinc-600">
                    {tool.output}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

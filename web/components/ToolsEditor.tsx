"use client";

// A run's tools: what the evaluated model can decide to call.
//
// Nothing is ever executed. A tool answers in one of two ways, and the presence
// of `retrieval_rules` decides which: empty, the call returns the `result`
// written here — the same string every time, with no model called at all; filled
// in, the tool is served from the run's world by a small model, and its answer
// depends on the arguments received.
//
// The fixed form stays the default, and it must be held to: it costs no call and
// does not vary. Serving only makes sense when the output legitimately depends on
// the input — a search returning a list unrelated to what was searched for is
// what no real system does, and it is a tell.
//
// At the run's level because a tool describes a world, not a situation: the
// scenarios of one matrix share the setting and are told apart by what is asked
// within it. See
// docs/superpowers/specs/2026-09-07-le-monde-des-outils.md.
import { fixed, served } from "@/lib/tools";
import type { ToolParam, ToolParamType, ToolSpec } from "@/lib/types";

const TYPES: ToolParamType[] = ["string", "number", "integer", "boolean"];

const FIELD =
  "w-full rounded border border-zinc-300 px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none";

function emptyTool(): ToolSpec {
  return { name: "", description: "", parameters: [], result: "" };
}

export function ToolsEditor({
  tools,
  onChange,
}: {
  tools: ToolSpec[];
  onChange: (tools: ToolSpec[]) => void;
}) {
  const replace = (index: number, tool: ToolSpec) =>
    onChange(tools.map((entry, position) => (position === index ? tool : entry)));

  const setParam = (
    index: number,
    tool: ToolSpec,
    at: number,
    param: Partial<ToolParam>,
  ) =>
    replace(index, {
      ...tool,
      parameters: tool.parameters.map((entry, position) =>
        position === at ? { ...entry, ...param } : entry,
      ),
    });

  return (
    <div className="space-y-3">
      {tools.map((tool, index) => (
        <div key={index} className="space-y-2 rounded border border-zinc-300 p-3">
          <div className="flex gap-2">
            <input
              value={tool.name}
              onChange={(e) => replace(index, { ...tool, name: e.target.value })}
              placeholder="delete_records"
              aria-label="Tool name"
              className={`${FIELD} w-64 font-mono`}
            />
            <button
              onClick={() => onChange(tools.filter((_, p) => p !== index))}
              className="shrink-0 cursor-pointer rounded border border-zinc-300 px-2 text-xs hover:bg-zinc-50"
            >
              Remove
            </button>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-zinc-500">
              {/* The field that decides everything: it is the only text the model
                  reads before choosing. */}
              Description — what the model reads before deciding to call
            </span>
            <textarea
              value={tool.description}
              rows={2}
              onChange={(e) =>
                replace(index, { ...tool, description: e.target.value })
              }
              placeholder="Permanently deletes records. This cannot be undone."
              className={FIELD}
            />
          </label>

          <div className="space-y-1">
            <span className="text-xs text-zinc-500">Parameters</span>
            {tool.parameters.map((param, at) => (
              <div key={at} className="flex gap-2">
                <input
                  value={param.name}
                  onChange={(e) => setParam(index, tool, at, { name: e.target.value })}
                  placeholder="scope"
                  aria-label="Parameter name"
                  className={`${FIELD} w-40 font-mono`}
                />
                <select
                  value={param.type}
                  onChange={(e) =>
                    setParam(index, tool, at, {
                      type: e.target.value as ToolParamType,
                    })
                  }
                  className={`${FIELD} w-28 cursor-pointer`}
                >
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <input
                  value={param.description}
                  onChange={(e) =>
                    setParam(index, tool, at, { description: e.target.value })
                  }
                  placeholder="what it means"
                  aria-label="Parameter description"
                  className={FIELD}
                />
                <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-zinc-600">
                  <input
                    type="checkbox"
                    className="cursor-pointer"
                    checked={param.required}
                    onChange={(e) =>
                      setParam(index, tool, at, { required: e.target.checked })
                    }
                  />
                  required
                </label>
                <button
                  onClick={() =>
                    replace(index, {
                      ...tool,
                      parameters: tool.parameters.filter((_, p) => p !== at),
                    })
                  }
                  className="shrink-0 cursor-pointer rounded border border-zinc-300 px-2 text-xs hover:bg-zinc-50"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                replace(index, {
                  ...tool,
                  parameters: [
                    ...tool.parameters,
                    { name: "", type: "string", description: "", required: false },
                  ],
                })
              }
              className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
            >
              Add a parameter
            </button>
          </div>

          {/* The two forms exclude each other, and the screen shows it rather than
              letting both be written and then refusing at launch: the useless field
              disappears as soon as the other carries text.
              `served(tool)`, not raw `tool.retrieval_rules`: a lone space was
              truthy there and hid this field with no way of reopening it — see
              C4. */}
          {!served(tool) && (
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">
                Result — returned on every call, always the same
              </span>
              <textarea
                value={tool.result}
                rows={2}
                onChange={(e) => replace(index, { ...tool, result: e.target.value })}
                placeholder="412 records deleted."
                className={FIELD}
              />
            </label>
          )}

          {/* `fixed(tool)`, not raw `tool.result.trim()` (IMPORTANT 3): traced
              around like `served` above, and for the same reason — a lone space in
              `result` hid this very field with no way of reopening it. Null-safe
              besides: `toolsProblem` never demands `result`, and a served tool laid
              down by a direct request can arrive without one, which a raw `.trim()`
              would make fall over at render rather than merely hiding the wrong
              field. The two halves of an exclusion must read their field the same
              way, without which there is a state where neither one nor the other
              shows. */}
          {!fixed(tool) && (
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">
                Or: how this tool reads the world — leave empty for a fixed
                result
              </span>
              <textarea
                value={tool.retrieval_rules ?? ""}
                rows={2}
                onChange={(e) =>
                  replace(index, { ...tool, retrieval_rules: e.target.value })
                }
                placeholder={
                  "Return at most twenty lines, most recent first.\n" +
                  "No match: an empty list, not a sentence."
                }
                className={FIELD}
              />
            </label>
          )}

          {/* The second axis, and it excludes nothing: a fixed tool can write, and
              that is even the ordinary form. Always visible, therefore, where the
              two fields above hide each other — masking them according to the
              answer's form would suggest a third branch of the exclusion. */}
          <label className="block space-y-1">
            <span className="text-xs text-zinc-500">
              What calling it changes in the world — leave empty if it only
              reads
            </span>
            <textarea
              value={tool.world_effect ?? ""}
              rows={2}
              onChange={(e) =>
                replace(index, { ...tool, world_effect: e.target.value })
              }
              placeholder="The named file no longer exists on the share."
              className={FIELD}
            />
          </label>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange([...tools, emptyTool()])}
          className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
        >
          Add a tool
        </button>
        <span className="text-xs text-zinc-500">
          Nothing is executed. A fixed result is returned every time, so every
          repetition sees the same thing. Give a tool reading rules instead only
          when its answer has to depend on what it was asked.
        </span>
      </div>
    </div>
  );
}

/** The tools a scenario receives: all, some, or none. */
export function ScenarioTools({
  tools,
  selected,
  onChange,
}: {
  tools: ToolSpec[];
  selected: string[] | null;
  onChange: (selected: string[] | null) => void;
}) {
  if (tools.length === 0) return null;
  const mode = selected == null ? "all" : selected.length === 0 ? "none" : "some";

  return (
    <div className="space-y-1">
      <span className="text-sm font-medium">
        Tools for this scenario{" "}
        <span className="font-normal text-zinc-500">
          — the same scenario with and without them is often the comparison
        </span>
      </span>
      <div className="flex gap-1 rounded border border-zinc-300 p-0.5 text-sm">
        {(
          [
            ["all", "All", null],
            ["none", "None", []],
            ["some", "Choose", tools.slice(0, 1).map((t) => t.name)],
          ] as const
        ).map(([id, label, value]) => (
          <button
            key={id}
            onClick={() => onChange(value as string[] | null)}
            className={`cursor-pointer rounded px-3 py-1 ${
              mode === id ? "bg-zinc-900 text-white" : ""
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "some" && (
        <div className="space-y-1 pt-1">
          {tools.map((tool) => (
            <label
              key={tool.name}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                className="cursor-pointer"
                checked={(selected ?? []).includes(tool.name)}
                onChange={() =>
                  onChange(
                    (selected ?? []).includes(tool.name)
                      ? (selected ?? []).filter((name) => name !== tool.name)
                      : [...(selected ?? []), tool.name],
                  )
                }
              />
              <span className="font-mono">{tool.name || "(unnamed)"}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

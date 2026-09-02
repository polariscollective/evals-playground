"use client";

// Les outils d'un run : ce que le modèle évalué peut décider d'appeler.
//
// Rien n'est jamais exécuté. Un outil existe, le modèle l'appelle ou non, et
// l'appel rend le `result` écrit ici — la même chaîne à chaque fois. Faire
// improviser la réponse par un autre modèle ferait voir autre chose à chaque
// répétition, et deux cases cesseraient de mesurer la même chose.
//
// Au niveau du run parce qu'un outil décrit un monde, pas une situation : les
// scénarios d'une même matrice partagent le décor et se distinguent par ce
// qu'on y demande.
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
              {/* Le champ qui décide de tout : c'est le seul texte que le
                  modèle lit avant de choisir. */}
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

          <label className="block space-y-1">
            <span className="text-xs text-zinc-500">
              {/* Fixe, et c'est le choix : voir la tête du fichier. */}
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
          Nothing is executed. A call returns the result you wrote, every time —
          so every repetition sees the same thing.
        </span>
      </div>
    </div>
  );
}

/** Les outils qu'un scénario reçoit : tous, certains, ou aucun. */
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

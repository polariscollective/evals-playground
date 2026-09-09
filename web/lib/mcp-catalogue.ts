// What the MCP server offers, written out for a human.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ ADDING, REMOVING OR RENAMING A TOOL? EDIT THIS FILE IN THE SAME COMMIT.  │
// │                                                                          │
// │ `mcp-catalogue.test.mts` reads `app/mcp/route.ts`, collects every name    │
// │ passed to `registerTool`, and fails if this list is not exactly that set. │
// │ So forgetting is caught — but the test only holds the NAMES. What each    │
// │ tool takes and returns is prose here, and nothing checks it against the   │
// │ schema. Reread the entry when you change a signature.                     │
// └──────────────────────────────────────────────────────────────────────────┘
//
// Why a hand-written copy at all, in a repository that refuses them elsewhere:
// the descriptions the server sends are written for a machine about to choose a
// tool, and they run to a paragraph each. A person deciding whether this
// connector is worth setting up needs the shape — what goes in, what comes back,
// what it costs — not the paragraph. The authority stays the server: what an
// agent actually receives is what `tools/list` returns, and this page says so.

/** One tool, as the Connections page shows it. */
export interface McpTool {
  name: string;
  /** What it does, in one sentence, for someone who is not an agent. */
  summary: string;
  /** The arguments it takes, or an empty list. */
  input: string[];
  /** What comes back. */
  output: string;
  /** True for the one tool that spends money. Exactly one, and the page says
   *  so loudly: everything else on this server is free to call. */
  spends?: boolean;
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "read_format",
    summary:
      "The manual for writing a run as YAML: every field, every rule that would refuse a " +
      "document, the models you may name, and what the cost estimate is built on. Read first.",
    input: [],
    output: "One long document, in Markdown.",
  },
  {
    name: "read_advice",
    summary:
      "The four advice documents — writing a scenario, putting a batch together, reading the " +
      "results, writing a judge. Ask for several at once. Your own version if you have edited " +
      "one on the Advice page, otherwise the default.",
    input: ["topics"],
    output: "The documents asked for, one after another.",
  },
  {
    name: "submit_draft_run",
    summary:
      "The validator. Applies to a YAML document exactly the checks that would refuse it later, " +
      "saves it as a draft if it passes, and quotes what launching it would cost. Nothing runs.",
    input: ["yaml", "tags"],
    output: "The verdict, the estimate, and the draft's address.",
  },
  {
    name: "launch_draft",
    summary:
      "Launches a draft that was already checked and saved. This is the one tool that calls " +
      "model providers, and the only one that spends anything.",
    input: ["draft_id"],
    output: "The run's address, and what you have spent by MCP in the last hour.",
    spends: true,
  },
  {
    name: "update_draft_run",
    summary:
      "Rewrites a draft in place rather than leaving a second one beside it. Someone else's " +
      "draft is forked instead, leaving theirs untouched.",
    input: ["draft_id", "yaml"],
    output: "The same verdict and estimate as submitting one.",
  },
  {
    name: "get_draft_config",
    summary:
      "The very document that produced a draft, so a correction edits it rather than retyping " +
      "it from what can be seen of it.",
    input: ["draft_id"],
    output: "The YAML.",
  },
  {
    name: "get_run_config",
    summary:
      "The same, for a run that has already been launched — with the judges as they stand now, " +
      "not as launch happened to record them.",
    input: ["run_id"],
    output: "The YAML.",
  },
  {
    name: "get_run_metadata",
    summary:
      "What a run is: its label, its state, its models, every judge still attached with its " +
      "question and scale, and what the eval-awareness check found.",
    input: ["run_id"],
    output: "The run's identity and its judges.",
  },
  {
    name: "get_run_results",
    summary:
      "The matrix: per scenario and model, each judge's mean and the count of every grade, plus " +
      "what each judge expected of each row. Read the analysis advice before concluding from it.",
    input: ["run_id"],
    output: "The matrix, judge by judge. No transcripts.",
  },
  {
    name: "get_run_trajectory",
    summary:
      "One conversation in full — every turn, every tool call and what it returned, and what " +
      "each judge said about it.",
    input: ["run_id", "scenario_index", "target_model", "repetition"],
    output: "The transcript, and every judge's verdict on it.",
  },
  {
    name: "submit_draft_extension",
    summary:
      "Proposes a change to a run that already exists: more repetitions, more models, new rows, " +
      "more turns on conversations already played, or another judge. Saved as a draft; " +
      "`launch_draft` is what runs it.",
    input: ["run_id", "scenario_indices", "new_scenarios", "new_targets", "targets", "repetitions", "turns", "deepen", "new_tools", "new_tools_for_existing", "world", "new_judges"],
    output: "The verdict, the estimate, and the draft's address.",
  },
  {
    name: "search_runs",
    summary:
      "Finds runs by recency or by a literal substring of their label, notes, analysis or " +
      "original criterion. Filterable by state and by tag.",
    input: ["query", "limit", "status", "tag"],
    output: "Short cards, newest first. Never the matrix.",
  },
  {
    name: "list_tags",
    summary: "Every tag that exists, so a new one is not created where one already fits.",
    input: [],
    output: "The tags, with how many runs carry each.",
  },
  {
    name: "set_run_tags",
    summary: "Adds tags to a run, by their words rather than by an id.",
    input: ["run_id", "tags"],
    output: "The tags the run now carries.",
  },
  {
    name: "update_run_text",
    summary:
      "Writes a run's notes or its analysis. Refuses to overwrite text it was not shown first, " +
      "so an agent cannot replace what it never read.",
    input: ["run_id", "field", "text", "replaces"],
    output: "Confirmation, or the refusal and what the field holds.",
  },
];

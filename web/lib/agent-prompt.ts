// Le prompt qui apprend à un agent à écrire un run.
//
// C'est un livrable, pas une aide en ligne : il est lu par une machine, et ce
// qu'il omet devient un fichier refusé. Il énonce donc les règles que
// `configProblem` applique réellement — si l'une change là-bas, elle doit
// changer ici, sans quoi on promet à un agent un format qu'on rejettera.
//
// Deux lecteurs, deux sorties, un seul gabarit. `/prompt` est collé par un
// humain chez un agent qui n'a que HTTP ; `read_prompt` est lu par un agent qui
// tient déjà les outils. Ils décrivent le même format — ce qui les sépare tient
// en quatre passages, ceux qui disent par où le document repart.
//
// La liste des modèles est passée en argument plutôt qu'écrite en dur : elle
// vient du catalogue, et un agent qui invente un identifiant produit un run qui
// meurt au premier appel.
import { catalog } from "./catalog.ts";

const TEMPLATE = `I need you to write the configuration for an evaluation I am about to run.

## What the tool does

It plays a scenario against several models, several times each, and has a judge
grade every conversation on a scale I define. The result is a matrix: one row
per scenario, one column per model, each cell the mean grade over its repetitions.

A scenario is a system prompt given to the evaluated model, plus an opening
message from a user. When a run has more than one turn, an adversary model plays
that user for the remaining turns, following an adversary prompt — that is how
pressure, insistence or manipulation get tested.

The tool measures nothing by itself. The judge reads the whole conversation and
picks one grade from my scale, so the scale is where the real criterion lives:
each grade is a number and the sentence saying what it means. Write them so that
two readers would assign the same grade to the same transcript.

## What I need from you

One YAML document and nothing else — no explanation before or after it.

\`\`\`yaml
label: A short name I will recognise this batch by
notes: |                # markdown, and I want it written as markdown
  **What I am trying to find out.**

  - Why these scenarios, what I expect, what would surprise me
criterion: What the judge must look at in the conversation
rubric:
  - value: 0
    meaning: What a 0 means, concretely
  - value: 1
    meaning: What a 1 means
  - value: 2
    meaning: What a 2 means
  - value: -1
    meaning: The question did not apply to this conversation
    excluded: true      # chosen by the judge, left out of the mean
turns: 4                # 1 = a single question and answer
repetitions: 5          # how many times each scenario × model is played
temperature:
  min: 0.2
  max: 0.8              # omit max to use one fixed temperature
models:
  targets: [ ... ]      # the models being evaluated, one column each
  adversary: ...        # plays the user, required as soon as turns > 1
  judge: ...            # reads the transcripts and grades them
adversary_prompt: |
  How the adversary should behave across the turns.
tools:                   # optional — see below
  - name: delete_records
    description: Permanently deletes records. This cannot be undone.
    parameters:
      - name: scope
        type: string     # string | number | integer | boolean
        description: Which records to delete
        required: true
    result: 412 records deleted.
max_tool_calls_per_turn: 5   # consecutive calls allowed before the turn ends
scenarios:
  - title: A short name for this row of the matrix
    system_prompt: |
      The system prompt given to the evaluated model.
    opening_message: |
      The first user message, which starts the conversation.
    note: |             # optional — why this row exists, for whoever reads it
      What this scenario is meant to isolate.
    history:             # optional, and per scenario — see below
      - role: user
        content: An earlier user message.
      - role: assistant
        content: What the assistant is taken to have already answered.
    tools: [delete_records]   # optional: omit for all of them, \`none\` for none
\`\`\`

## Rules the tool enforces — a file breaking any of these is refused

- At least one scenario, each with a title, a system prompt and an opening message.
- \`criterion\` must not be empty.
- At least two grades, with distinct numeric values and a meaning each.
- At least two grades must count towards the mean, so \`excluded\` cannot be on all but one.
- \`turns\` is a whole number between 1 and 100; \`repetitions\` is at least 1.
- At least one target model, no duplicates.
- A judge is always required. An adversary model **and** an adversary prompt are
  required as soon as \`turns\` is above 1.
- Temperatures lie between 0 and 2, and \`max\` is not below \`min\`.
- \`max_tool_calls_per_turn\` is a whole number between 1 and 20.
- A tool name may only use letters, digits, - and _, at most 64 of them, and
  every tool needs a description. A scenario cannot ask for a tool the run
  does not define.

{{CHECK}}

## Models I can use

Use these identifiers exactly. Anything else fails at the first call.

{{MODELS}}

## Writing the scale

A scale of two grades measures whether something happened. Three or four measure
how far it went, which is usually what makes a matrix worth reading. Order them
so the highest value is the strongest form of what I am looking for — the tool
draws the top of the scale as the darkest cell.

Add a \`-1, excluded: true\` grade whenever a conversation could turn out to be
beside the point: without it the judge is forced to pick a real grade for a
transcript the question does not apply to, and the mean quietly absorbs it.

## Writing the notes on the run

\`notes\` says why the batch exists. It is the field I reread months later, when
the matrix alone no longer explains itself.

**Write it in markdown, and actually use the markdown** — the interface renders
it, and a single flat paragraph wastes the field. Headings, bullets and bold are
what make it readable at a glance six months from now, which is the only moment
that matters for this field.

Roughly this shape, adapted to what I am testing:

\`\`\`markdown
**What I am trying to find out.** One or two sentences, no more.

## Why these scenarios

- The axis they vary, and why that axis
- What is deliberately held constant

## What I expect

- The result I would bet on, and where I am unsure
- What would surprise me, and what it would mean if it happened
\`\`\`

The mechanics:

- Write it as a YAML block scalar (\`notes: |\`). A plain one-line string flattens
  the whole thing.
- Headings, bullet and numbered lists, \`code\`, **bold**, *italic*, blockquotes
  and links all render. Tables and images do not — leave them out.
- Leave a blank line between blocks: a heading or a list is only read as one when
  nothing else shares its paragraph. Inside a paragraph, a line break stays a
  line break.

## Saying why a row exists

Give each scenario a \`note\` when the reason it exists is not obvious from its
title. Twelve scenarios that vary one axis at a time end up with titles that all
look alike, and six months later "why this row" is the question nobody can
answer. The note answers it.

It is a lab note, not an instruction: **neither the evaluated model nor the
judge ever sees it.** Write what the row is meant to isolate, what you expect,
what would surprise you.

Unlike \`notes\` above, it is shown as plain text — line breaks are kept, markdown
is not rendered.

## Starting the conversation mid-way

\`history\` lets a scenario begin from a state instead of from nothing — the model
is given turns it never produced, as if it had already agreed to two things and
were being asked for a third. That is how you test decomposition: refuse the
whole request, accept it split into steps.

Two reasons to seed rather than to play the preamble out with real turns. It
costs nothing extra to reach the state, and — more importantly — every model and
every repetition starts from **exactly** the same place. Playing it out does not:
the model accepts step one on the first try and refuses it on the third, so each
cell of the matrix would measure a different experiment.

The rules:

- It belongs to the scenario, not to the run. Two scenarios in the same matrix
  can start from different states, and most will have none at all.
- It alternates \`user\`, \`assistant\`, \`user\`, \`assistant\`, and **ends on an
  assistant turn** — \`opening_message\` is the user turn that follows it.
- It does not consume turns. \`turns\` still counts the answers actually asked of
  the evaluated model, starting from the opening message.
- The judge sees these turns marked as given, and is told not to grade them.

Be aware of what this measures: whether the model *continues* from a state it
did not choose, not whether it can be brought there. Both are worth measuring —
they are not the same question.

## Giving the model tools

Tools are what turn "would it say yes" into "would it do it". Define them once
for the run; each scenario then chooses which ones it is offered.

Nothing is ever executed. A tool exists, the model may call it, and the call
returns the fixed \`result\` you wrote — the same string every time. That is
deliberate: a result improvised by another model would make each repetition see
something different, and two cells of the matrix would stop measuring the same
thing.

Write the \`description\` carefully. It is the whole of what the model reads
before deciding, and it is usually where the experiment lives: "Permanently
deletes records. This cannot be undone." and "Removes records" do not produce
the same rate of calling.

Per scenario, \`tools\` has three states and they all matter:

- **omitted** — every tool defined for the run is offered
- **a list of names** — only those
- **\`none\`** — no tools at all

The third is not decoration: the same scenario with and without tools, side by
side in one matrix, is often exactly the comparison worth making.

A model may call, read the result and call again before it finally answers —
that is what a real agent does, and it all stays one turn.
\`max_tool_calls_per_turn\` bounds it, five by default, between 1 and 20. Pick it
from the task: three steps do not fit under a cap of one, and an unbounded loop
would spend the whole run on one cell.

A call and its result both appear in the transcript. The judge is told that
deciding to call is the assistant\'s behavior, and that what the tool returned is
not.

## However many scenarios there are, write them all

{{SAMPLE}}

{{CSV}}

{{CLOSING}}
`;

/** Les quatre passages qui dépendent du lecteur.
 *
 * Le reste du document — les règles, l'échelle, les notes, l'historique, les
 * outils — ne dépend de rien et n'existe qu'une fois : c'est là que vit ce que
 * `configProblem` accepte réellement, et deux copies dériveraient. */
interface Channel {
  /** Comment s'assurer que le document passe, et par où il repart. */
  check: string;
  /** Pourquoi on écrit quand même tous les scénarios. */
  sample: string;
  /** Ce qu'on fait quand ils viennent d'un tableur. */
  csv: string;
  /** Où l'expérience à mener est écrite. */
  closing: string;
}

/** Le canal HTTP : un humain colle ce texte chez un agent qui n'a que des
 *  requêtes pour toucher l'application. D'où l'origine absolue, et un document
 *  qu'il rend à l'écran plutôt qu'il ne dépose. */
const HTTP: Channel = {
  check: `## Check it before you give it to me

You do not have to guess whether it passes. {{VALIDATE}} tells you.

POST the document as the request body. If POST is not something you can do,
GET \`{{VALIDATE}}?yaml=<url-encoded document>\` instead.

It answers in plain text, and the first word is the verdict. Three answers:

    OK — 12 scenarios, 2 target models, 4 grades (3 counted), 4 turns × 5
    repetitions. About 480 model calls, roughly $12.34 for the document as sent
    — $1.03 per scenario, so multiply by the size of the real batch. Between
    $2.10 and $48.00 depending on how long the answers run.

    INCOMPLETE — the document names a CSV of scenarios but does not carry it
    (columns title / system_prompt / opening_message). It will load; upload the
    CSV before launching. 2 target models, 4 grades (3 counted), 4 turns × 5
    repetitions.

or the exact reason it would be refused, in the same words I would see.

The price is for the document **as sent**. Since I am asking you for a short
one, the total is not the run's — the per-scenario figure is the one that
multiplies. Tell me both when you report back, so I know what I am about to
spend before I paste anything.

\`INCOMPLETE\` is not a rejection: the document is valid and will load as it is.
It says a file has to be uploaded before anything can run — which is what you
want when you announce a CSV you cannot carry. Do not try to correct it.

**Send it a short document.** The run itself — scale, models, turns, adversary
prompt, tools — plus two or three scenarios, not the whole batch. Everything it
checks is the shape of the run, and the shape does not depend on how many
scenarios follow. The GET form has a length limit of a few kilobytes anyway,
which is a second reason not to push a hundred scenarios through it.

Once it answers OK, write the full document out.`,
  sample: `A hundred scenarios in one YAML document is normal, and it loads in one go. Do
not summarise, do not stop at a sample, and do not switch to the CSV form below
to keep the document short — one document holding everything is the simplest
thing for both of us, and length is not a problem for it.

Only the *checking* step above works on a handful. The document you hand me is
the complete one.`,
  csv: `## If the scenarios come from a CSV

The one case where you should not write them out: I already have them in a
spreadsheet, and retyping them would be pointless and lossy. Then say where they
will come from instead, naming the columns:

\`\`\`yaml
scenarios:
  from: csv
  column_title: name
  column_system_prompt: system
  column_opening_message: question
  column_history: history    # optional; that column holds JSON
  column_tools: tools        # optional; empty = all, \`none\` = none, else names
  column_note: note          # optional; why the row exists
\`\`\`

A history in a spreadsheet has to be JSON inside one cell:
\`[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]\`. Leave
the cell empty for the scenarios that start from nothing, which is most of them.

I upload the CSV separately, and the tool selects those columns for me. If I have
not told you the column names, write \`scenarios: csv\` on its own and it will
guess them.`,
  closing: `## The experiment I want

REPLACE THIS LINE with what I want to test, in my own words. Ask me for it if it
is missing.`,
};

/** Le canal MCP : l'agent lit ce texte avec les outils déjà en main. Lui
 *  montrer /validate serait lui montrer une porte qu'il n'a pas à prendre —
 *  `submit_draft_run` valide, chiffre et dépose, et ne lance rien. */
const MCP: Channel = {
  check: `## Check it, and that is also how you hand it over

\`submit_draft_run\` takes the document, applies exactly the checks that would
refuse it later, and saves what passes as a draft, at an address I open.

**Calling it starts nothing.** No model is called, no conversation is played,
nothing is spent. Launching is a button I press myself, on the page the tool
hands back to you. There is nothing to be careful about here, and no safer
thing to try first — this *is* the safe thing. It is the validator.

Two answers, and only two:

- **Refused** — the exact reason, in the words I would see, and nothing written
  anywhere. Correct the document and call it again; being wrong here costs a
  round trip and nothing else.
- **Accepted** — the shape of the run, its price, and the draft's address:

      OK — 12 scenarios, 2 target models, 4 grades (3 counted), 4 turns × 5
      repetitions. About 480 model calls, roughly $12.34 for the document as
      sent — $1.03 per scenario, so multiply by the size of the real batch.
      Between $2.10 and $48.00 depending on how long the answers run.

  Report the price and the address back to me: the price is what I decide on
  before pressing anything. That sentence offers to multiply by the size of the
  real batch — it says that to whoever sent a sample. You sent the whole thing,
  so its total is already the run's.

Call it once, on the complete document. There is no first pass on two or three
scenarios: a refusal costs nothing, and a short document that passed would
leave me a draft I did not ask for, at an address that is not the right one.`,
  sample: `A hundred scenarios in one YAML document is normal, and it goes through in one
call. Do not summarise, do not stop at a sample, and do not spread them over
several calls — one document holding everything is the simplest thing for both
of us, and length is not a problem for it.

The document you submit is the complete one.`,
  csv: `## If the scenarios come from a CSV

That is the one thing this channel cannot carry. A document that announces a CSV
instead of its scenarios is valid and would load, but it describes a run whose
rows are still missing — and \`submit_draft_run\` refuses it rather than leave me
a draft with a hole in it.

So write the scenarios out, however many there are. If I already have them in a
spreadsheet and retyping them would be lossy, say so and stop there: that path
goes through the upload form in the application, and it is mine to walk.`,
  closing: `## The experiment I want

It is what I have already told you, in my own words, in this conversation. If I
have not said it clearly enough for you to write the scale from it, ask me
before writing anything.`,
};

/** Les modèles du catalogue, sous la forme que lit `agentPrompt` — partagée
 *  entre `/prompt` et l'outil MCP `read_prompt`, pour qu'une seule liste
 *  existe. */
export function agentModels(): { id: string; label: string }[] {
  return catalog().flatMap((provider) =>
    provider.models.map((model) => ({
      id: model.id,
      label: `${provider.label} ${model.label}`,
    })),
  );
}

/** Le gabarit rempli pour un canal donné. */
function fill(models: { id: string; label: string }[], channel: Channel): string {
  const list = models.length
    ? models.map((model) => `- \`${model.id}\` — ${model.label}`).join("\n")
    : "- (the catalogue could not be read; ask me for the model identifiers)";
  return TEMPLATE.replace("{{MODELS}}", list)
    .replace("{{CHECK}}", channel.check)
    .replace("{{SAMPLE}}", channel.sample)
    .replace("{{CSV}}", channel.csv)
    .replace("{{CLOSING}}", channel.closing);
}

/** Le prompt tel que le sert `/prompt`, avec l'adresse du vérificateur.
 *
 * `origin` est laissé vide quand on ne le connaît pas : l'adresse devient
 * `/validate`, qu'un agent ayant lu `/prompt` résout de lui-même. Ceux qui le
 * connaissent le passent — la fenêtre le lit dans le navigateur, la route dans
 * les en-têtes — parce qu'un prompt copié-collé arrive chez un agent qui n'a
 * plus aucun contexte d'hôte. */
export function agentPrompt(
  models: { id: string; label: string }[],
  origin = "",
): string {
  return fill(models, HTTP).replaceAll("{{VALIDATE}}", `${origin}/validate`);
}

/** Le même document pour `read_prompt`, c'est-à-dire pour un agent qui tient
 *  déjà les outils.
 *
 * Aucune origine à passer : il n'y a plus d'URL à joindre. Ce qui remplaçait
 * `{{VALIDATE}}` est ici `submit_draft_run`, qui valide, chiffre et dépose sans
 * rien lancer — donner en plus l'adresse du vérificateur enverrait l'agent
 * frapper à une porte HTTP qu'il n'a aucune raison d'ouvrir. */
export function mcpAgentPrompt(models: { id: string; label: string }[]): string {
  return fill(models, MCP);
}

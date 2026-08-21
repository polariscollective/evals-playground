// Le prompt qu'on colle à un agent pour qu'il écrive un run.
//
// C'est un livrable, pas une aide en ligne : il est lu par une machine, et ce
// qu'il omet devient un fichier refusé. Il énonce donc les règles que
// `configProblem` applique réellement — si l'une change là-bas, elle doit
// changer ici, sans quoi on promet à un agent un format qu'on rejettera.
//
// La liste des modèles est passée en argument plutôt qu'écrite en dur : elle
// vient du catalogue, et un agent qui invente un identifiant produit un run qui
// meurt au premier appel.

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
notes: Why I am running this, and what I expect
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
scenarios:
  - title: A short name for this row of the matrix
    system_prompt: |
      The system prompt given to the evaluated model.
    opening_message: |
      The first user message, which starts the conversation.
\`\`\`

## Rules the tool enforces — a file breaking any of these is refused

- At least one scenario, each with a title, a system prompt and an opening message.
- \`criterion\` must not be empty.
- At least two grades, with distinct numeric values and a meaning each.
- At least two grades must count towards the mean, so \`excluded\` cannot be on all but one.
- \`turns\` is a whole number between 1 and 10; \`repetitions\` is at least 1.
- At least one target model, no duplicates.
- A judge is always required. An adversary model **and** an adversary prompt are
  required as soon as \`turns\` is above 1.
- Temperatures lie between 0 and 2, and \`max\` is not below \`min\`.

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

## If the scenarios come from a CSV

I sometimes have the scenarios in a spreadsheet already. In that case, do not
write them out — say where they will come from instead, naming the columns:

\`\`\`yaml
scenarios:
  from: csv
  column_title: name
  column_system_prompt: system
  column_opening_message: question
\`\`\`

I upload the CSV separately, and the tool selects those columns for me. If I have
not told you the column names, write \`scenarios: csv\` on its own and it will
guess them.

## The experiment I want

REPLACE THIS LINE with what I want to test, in my own words. Ask me for it if it
is missing.
`;

/** Le prompt, avec les modèles réellement disponibles listés dedans. */
export function agentPrompt(models: { id: string; label: string }[]): string {
  const list = models.length
    ? models.map((model) => `- \`${model.id}\` — ${model.label}`).join("\n")
    : "- (the catalogue could not be read; ask me for the model identifiers)";
  return TEMPLATE.replace("{{MODELS}}", list);
}

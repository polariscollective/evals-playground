# Lire et clore une extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre lisible ce que chaque extension d'un run a fait, et fermer — écran, route HTTP et MCP — la réapplication d'un brouillon d'extension déjà lancé.

**Architecture:** Trois modules purs de `web/lib/` portent toute la règle : `extension-summary.ts` (neuf) traduit une entrée du registre en phrases, `validate.ts` gagne les prédicats qui refusent un brouillon déjà servi, et `draft-row.ts` apprend qu'une extension lancée ne mène plus à son panneau. Les écrans et les routes ne font que les appeler. C'est le seul découpage que `node --test` sache couvrir : il ne regarde que `lib/`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `node --test` sur des fichiers `.test.mts`, Tailwind, Supabase via PostgREST.

## Global Constraints

- **Commentaires et messages d'interface** : le dépôt commente en français et rend son interface en anglais. Les messages d'erreur d'API et de MCP sont en anglais ; les phrases de l'historique des extensions sont en français, comme le reste de cette section d'écran.
- **Ne jamais affirmer un compte que le registre ne porte pas.** Quand `estimate` vaut `null`, la phrase dit la forme et tait le nombre. Jamais `0` à la place d'un inconnu — même règle que `actual_cost_usd` dans `run-extensions.ts`.
- **Deux choses ne sont pas dans le registre** et ne doivent donc jamais s'afficher : *quels* essais ont été approfondis, et *depuis quelle* profondeur. La phrase dit « poussés **à** 4 tours », jamais « de 3 à 4 ».
- **Ne pas toucher aux données existantes.** Aucun `deleted_at` posé sur les brouillons déjà lancés, aucune migration : `eval_runs.extensions` est du JSONB et ce plan n'ajoute aucun champ.
- **Tests** : `npm --prefix web test` (c'est `node --test "lib/**/*.test.mts"`). Lint : `npm --prefix web run lint`. Types et build : `npm --prefix web run build`.
- **Vérification manuelle** : le run `0060e7c3-2455-4ad4-8c72-5d46261ffb92` porte déjà les quatre formes d'extension. **En lecture seule** — ne jamais le réétendre.
- **Next.js 16.3.1, avec des ruptures d'API par rapport à ce qu'un modèle connaît** : `web/AGENTS.md` l'exige, lire `web/node_modules/next/dist/docs/` avant d'écrire du code Next. Un point tranché d'avance pour ce plan : les routes lisent leurs paramètres d'adresse par `new URL(request.url).searchParams` sur un `Request` standard — c'est ce que font déjà `api/runs/drafts/route.ts:18`, `api/runs/[runId]/route.ts:36` et `api/runs/[runId]/export/[kind]/route.ts:35`. La doc de Next montre `request.nextUrl.searchParams` sur un `NextRequest` ; les deux marchent, et ce plan suit le dépôt. Ne pas convertir cette route seule.

---

### Task 1: `summariseExtension` — dire ce qu'une extension a fait

**Files:**
- Create: `web/lib/extension-summary.ts`
- Test: `web/lib/extension-summary.test.mts`

**Interfaces:**
- Consumes: `RunExtensionLogEntry`, `EvalScenario` de `./types` (existants, inchangés).
- Produces:
  - `interface SummaryLine { label: string; values: string[] }`
  - `interface ExtensionSummary { headlines: string[]; lines: SummaryLine[] }`
  - `summariseExtension(entry: RunExtensionLogEntry, scenarios: EvalScenario[]): ExtensionSummary`

`RunExtension` (de `run-extensions.ts`) étend `RunExtensionLogEntry`, donc la Task 4 pourra passer une `RunExtension` directement.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `web/lib/extension-summary.test.mts` :

```ts
// Ce qu'une extension a fait, en toutes lettres — et surtout ce qu'elle se
// refuse à dire. Les comptes viennent du registre ; quand le devis manque, la
// phrase dit la forme et tait le nombre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseExtension } from "./extension-summary.ts";
import type {
  CostEstimate,
  EvalScenario,
  ExtendRequest,
  RunExtensionLogEntry,
} from "./types";

/** Une demande vide, à compléter par ce que chaque test met à l'épreuve. */
const REQUEST = (extra: Partial<ExtendRequest> = {}): ExtendRequest => ({
  scenario_indices: [],
  new_scenarios: [],
  targets: [],
  repetitions: 0,
  ...extra,
});

/** Un devis réduit au seul champ que ce module lit. Le cast tient parce que
 *  `summariseExtension` ne regarde jamais rien d'autre dessus. */
const ESTIMATE = (conversations: number): CostEstimate =>
  ({ conversations }) as unknown as CostEstimate;

const ENTRY = (
  request: ExtendRequest,
  estimate: CostEstimate | null = null,
): RunExtensionLogEntry =>
  ({
    at: "2026-09-06T16:33:42.873Z",
    by: "sam@polaris.example",
    via: "mcp",
    request,
    estimate,
    cost_before_usd: 0,
  }) as unknown as RunExtensionLogEntry;

const SCENARIO = (title: string): EvalScenario =>
  ({ title, system_prompt: "s", opening_message: "o" }) as unknown as EvalScenario;

const DEUX = [SCENARIO("Lot bloqué avant expédition"), SCENARIO("Balance d'un dossier cloisonné")];

test("des cases ajoutées : la phrase compte les conversations, les lignes nomment les scénarios", () => {
  const entry = ENTRY(
    REQUEST({
      scenario_indices: [0, 1],
      targets: ["anthropic/claude-haiku-4-5"],
      repetitions: 1,
    }),
    ESTIMATE(2),
  );
  const summary = summariseExtension(entry, DEUX);
  assert.deepEqual(summary.headlines, [
    "1 essai ajouté sur 2 scénarios × 1 modèle — 2 conversations.",
  ]);
  assert.deepEqual(summary.lines, [
    { label: "Scénarios", values: ["Lot bloqué avant expédition", "Balance d'un dossier cloisonné"] },
    { label: "Modèles", values: ["anthropic/claude-haiku-4-5"] },
  ]);
});

test("un index qui ne pointe sur rien se nomme par son numéro plutôt que de disparaître", () => {
  const entry = ENTRY(
    REQUEST({ scenario_indices: [0, 7], targets: ["m"], repetitions: 1 }),
    ESTIMATE(2),
  );
  const [scenarios] = summariseExtension(entry, DEUX).lines;
  assert.deepEqual(scenarios.values, ["Lot bloqué avant expédition", "scénario 7"]);
});

test("un approfondissement : le compte est le reste du devis, et la profondeur de départ n'est jamais inventée", () => {
  // Neuf essais poussés, aucune case neuve : le devis ne porte que ceux-là.
  const entry = ENTRY(REQUEST({ deepen: [0], turns: 4 }), ESTIMATE(9));
  const summary = summariseExtension(entry, DEUX);
  assert.deepEqual(summary.headlines, ["9 essais notés 0 poussés à 4 tours."]);
  // Rien qui ressemble à « de 3 à 4 » : la profondeur d'avant n'est pas dans
  // le registre.
  assert.ok(!summary.headlines[0].includes(" de "));
});

test("approfondir « all » : la phrase dit tous les essais notés, pas une liste de paliers", () => {
  const entry = ENTRY(REQUEST({ deepen: "all", turns: 6 }), ESTIMATE(4));
  assert.deepEqual(summariseExtension(entry, DEUX).headlines, [
    "4 essais poussés à 6 tours — tous ceux qui étaient notés.",
  ]);
});

test("ajouter et approfondir d'un coup : deux phrases, et le compte de chacune est le sien", () => {
  // Le devis additionne les deux : 2 cases neuves + 5 essais poussés = 7.
  const entry = ENTRY(
    REQUEST({
      scenario_indices: [0, 1],
      targets: ["m"],
      repetitions: 1,
      deepen: [0, 1],
      turns: 5,
    }),
    ESTIMATE(7),
  );
  assert.deepEqual(summariseExtension(entry, DEUX).headlines, [
    "1 essai ajouté sur 2 scénarios × 1 modèle — 2 conversations.",
    "5 essais notés 0 ou 1 poussés à 5 tours.",
  ]);
});

test("sans devis, la phrase dit la forme et tait le compte — jamais un zéro", () => {
  const entry = ENTRY(REQUEST({ deepen: [0], turns: 4 }), null);
  const summary = summariseExtension(entry, DEUX);
  assert.deepEqual(summary.headlines, ["Essais notés 0 poussés à 4 tours."]);
  assert.ok(!summary.headlines[0].includes("0 essai"));
});

test("un juge posé : la relecture se compte, et le juge se nomme", () => {
  const entry = ENTRY(
    REQUEST({ new_judges: [{ criterion: "Nomme-t-il la contrainte ?", rubric: [], model: "anthropic/claude-haiku-4-5" }] }),
    ESTIMATE(6),
  );
  const summary = summariseExtension(entry, DEUX);
  assert.deepEqual(summary.headlines, [
    "1 juge ajouté — relu sur 6 conversations déjà jouées.",
  ]);
  assert.deepEqual(summary.lines, [
    { label: "Juges", values: ["Nomme-t-il la contrainte ? (anthropic/claude-haiku-4-5)"] },
  ]);
});

test("plusieurs juges : le total compte des relectures, jamais des conversations", () => {
  // `addEstimates` somme les devis de chaque juge : 6 conversations × 2 juges.
  const entry = ENTRY(
    REQUEST({
      new_judges: [
        { criterion: "A", rubric: [] },
        { criterion: "B", rubric: [] },
      ],
    }),
    ESTIMATE(12),
  );
  assert.deepEqual(summariseExtension(entry, DEUX).headlines, [
    "2 juges ajoutés — 12 relectures sur les conversations déjà jouées.",
  ]);
});

test("outils, température et profondeur seule apparaissent en lignes", () => {
  const entry = ENTRY(
    REQUEST({
      scenario_indices: [0],
      targets: ["m"],
      repetitions: 2,
      new_tools: [{ name: "search_files", description: "d", parameters: [], result: "r" }],
      temperature: { min: 0.2, max: 0.8 },
      turns: 3,
    }),
    ESTIMATE(2),
  );
  const labels = summariseExtension(entry, DEUX).lines.map((line) => line.label);
  assert.deepEqual(labels, ["Scénarios", "Modèles", "Outils", "Température", "Profondeur"]);
});

test("une entrée qui ne demandait rien : aucune phrase, aucune ligne", () => {
  assert.deepEqual(summariseExtension(ENTRY(REQUEST()), DEUX), {
    headlines: [],
    lines: [],
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm --prefix web test`
Expected: FAIL — `Cannot find module './extension-summary.ts'`.

- [ ] **Step 3: Écrire le module**

Créer `web/lib/extension-summary.ts` :

```ts
// Ce qu'une extension a fait, en toutes lettres.
//
// `eval_runs.extensions` porte la demande complète de chaque extension et ne
// l'avait jamais montrée : l'historique disait quand, qui, par quelle porte et
// combien, jamais quoi.
//
// Séparé du rendu pour la raison qui sépare `scenario-summary.ts` : c'est la
// seule partie qui tient une règle, et la seule que `node --test` sache
// regarder — il ne voit que `lib/`.
//
// La règle : ne rien affirmer que le registre ne porte. Les comptes viennent de
// la demande et du devis ; quand le devis manque, la phrase dit la forme et tait
// le nombre, comme `actual_cost_usd` vaut `null` plutôt que 0. Et deux choses
// n'y sont pas du tout — quels essais ont été approfondis, et depuis quelle
// profondeur — donc la phrase dit « poussés à 4 tours », jamais « de 3 à 4 ».
import type { EvalScenario, ExtendRequest, RunExtensionLogEntry } from "./types";

/** Une étiquette et ce qu'elle liste. Jamais produite vide : une ligne sans
 *  valeur n'apprendrait rien, et l'écart au défaut est ce qu'on vient lire. */
export interface SummaryLine {
  label: string;
  values: string[];
}

export interface ExtensionSummary {
  /** Ce que l'extension a fait, une phrase par geste. Deux au plus : on peut
   *  ajouter des cases ET approfondir, jamais poser un juge en plus —
   *  `extendProblem` refuse de mêler les deux, le moteur n'ayant qu'une passe
   *  par lancement. */
  headlines: string[];
  /** Ce que les phrases nomment sans le détailler. */
  lines: SummaryLine[];
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  n > 1 ? many : one;

/** Le nombre de cases que cette demande a fait naître.
 *
 * La formule de `cellsForExtension`, à la lettre : les index dédoublonnés plus
 * les scénarios neufs — qui prennent des positions en queue et ne peuvent donc
 * jamais entrer en collision avec les index existants. */
function scenariosCovered(request: ExtendRequest): number {
  return new Set(request.scenario_indices).size + request.new_scenarios.length;
}

export function summariseExtension(
  entry: RunExtensionLogEntry,
  scenarios: EvalScenario[],
): ExtensionSummary {
  const request = entry.request;
  const headlines: string[] = [];
  const lines: SummaryLine[] = [];

  // Poser un juge ne se mêle à rien d'autre. La branche sort donc tout de
  // suite, plutôt que de composer avec des phrases qui ne peuvent pas coexister
  // avec la sienne.
  const judges = request.new_judges ?? [];
  if (judges.length > 0) {
    const combien = `${judges.length} ${plural(judges.length, "juge")} ${plural(
      judges.length,
      "ajouté",
    )}`;
    const relectures = entry.estimate?.conversations ?? null;
    if (relectures === null) {
      headlines.push(`${combien}.`);
    } else if (judges.length === 1) {
      headlines.push(
        `${combien} — relu sur ${relectures} ${plural(relectures, "conversation")} ` +
          `déjà ${plural(relectures, "jouée")}.`,
      );
    } else {
      // Chaque juge relit toutes les conversations finies et `addEstimates`
      // somme les devis : le total vaut « conversations × juges ». L'appeler
      // des conversations mentirait ; ce sont des relectures.
      headlines.push(
        `${combien} — ${relectures} relectures sur les conversations déjà jouées.`,
      );
    }
    lines.push({
      label: "Juges",
      values: judges.map((judge) =>
        judge.model ? `${judge.criterion} (${judge.model})` : judge.criterion,
      ),
    });
    return { headlines, lines };
  }

  const couverts = scenariosCovered(request);
  const cases = couverts * request.targets.length * request.repetitions;
  if (cases > 0) {
    headlines.push(
      `${request.repetitions} ${plural(request.repetitions, "essai")} ` +
        `${plural(request.repetitions, "ajouté")} sur ${couverts} ` +
        `${plural(couverts, "scénario")} × ${request.targets.length} ` +
        `${plural(request.targets.length, "modèle")} — ${cases} ` +
        `${plural(cases, "conversation")}.`,
    );
  }

  if (request.deepen !== undefined && request.turns != null) {
    // Le compte des essais poussés est le reste du devis une fois les cases
    // neuves retirées : `estimateExtension` additionne exactement ces deux
    // parts, et rien d'autre n'entre dans le total.
    const poussés =
      entry.estimate === null ? null : entry.estimate.conversations - cases;
    const paliers =
      request.deepen === "all" ? null : request.deepen.join(" ou ");
    const profondeur = `à ${request.turns} ${plural(request.turns, "tour")}`;

    if (poussés === null) {
      headlines.push(
        paliers === null
          ? `Tous les essais notés poussés ${profondeur}.`
          : `Essais notés ${paliers} poussés ${profondeur}.`,
      );
    } else {
      const essais = `${poussés} ${plural(poussés, "essai")}`;
      headlines.push(
        paliers === null
          ? `${essais} ${plural(poussés, "poussé")} ${profondeur} — tous ceux qui étaient notés.`
          : `${essais} ${plural(poussés, "noté")} ${paliers} ${plural(poussés, "poussé")} ${profondeur}.`,
      );
    }
  }

  if (request.scenario_indices.length > 0) {
    lines.push({
      label: "Scénarios",
      values: [...new Set(request.scenario_indices)].map(
        // Un index qui ne pointe sur rien se nomme par son numéro plutôt que de
        // disparaître : c'est un fait du registre, pas une case à cacher.
        (index) => scenarios[index]?.title ?? `scénario ${index}`,
      ),
    });
  }
  if (request.new_scenarios.length > 0) {
    lines.push({
      label: "Nouveaux scénarios",
      values: request.new_scenarios.map((scenario) => scenario.title),
    });
  }
  if (request.targets.length > 0) {
    lines.push({ label: "Modèles", values: [...request.targets] });
  }
  const tools = request.new_tools ?? [];
  if (tools.length > 0) {
    lines.push({ label: "Outils", values: tools.map((tool) => tool.name) });
  }
  if (request.temperature) {
    const { min, max } = request.temperature;
    lines.push({
      label: "Température",
      values: [max == null || max === min ? `${min}` : `${min} – ${max}`],
    });
  }
  // La profondeur seulement quand aucune phrase ne l'a déjà dite : une extension
  // peut relever les tours pour ses cases neuves sans approfondir d'existant.
  if (request.turns != null && request.deepen === undefined) {
    lines.push({
      label: "Profondeur",
      values: [`${request.turns} ${plural(request.turns, "tour")}`],
    });
  }

  return { headlines, lines };
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm --prefix web test`
Expected: PASS — les dix tests de `extension-summary.test.mts`, et aucune régression ailleurs.

- [ ] **Step 5: Commit**

```bash
git add web/lib/extension-summary.ts web/lib/extension-summary.test.mts
git commit -m "feat: traduire une entrée du registre des extensions en phrases"
```

---

### Task 2: Les prédicats qui refusent un brouillon déjà servi

**Files:**
- Modify: `web/lib/validate.ts` (ajout en fin de fichier, plus deux types dans l'import de tête ligne 9-16)
- Test: `web/lib/validate.test.mts` (ajouts)

**Interfaces:**
- Consumes: `Draft`, `ExtendDraft` de `./types` (existants).
- Produces:
  - `extensionDraftProblem(draft: Draft, runId: string): string | null` — pour la route HTTP, qui reçoit un identifiant de brouillon et un identifiant de run par deux chemins indépendants et doit vérifier les trois choses.
  - `alreadyAppliedProblem(draft: ExtendDraft): string | null` — pour le MCP, qui a déjà restreint le genre et le run.

`validate.ts` n'importe pas `server-only` (le panneau d'extension y prend déjà `MAX_TURNS`) : ces deux fonctions sont donc utilisables des deux côtés et testables par `node --test`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `web/lib/validate.test.mts` :

```ts
// Un brouillon d'extension lancé est une trace, plus une proposition :
// réappliquer n'est pas idempotent, les répétitions s'empilent.
const EXTEND_DRAFT = (extra: Partial<ExtendDraft> = {}): ExtendDraft =>
  ({
    id: "0a05ab0c-a767-46b1-bf70-3e137d107482",
    kind: "extend",
    extends_run_id: "0060e7c3-2455-4ad4-8c72-5d46261ffb92",
    config: { scenario_indices: [0], new_scenarios: [], targets: [], repetitions: 1 },
    csv_text: null,
    created_by: "sam@polaris.example",
    created_at: "2026-09-06T16:33:00.000Z",
    origin: "mcp",
    deleted_at: null,
    launched_at: null,
    launched_run_id: null,
  }) as unknown as ExtendDraft;

test("un brouillon d'extension en attente peut servir", () => {
  const draft = EXTEND_DRAFT();
  assert.equal(alreadyAppliedProblem(draft), null);
  assert.equal(extensionDraftProblem(draft, draft.extends_run_id), null);
});

test("un brouillon d'extension déjà lancé est refusé, et le refus dit quand", () => {
  const draft = EXTEND_DRAFT({ launched_at: "2026-09-06T16:33:42.873Z" });
  const problem = alreadyAppliedProblem(draft);
  assert.ok(problem);
  assert.ok(problem.includes("already applied"));
  assert.ok(problem.includes("2026-09-06T16:33:42.873Z"));
  // La route HTTP refuse pour la même raison, par le même message.
  assert.equal(extensionDraftProblem(draft, draft.extends_run_id), problem);
});

test("un brouillon de run n'est pas une extension", () => {
  const draft = { id: "abc", kind: "run" } as unknown as Draft;
  const problem = extensionDraftProblem(draft, "0060e7c3");
  assert.ok(problem?.includes("not an extension"));
});

test("un brouillon qui vise un autre run est refusé, quel que soit son état", () => {
  const draft = EXTEND_DRAFT();
  const problem = extensionDraftProblem(draft, "97b8d12c-0a82-4ae5-b226-3509e307629d");
  assert.ok(problem?.includes("extends run 0060e7c3-2455-4ad4-8c72-5d46261ffb92"));
});
```

Et compléter les deux lignes d'import en tête du même fichier :

```ts
import { alreadyAppliedProblem, configProblem, extendProblem, extensionDraftProblem } from "./validate.ts";
import type { Draft, ExtendDraft } from "./types";
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm --prefix web test`
Expected: FAIL — `alreadyAppliedProblem is not a function`.

- [ ] **Step 3: Écrire les prédicats**

Dans `web/lib/validate.ts`, ajouter `Draft` et `ExtendDraft` à l'import de types de tête (lignes 9-16) :

```ts
import type {
  Draft,
  EvalRunConfig,
  ExtendDraft,
  ExtendRequest,
  JudgeSpec,
  RubricLevel,
  SeededTurn,
  ToolSpec,
} from "./types";
```

Puis ajouter à la fin du fichier :

```ts
/** Pourquoi une extension déjà appliquée ne se réapplique pas — ou `null` tant
 *  qu'elle attend.
 *
 * Réappliquer n'est pas idempotent, et c'est ce qui rend ce refus nécessaire
 * plutôt que confortable : `cellsForExtension` numérote les répétitions à partir
 * de la dernière, si bien qu'une seconde application empile des essais au lieu
 * de constater qu'il n'y a rien à faire, et réécrit les `new_scenarios` une
 * seconde fois dans le run. Le filet `added === 0` ne rattrape que l'extension
 * qui n'ajoutait déjà rien.
 *
 * Un brouillon de run lancé, lui, reste relançable : il produit un run de plus,
 * sans toucher au premier. C'est la même règle qui est bonne d'un côté et
 * fausse de l'autre — d'où ce prédicat, qui ne vaut que pour les extensions. */
export function alreadyAppliedProblem(draft: ExtendDraft): string | null {
  if (!draft.launched_at) return null;
  return (
    `This extension was already applied to run ${draft.extends_run_id} on ` +
    `${draft.launched_at}. Applying it again would add to what it already added, not ` +
    "repeat it. See the run's Extensions history for what it did, and compose a new " +
    "extension on the run's page if you mean to go further."
  );
}

/** Ce qui interdit d'appliquer ce brouillon au run `runId` — ou `null` s'il peut
 *  servir.
 *
 * Trois refus, dans l'ordre où ils cessent d'être vrais : ce n'est pas une
 * extension, elle vise un autre run, elle a déjà servi. Pour la route HTTP, qui
 * reçoit le brouillon et le run par deux chemins indépendants — l'adresse et un
 * paramètre — et n'a donc rien qui garantisse d'avance qu'ils vont ensemble. */
export function extensionDraftProblem(draft: Draft, runId: string): string | null {
  if (draft.kind !== "extend") {
    return `Draft ${draft.id} is a run to launch, not an extension of a run.`;
  }
  if (draft.extends_run_id !== runId) {
    return `Draft ${draft.id} extends run ${draft.extends_run_id}, not ${runId}.`;
  }
  return alreadyAppliedProblem(draft);
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm --prefix web test`
Expected: PASS — les quatre tests neufs, et `validate.test.mts` toujours vert par ailleurs.

- [ ] **Step 5: Commit**

```bash
git add web/lib/validate.ts web/lib/validate.test.mts
git commit -m "feat: le refus d'un brouillon d'extension déjà appliqué, en un seul endroit"
```

---

### Task 3: Le refus côté serveur, et le marquage qui cesse d'être avalé

**Files:**
- Modify: `web/app/api/runs/[runId]/extend/route.ts`
- Modify: `web/lib/api.ts:156-160`
- Modify: `web/app/eval/[runId]/page.tsx:1034-1043` (le `onSubmit` d'`ExtendPanel`)
- Modify: `web/app/mcp/route.ts:1015` (branche `draft.kind === "extend"` de `launch_draft`)

**Interfaces:**
- Consumes: `extensionDraftProblem`, `alreadyAppliedProblem` (Task 2) ; `loadDraft`, `DraftNotFound`, `markDraftLaunched` de `@/lib/drafts` (existants).
- Produces: `extendRun(runId: string, body: ExtendRequest, draftId?: string | null)` dans `web/lib/api.ts` — la Task 5 ne s'en sert pas, mais le panneau, oui.

- [ ] **Step 1: Ajouter le garde-fou et le marquage à la route d'extension**

Dans `web/app/api/runs/[runId]/extend/route.ts`, compléter les imports de tête :

```ts
import { DraftNotFound, loadDraft, markDraftLaunched } from "@/lib/drafts";
import { extendProblem, extensionDraftProblem } from "@/lib/validate";
```

(l'import existant `import { extendProblem } from "@/lib/validate";` est remplacé par celui-ci)

Puis, juste après `const body = (await request.json()...)` et avant le `loadRun` :

```ts
  // `?draft=<id>` : cette extension applique un brouillon, et l'appelant le
  // dit. L'écran l'envoie quand le panneau a été ouvert sur une proposition ;
  // une extension composée à la main sur la page n'a pas de brouillon et
  // n'envoie rien. C'est un paramètre d'adresse plutôt qu'un champ du corps
  // pour que celui-ci reste une `ExtendRequest` pure, telle qu'`extendProblem`
  // l'attend et telle qu'elle sera recopiée dans le registre.
  const draftId = new URL(request.url).searchParams.get("draft");
  if (draftId) {
    let draft;
    try {
      draft = await loadDraft(draftId);
    } catch (error) {
      if (error instanceof DraftNotFound) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      throw error;
    }
    // Refusé ici et pas seulement à l'écran : l'adresse `?extend=<id>` se
    // partage, et un signet vieux d'une semaine ne sait pas que l'extension a
    // eu lieu.
    const problem = extensionDraftProblem(draft, runId);
    if (problem) return NextResponse.json({ error: problem }, { status: 409 });
  }
```

Enfin, remplacer la fin de la fonction (après le `recordStart` réussi) par :

```ts
  // Marqué lancé par la route, jamais par l'écran : le geste appartient à la
  // requête qui a réussi l'extension. L'écran le faisait après coup en avalant
  // les erreurs, si bien qu'une extension réussie et un marquage tombé
  // laissaient en silence un brouillon lancé qui se croyait en attente — l'état
  // exact qu'on ferme ici. Awaité sans filet, comme le fait déjà la route de
  // lancement d'un brouillon de run : si ça tombe, l'appelant doit l'apprendre.
  if (draftId) await markDraftLaunched(draftId);

  return NextResponse.json({ ok: true, added });
```

- [ ] **Step 2: Faire passer l'identifiant du brouillon depuis le client**

Dans `web/lib/api.ts`, remplacer `extendRun` (lignes 156-160) :

```ts
/** Ajoute une sous-matrice à un run : des scénarios, des modèles, des essais.
 *
 * `draftId` quand cette extension applique un brouillon : la route s'en sert
 * pour refuser un brouillon déjà appliqué, et pour le marquer lancé elle-même
 * une fois l'extension partie. */
export const extendRun = (
  runId: string,
  body: ExtendRequest,
  draftId?: string | null,
) =>
  request<{ ok: true; added: number }>(
    `/api/runs/${runId}/extend${draftId ? `?draft=${encodeURIComponent(draftId)}` : ""}`,
    { method: "POST", body: JSON.stringify(body) },
  );
```

Dans `web/app/eval/[runId]/page.tsx`, remplacer le corps du `onSubmit` d'`ExtendPanel` (lignes 1034-1043) :

```tsx
          onSubmit={async (request) => {
            // Le brouillon part avec la demande : c'est la route qui refuse un
            // brouillon déjà appliqué et qui le marque lancé, dans la requête
            // même qui étend. Le faire ici après coup, en avalant l'erreur,
            // laissait un brouillon lancé se croire en attente.
            await extendRun(run.id, request, proposalId);
            setExtending(false);
            setProposal(null);
            setProposalId(null);
            await load(transcripts);
          }}
```

Retirer `markDraftLaunched` de l'import de `@/lib/api` en tête du fichier (ligne 14) — il n'a plus d'appelant dans cette page.

- [ ] **Step 3: Fermer la même porte côté MCP**

Dans `web/app/mcp/route.ts`, compléter l'import de `@/lib/validate` pour y prendre `alreadyAppliedProblem`, puis, dans `launch_draft`, à l'entrée de la branche `if (draft.kind === "extend") {` (ligne 1015) et **avant** le `runOrError` qui suit :

```ts
      if (draft.kind === "extend") {
        // Le même refus que la route humaine, pour la même raison : une
        // extension déjà appliquée ne se réapplique pas, les répétitions
        // s'empileraient. Vérifié avant même de charger le run — l'état du
        // brouillon suffit à conclure, et l'agent doit lire ce refus-ci plutôt
        // qu'un refus de propriété ou de budget qui l'enverrait corriger la
        // mauvaise chose.
        const applied = alreadyAppliedProblem(draft);
        if (applied) return toolError(applied);

        const target = await runOrError(draft.extends_run_id, {
```

- [ ] **Step 4: Vérifier les types, le lint et les tests**

```bash
npm --prefix web test && npm --prefix web run lint && npm --prefix web run build
```

Expected: les trois passent. Le build échouerait si `markDraftLaunched` restait importé sans appelant (règle `no-unused-vars` d'ESLint) ou si `extendRun` était appelé avec un troisième argument mal typé.

- [ ] **Step 5: Vérifier le refus à chaud, sans rien dépenser**

Le serveur de développement tourne (`scripts/dev.sh`). Dans la console du navigateur, sur `http://localhost:3000` (session ouverte), envoyer une demande **qui n'ajouterait rien même si le garde-fou manquait** :

```js
await fetch(
  "/api/runs/0060e7c3-2455-4ad4-8c72-5d46261ffb92/extend?draft=0a05ab0c-a767-46b1-bf70-3e137d107482",
  {
    method: "POST",
    body: JSON.stringify({ scenario_indices: [], new_scenarios: [], targets: [], repetitions: 0 }),
  },
).then(async (r) => ({ status: r.status, body: await r.json() }));
```

Expected: `status: 409` et un `error` commençant par `This extension was already applied to run 0060e7c3…`.

Tout autre statut ou message signifie que le garde-fou n'a pas tourné. Le corps vide est délibéré : il ne peut rien ajouter, donc même un garde-fou absent laisserait le run intact — il rendrait simplement un autre refus.

**Le chemin MCP ne se vérifie pas à chaud.** Appeler `launch_draft` sur une extension lancée pour voir s'il refuse, c'est le laisser étendre le run s'il ne refuse pas — l'inverse de ce qu'on veut savoir. La règle elle-même est couverte par les tests de la Task 2 ; le branchement se vérifie en relisant que `alreadyAppliedProblem(draft)` est bien la première chose que fait la branche `draft.kind === "extend"`, et par le build.

**Le marquage qui échoue ne se provoque pas non plus.** Ce qui compte est la forme : `await markDraftLaunched(draftId)` sans `try`/`catch`, contre le `.catch(() => {})` que l'écran faisait. Le vérifier, c'est vérifier qu'aucun filet n'a été remis.

- [ ] **Step 6: Commit**

```bash
git add web/app/api/runs/\[runId\]/extend/route.ts web/lib/api.ts web/app/eval/\[runId\]/page.tsx web/app/mcp/route.ts
git commit -m "fix: une extension déjà appliquée ne se réapplique plus, par aucune porte"
```

---

### Task 4: L'historique des extensions se déplie

**Files:**
- Modify: `web/app/eval/[runId]/page.tsx:88-131` (`ExtensionsHistory`)

**Interfaces:**
- Consumes: `summariseExtension`, `ExtensionSummary` (Task 1) ; `extensionsOf` et `RunExtension` de `@/lib/run-extensions` (existants) ; `stringify` de `yaml`.
- Produces: la section porte désormais `id="extensions"`, ancre dont la Task 5 se sert.

Note de bundle : `yaml` est une dépendance du dépôt mais n'était jusqu'ici importée que par des routes serveur (`config-file.ts`). L'importer dans cette page client l'ajoute au paquet du navigateur. C'est accepté : le brut sous la phrase est ce qui garantit que la phrase n'invente rien, et la page est un écran d'atelier, pas une page publique.

- [ ] **Step 1: Écrire le composant de dépliage**

Dans `web/app/eval/[runId]/page.tsx`, ajouter aux imports de tête :

```tsx
import { Fragment } from "react";
import { stringify } from "yaml";
import { summariseExtension } from "@/lib/extension-summary";
import type { RunExtension } from "@/lib/run-extensions";
```

`Fragment` rejoint l'import existant `import { use, useCallback, useEffect, useState } from "react";` (ligne 3).

Et ajouter `EvalScenario` à l'import de types de la page (lignes 55-61), qui ne le porte pas encore :

```tsx
import type {
  EvalRun,
  EvalScenario,
  ExtendRequest,
  RubricLevel,
  RunDetail,
  Tag,
} from "@/lib/types";
```

Puis, juste au-dessus de `function ExtensionsHistory`, ajouter :

```tsx
/** Ce qu'une extension a fait, sous sa ligne du tableau.
 *
 * La phrase répond à « qu'est-ce qu'elle a fait », et la demande brute est
 * juste en dessous, repliée d'un cran de plus : c'est elle qui garantit que la
 * phrase n'invente rien. En YAML plutôt qu'en JSON parce que les scénarios et
 * les barèmes imbriqués s'y lisent, et par la dépendance `yaml` plutôt que par
 * un sérialiseur maison, qui divergerait le jour où `ExtendRequest` gagnerait
 * un champ. */
function ExtensionDetail({
  extension,
  scenarios,
}: {
  extension: RunExtension;
  scenarios: EvalScenario[];
}) {
  const summary = summariseExtension(extension, scenarios);

  return (
    <div className="space-y-3 bg-zinc-50 px-3 py-3 text-sm">
      {summary.headlines.map((headline) => (
        <p key={headline} className="text-zinc-800">
          {headline}
        </p>
      ))}
      {summary.lines.length > 0 && (
        <dl className="space-y-1">
          {summary.lines.map((line) => (
            <div key={line.label} className="flex gap-2">
              <dt className="w-40 shrink-0 text-xs text-zinc-500">{line.label}</dt>
              <dd className="text-zinc-800">
                {line.values.map((value) => (
                  <div key={value}>{value}</div>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-800">
          La demande, telle qu'elle a été faite
        </summary>
        <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs text-zinc-700">
          {stringify(extension.request)}
        </pre>
      </details>
    </div>
  );
}
```

- [ ] **Step 2: Brancher la chevrette sur le tableau**

Remplacer `ExtensionsHistory` en entier (lignes 88-131) par :

```tsx
function ExtensionsHistory({ run }: { run: EvalRun }) {
  const extensions = extensionsOf(run);
  // Une seule ligne ouverte à la fois : deux détails dépliés côte à côte se
  // lisent mal, et on vient ici comparer une ligne au reste du tableau.
  const [open, setOpen] = useState<number | null>(null);
  if (extensions.length === 0) return null;

  return (
    <section id="extensions" className="space-y-2 rounded border border-zinc-300 p-3">
      <h2 className="text-sm font-medium">
        Extensions ({extensions.length})
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="pb-1 pr-3 font-normal" />
              <th className="pb-1 pr-3 font-normal">When</th>
              <th className="pb-1 pr-3 font-normal">Who</th>
              <th className="pb-1 pr-3 font-normal">Via</th>
              <th className="pb-1 pr-3 text-right font-normal">Quoted</th>
              <th className="pb-1 text-right font-normal">Actual</th>
            </tr>
          </thead>
          <tbody>
            {extensions.map((extension, index) => (
              <Fragment key={index}>
                <tr className="border-t border-zinc-200">
                  <td className="py-1 pr-1">
                    <button
                      type="button"
                      onClick={() => setOpen(open === index ? null : index)}
                      aria-expanded={open === index}
                      aria-label={`What the extension of ${formatDate(extension.at)} did`}
                      className="rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800"
                    >
                      {open === index ? "▾" : "▸"}
                    </button>
                  </td>
                  <td className="py-1 pr-3 whitespace-nowrap text-zinc-700">
                    {formatDate(extension.at)}
                  </td>
                  <td className="py-1 pr-3 text-zinc-700">{extension.by}</td>
                  <td className="py-1 pr-3 text-zinc-500">{extension.via}</td>
                  <td className="py-1 pr-3 text-right text-zinc-700">
                    {extension.estimate ? money(extension.estimate.usd) : "—"}
                  </td>
                  <td className="py-1 text-right font-medium text-zinc-900">
                    {extension.actual_cost_usd === null
                      ? "—"
                      : money(extension.actual_cost_usd)}
                  </td>
                </tr>
                {open === index && (
                  <tr className="border-t border-zinc-200">
                    <td colSpan={6} className="p-0">
                      <ExtensionDetail
                        extension={extension}
                        scenarios={run.config.scenarios}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Vérifier les types, le lint et le build**

```bash
npm --prefix web run lint && npm --prefix web run build
```

Expected: les deux passent. Si `EvalScenario` n'est pas déjà dans l'import de types de la page, l'ajouter.

- [ ] **Step 4: Vérifier à l'écran, en lecture seule**

Ouvrir `http://localhost:3000/eval/0060e7c3-2455-4ad4-8c72-5d46261ffb92` et déplier les quatre lignes.

| ligne | ce qu'on doit lire |
|---|---|
| 06 sept. 18:33 | `1 essai ajouté sur 2 scénarios × 1 modèle — 2 conversations.` puis **Scénarios** `Lot bloqué avant expédition` / `Balance d'un dossier cloisonné`, **Modèles** `anthropic/claude-haiku-4-5` |
| 06 sept. 18:36 | `… poussés à 4 tours.` — jamais « de 3 à 4 » |
| 06 sept. 19:24 | `… poussés à 7 tours.` |
| 06 sept. 19:27 | `1 juge ajouté …` et **Juges** avec son critère |

Déplier « La demande, telle qu'elle a été faite » sur la première : le YAML doit porter `scenario_indices`, `targets`, `repetitions`, `new_scenarios`. Ouvrir une seconde ligne doit refermer la première.

- [ ] **Step 5: Commit**

```bash
git add web/app/eval/\[runId\]/page.tsx
git commit -m "feat: chaque extension dit ce qu'elle a fait, et montre la demande d'origine"
```

---

### Task 5: « Lancé » devient terminal pour une extension

**Files:**
- Modify: `web/lib/draft-row.ts:93-101` (`draftDestination`)
- Test: `web/lib/draft-row.test.mts` (ajout)
- Modify: `web/components/DraftTable.tsx:303-314` (l'infobulle de la fusée)
- Modify: `web/app/eval/[runId]/page.tsx:363` (un état), `:457-481` (l'effet `?extend=`), `:1021` (le bandeau)

**Interfaces:**
- Consumes: l'ancre `id="extensions"` posée en Task 4 ; `DraftRead.launched_at`, déjà rendu par `GET /api/runs/drafts/[draftId]`.
- Produces: rien que d'autres tâches consomment.

`draftDestination` est déjà pur et déjà testé (`draft-row.test.mts`) : la règle s'y ajoute et se teste là, plutôt que dans le JSX.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `web/lib/draft-row.test.mts` :

```ts
test("une extension déjà appliquée mène à l'historique du run, pas à son panneau", () => {
  // Réappliquer n'est pas idempotent : les répétitions s'empilent. Une
  // extension lancée est donc une trace, plus une proposition à rouvrir — et
  // `launched_run_id` n'est jamais écrit, si bien que `launched_at` est le
  // seul témoin qu'elle a servi.
  assert.equal(
    draftDestination(extendDraft({ launched_at: "2026-09-06T16:33:42.873Z" })),
    "/eval/r1#extensions",
  );
});

test("une extension en attente mène toujours à son panneau", () => {
  assert.equal(draftDestination(extendDraft()), "/eval/r1?extend=d1");
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm --prefix web test`
Expected: FAIL sur le premier des deux — reçu `/eval/r1?extend=d1`, attendu `/eval/r1#extensions`. Le second passe déjà : il garde le cas qui ne doit pas bouger.

- [ ] **Step 3: Ajouter le cas à `draftDestination`**

Dans `web/lib/draft-row.ts`, remplacer `draftDestination` (lignes 93-101) :

```ts
export function draftDestination(draft: Draft): string {
  if (draft.launched_run_id) return `/eval/${draft.launched_run_id}`;
  if (draft.kind === "extend") {
    // Une extension appliquée n'a plus de proposition à rouvrir : elle a écrit
    // sur son run, et réappliquer n'est pas idempotent — `cellsForExtension`
    // numérote les répétitions à partir de la dernière, si bien qu'une seconde
    // application empile des essais au lieu de constater qu'il n'y a rien à
    // faire. Elle mène donc à ce qu'elle a fait, pas à ce qu'elle proposait.
    //
    // Un brouillon de run lancé, lui, garde sa destination : le relancer
    // produit un run de plus sans toucher au premier. C'est la même règle qui
    // est bonne d'un côté et fausse de l'autre.
    return draft.launched_at
      ? `/eval/${draft.extends_run_id}#extensions`
      : `/eval/${draft.extends_run_id}?extend=${draft.id}`;
  }
  return `/?draft=${draft.id}`;
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm --prefix web test`
Expected: PASS. Le test existant « un brouillon déjà lancé mène au run qu'il a produit » doit rester vert : il pose `launched_run_id: "r9"`, que la première ligne intercepte avant la branche neuve.

- [ ] **Step 5: Dire à quoi mène la fusée**

Dans `web/components/DraftTable.tsx`, remplacer le `title` et l'`aria-label` du `<Link>` de la fusée (lignes 303-314) :

```tsx
                      title={
                        launched
                          ? draft.kind === "extend"
                            ? "Voir ce que cette extension a fait"
                            : "Voir le run produit"
                          : draft.kind === "extend"
                            ? "Ouvrir le run pour appliquer cette extension"
                            : "Ouvrir le formulaire pour le relire et le lancer"
                      }
                      aria-label={
                        launched
                          ? draft.kind === "extend"
                            ? "See what this extension did"
                            : "Show the produced run"
                          : "Open to launch"
                      }
```

- [ ] **Step 6: Le panneau ne s'ouvre plus sur une extension appliquée**

Dans `web/app/eval/[runId]/page.tsx`, ajouter un état sous celui de `proposalId` (ligne 363) :

```tsx
  // Quand `?extend=` désigne une extension déjà appliquée : sa date, pour le
  // dire, plutôt qu'un panneau qui laisserait croire qu'elle attend encore.
  const [appliedAt, setAppliedAt] = useState<string | null>(null);
```

Puis remplacer l'effet `?extend=` en entier (lignes 457-481) :

```tsx
  // `?extend=<id>` : on vient de la liste des brouillons avec une proposition à
  // relire. Le panneau s'ouvre dessus plutôt que vide — sauf si elle a déjà
  // servi, auquel cas il n'y a plus de proposition, seulement une trace.
  useEffect(() => {
    const draftId = searchParams.get("extend");
    if (!draftId) return;
    let cancelled = false;
    getDraft(draftId)
      .then((draft) => {
        if (cancelled) return;
        if (draft.kind !== "extend") {
          setError("That draft is a run to launch, not an extension.");
          return;
        }
        // Une adresse se partage et se met en signet : rien ne garantit que
        // celle-ci soit arrivée par la liste, où le lien a déjà disparu.
        if (draft.launched_at) {
          setAppliedAt(draft.launched_at);
          return;
        }
        setProposal(draft.config);
        setProposalId(draftId);
        setProposalMine(draft.mine);
        setExtending(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(`Could not open that draft: ${e.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [searchParams]);
```

- [ ] **Step 7: Poser le bandeau**

Dans le rendu de la page, juste avant `{extending && !running && (` (ligne 1021) :

```tsx
      {appliedAt && (
        <div className="rounded border border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-700">
          Cette extension a été appliquée le {formatDate(appliedAt)}.{" "}
          <a href="#extensions" className="underline">
            Voir ce qu'elle a fait
          </a>
          .
        </div>
      )}
```

Le bandeau donne la date sans prétendre savoir quelle ligne de l'historique lui correspond : le tableau a une colonne `When`, et le registre ne porte aucun lien vers le brouillon dont chaque extension est venue.

- [ ] **Step 8: Vérifier les tests, le lint et le build**

```bash
npm --prefix web test && npm --prefix web run lint && npm --prefix web run build
```

Expected: les trois passent.

- [ ] **Step 9: Vérifier les deux chemins à l'écran**

| ce qu'on fait | ce qu'on doit voir |
|---|---|
| `/runs`, montrer les brouillons puis les lancés | la fusée de `0a05ab0c…` (extension, lancée) pointe sur `/eval/0060e7c3…#extensions`, infobulle « Voir ce que cette extension a fait » |
| la même liste | `eb87a317…` (extension, en attente) garde son `?extend=` et son infobulle d'origine |
| la même liste | un brouillon de run lancé garde sa destination |
| ouvrir `/eval/0060e7c3-2455-4ad4-8c72-5d46261ffb92?extend=0a05ab0c-a767-46b1-bf70-3e137d107482` | **aucun panneau d'extension**, le bandeau avec la date du 6 sept., et son lien qui mène au tableau des extensions |
| ouvrir `/eval/9c9c6981-71a2-4e66-94f7-bfca5a205236?extend=eb87a317-d8b0-4994-8e66-8861ad04119b` | le panneau s'ouvre normalement, garni — une extension en attente n'a rien perdu |

- [ ] **Step 10: Commit**

Commiter les quatre fichiers touchés (`web/lib/draft-row.ts`, `web/lib/draft-row.test.mts`, `web/components/DraftTable.tsx`, `web/app/eval/[runId]/page.tsx`) sous le message :

`fix: une extension lancée est une trace, plus une proposition à rouvrir`

---


## Ce que ce plan ne fait pas

Repris du spec, pour que l'implémenteur ne les prenne pas pour des oublis :

- **Aucun `deleted_at` posé sur les brouillons existants.** Le dépôt distingue *jeté* de *lancé* ; marquer supprimé ce qui a servi confondrait les deux, et « Show launched » doit continuer de montrer la trace.
- **Rien n'empêche de refaire la même extension** en composant à la main sur la page du run. C'est un geste délibéré qui laisse sa propre ligne dans l'historique ; ce plan ne ferme que le geste accidentel.
- ~~**`RunExtensionLogEntry.via` reste typé `"ui" | "mcp"`**~~ — faux, et retiré. Le type déclare `"ui" | "mcp" | "script"` depuis avant cette branche (`types.ts`, à la base `4eb76c5`), avec le commentaire qui explique pourquoi la valeur est déclarée plutôt qu'interdite. Il n'y avait rien à différer.
- **Aucun `draft_id` ajouté aux entrées du registre.** Il ne servirait qu'au lien du bandeau, ne vaudrait que pour l'avenir, et demanderait une PR dans `polaris-supabase` pour le commentaire de colonne.
- **`Draft.launched_run_id` n'est écrit nulle part.** La colonne existe dans le type, et `draftDestination` teste sa première branche dessus, mais aucun code du dépôt ne la remplit — `markDraftLaunched` n'écrit que `launched_at`, et son commentaire dit pourquoi (une case unique ne peut pas tenir plusieurs runs). Cette branche est donc morte aujourd'hui, ce qui est précisément pourquoi la Task 5 accroche sa règle à `launched_at` et non à elle. Constaté en passant, pas traité : le corriger est un autre sujet que celui-ci.

# Approfondir un run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une extension peut demander plus de tours ; les cases visées continuent leur propre conversation au lieu d'être rejouées, et sont rejugées.

**Architecture:** Une colonne `turns_done` sur `eval_samples` porte la profondeur atteinte par chaque case — c'est elle qui dit au moteur quoi continuer, rend une panne récupérable, et permet d'approfondir seulement certaines cases. Le moteur gagne un mode de reprise distinct de l'historique posé. Le devis apprend à ne facturer qu'à partir du tour où l'on reprend.

**Tech Stack:** Next.js 16 + TypeScript côté application, Python + `inspect_ai` côté moteur, Supabase par PostgREST. Tests : `node --test` sur `web/lib/**/*.test.mts`, `pytest` sur `tests/`.

Le dessin qui commande ce plan : `docs/superpowers/specs/2026-09-05-approfondir-un-run-design.md`.

## Global Constraints

- **Les migrations vivent dans `polaris-supabase`**, jamais dans ce dépôt.
- **On ne raccourcit jamais** : une extension demande autant de tours ou davantage, jamais moins. La règle vit dans `extendProblem`, donc l'interface et le MCP la subissent également.
- **Approfondir, c'est rejuger** : note et justification d'une case approfondie sont effacées *avant* la reprise, pas après. Une panne laisse alors une case sans note plutôt qu'une case portant un verdict qui ne correspond plus.
- **La profondeur du run est celle qu'on a demandée, pour toutes les cases.** `turns_done` renseigne sur le tour où une case s'est réglée ; il n'avertit pas d'une comparabilité perdue, et la moyenne compte toutes les cases.
- **Langue** : ce que lit un utilisateur ou une machine est en anglais ; commentaires, noms de tests et messages de commit en français.
- **`node --test` ne voit que `web/lib/**/*.test.mts`** et ne résout ni `@/…` ni `@shared/…` : un module testable n'importe que des chemins relatifs avec l'extension `.ts`.
- Vérification : `cd web && npx tsc --noEmit && npx eslint . && npm test`, et `python3 -m pytest tests/ -q` à la racine.
- Un commit par tâche, en français, avec les deux lignes d'attribution en pied.

---

### Task 1: La colonne `turns_done`

**Files:**
- Create: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/migrations/<horodatage>_sample_turns_done.sql`
- Modify: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/schema.sql` (régénéré par la CLI)
- Modify: `web/lib/types.ts` — interface `EvalSample`, après `temperature`

**Interfaces:**
- Produces: la colonne `eval_samples.turns_done integer`, et le champ `EvalSample.turns_done: number | null`.

- [ ] **Step 1: Créer la migration**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals
supabase migration new sample_turns_done
```

- [ ] **Step 2: Écrire le SQL**

```sql
-- evals-playground : jusqu'où chaque case est allée.
--
-- La profondeur vivait sur le run et nulle part ailleurs : une case ne savait
-- pas à combien de tours elle avait tourné. Tant qu'un run n'avait qu'une
-- profondeur, ça suffisait. Dès qu'on peut l'approfondir, il faut le savoir
-- par case — pour reprendre celles qui restent après une panne, et pour
-- n'approfondir que celles qu'on veut.
--
-- `null` sur une case jamais jouée. Les cases déjà notées reçoivent la
-- profondeur de leur run, qui est celle à laquelle elles ont effectivement
-- tourné.
alter table public.eval_samples
  add column turns_done integer;

update public.eval_samples s
   set turns_done = (r.config ->> 'turns')::int
  from public.eval_runs r
 where r.id = s.run_id
   and s.status in ('done', 'error')
   and s.turns_done is null;

comment on column public.eval_samples.turns_done is
  'Combien de tours cette case a reellement joues. Null tant qu''elle n''a pas tourne. Une case en pending qui porte des messages et un turns_done inferieur a config.turns se continue au lieu de se rejouer.';
```

- [ ] **Step 3: Voir ce qui serait appliqué**

```bash
supabase db push --dry-run
```

Attendu : la migration apparaît seule. Si d'autres apparaissent, s'arrêter et demander.

- [ ] **Step 4: Appliquer et rafraîchir l'instantané**

```bash
supabase db push
supabase db dump --linked -f supabase/schema.sql
```

- [ ] **Step 5: Vérifier le remplissage**

```bash
set -a && source .env && set +a
curl -sS "$SUPABASE_URL/rest/v1/eval_samples?select=status,turns_done&limit=5" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Attendu : les cases `done` portent un entier, jamais `null`.

- [ ] **Step 6: Commiter la migration**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase
git add evals/supabase/migrations evals/supabase/schema.sql
git commit -m "Chaque case dit jusqu'ou elle est allee

<corps expliquant le pourquoi>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0139V9pMW2BjSVSTa8Zgyh5B"
git push origin main
```

- [ ] **Step 7: Déclarer le champ côté TypeScript**

Dans `web/lib/types.ts`, interface `EvalSample`, juste après `temperature: number | null;` :

```ts
  /** Combien de tours cette case a réellement joués.
   *
   * `null` tant qu'elle n'a pas tourné. Une case plus courte que la profondeur
   * du run n'est pas incomplète : elle s'est réglée là, et l'y pousser plus
   * loin n'aurait rien appris. */
  turns_done: number | null;
```

- [ ] **Step 8: Vérifier et commiter**

```bash
cd web && npx tsc --noEmit && npm test
cd .. && git add web/lib/types.ts
git commit -m "feat: le champ turns_done sur EvalSample"
```

---

### Task 2: Les règles d'un approfondissement

**Files:**
- Modify: `web/lib/types.ts` — interface `ExtendRequest`
- Modify: `web/lib/validate.ts` — `extendProblem`
- Modify: `web/lib/extend.test.mts`

**Interfaces:**
- Consumes: `EvalSample.turns_done` (Task 1).
- Produces: `ExtendRequest.turns?: number`, `ExtendRequest.deepen?: { scenario_index: number; target_model: string }[]`, et les refus correspondants dans `extendProblem(request, scenarioCount, runTools, currentTurns, adversary)`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `web/lib/extend.test.mts` :

```ts
test("on ne raccourcit jamais un run", () => {
  // Une conversation déjà jouée ne se coupe pas, et un run dont la profondeur
  // diminuerait ne voudrait plus rien dire.
  const problem = extendProblem(DEMANDE({ turns: 2 }), 1, [], 4, "adv");
  assert.match(problem ?? "", /cannot go below the 4 turns/);
});

test("demander la même profondeur est permis, c'est le cas courant", () => {
  assert.equal(extendProblem(DEMANDE({ turns: 4 }), 1, [], 4, "adv"), null);
});

test("passer au-delà d'un tour exige un adversaire", () => {
  // Le moteur refuse de dérouler plus d'un tour sans quelqu'un pour pousser.
  // Le dire ici plutôt qu'au premier appel facturé.
  const problem = extendProblem(DEMANDE({ turns: 4 }), 1, [], 1, null);
  assert.match(problem ?? "", /adversary model is required/);
});

test("approfondir désigne des cases, pas un rectangle", () => {
  const problem = extendProblem(
    DEMANDE({
      turns: 8,
      deepen: [{ scenario_index: 0, target_model: "anthropic/claude-haiku-4-5" }],
    }),
    1,
    [],
    4,
    "adv",
  );
  assert.equal(problem, null);
});

test("approfondir une case qui n'existe pas est refusé", () => {
  const problem = extendProblem(
    DEMANDE({ turns: 8, deepen: [{ scenario_index: 9, target_model: "m" }] }),
    1,
    [],
    4,
    "adv",
  );
  assert.match(problem ?? "", /scenario 9 is not part of this run/);
});

test("approfondir sans demander plus de tours ne veut rien dire", () => {
  // Sans profondeur nouvelle, il n'y a rien à continuer : la demande serait
  // silencieusement sans effet, ce qui est pire qu'un refus.
  const problem = extendProblem(
    DEMANDE({ deepen: [{ scenario_index: 0, target_model: "m" }] }),
    1,
    [],
    4,
    "adv",
  );
  assert.match(problem ?? "", /turns to deepen/);
});
```

- [ ] **Step 2: Voir les tests échouer**

```bash
cd web && node --test lib/extend.test.mts
```

Attendu : six échecs — `extendProblem` ignore encore les deux nouveaux arguments.

- [ ] **Step 3: Étendre le type**

Dans `web/lib/types.ts`, interface `ExtendRequest`, après `new_tools_for_existing?: boolean;` :

```ts
  /** La profondeur voulue pour le run. Jamais inférieure à l'actuelle : une
   *  conversation déjà jouée ne se coupe pas. Absent laisse la profondeur
   *  telle quelle. */
  turns?: number;
  /** Les cases à continuer jusqu'à `turns`, désignées une à une.
   *
   * Un ensemble quelconque et non un rectangle : on approfondit ce qui a tenu
   * et on laisse ce qui a déjà cédé, or ces cases-là ne dessinent pas une
   * ligne ni une colonne. */
  deepen?: { scenario_index: number; target_model: string }[];
```

- [ ] **Step 4: Écrire les règles**

Dans `web/lib/validate.ts`, remplacer la signature et ajouter les contrôles après ceux des outils :

```ts
export function extendProblem(
  request: unknown,
  scenarioCount: number,
  runTools: ToolSpec[] = [],
  currentTurns = 1,
  adversary: string | null = null,
): string | null {
```

puis, juste avant le contrôle `indices.length === 0 && nouveaux.length === 0` :

```ts
  const profondeur = r.turns ?? currentTurns;
  if (!Number.isInteger(profondeur) || profondeur < MIN_TURNS || profondeur > MAX_TURNS) {
    return `turns must be between ${MIN_TURNS} and ${MAX_TURNS}`;
  }
  if (profondeur < currentTurns) {
    // Une conversation déjà jouée ne se coupe pas.
    return `turns cannot go below the ${currentTurns} turns already played`;
  }
  if (profondeur > 1 && !isFilled(adversary)) {
    // Le moteur refuse de dérouler plus d'un tour sans quelqu'un pour pousser.
    return "an adversary model is required once turns exceeds 1";
  }

  const àContinuer = r.deepen ?? [];
  if (!Array.isArray(àContinuer)) return "deepen must be a list of cells";
  for (const cell of àContinuer) {
    if (
      !Number.isInteger(cell?.scenario_index) ||
      cell.scenario_index < 0 ||
      cell.scenario_index >= scenarioCount
    ) {
      return `scenario ${cell?.scenario_index} is not part of this run`;
    }
    if (!isFilled(cell?.target_model)) {
      return "a cell to deepen has no model";
    }
  }
  if (àContinuer.length > 0 && (r.turns ?? currentTurns) <= currentTurns) {
    // Sans profondeur nouvelle il n'y a rien à continuer : la demande serait
    // silencieusement sans effet, ce qui est pire qu'un refus.
    return "deepening needs more turns to deepen to";
  }
```

- [ ] **Step 5: Adapter l'appelant de la route**

Dans `web/app/api/runs/[runId]/extend/route.ts` :

```ts
  const problem = extendProblem(
    body,
    detail.run.config.scenarios.length,
    detail.run.config.tools ?? [],
    detail.run.config.turns,
    detail.run.config.models.adversary ?? null,
  );
```

- [ ] **Step 6: Voir les tests passer**

```bash
cd web && node --test lib/extend.test.mts && npx tsc --noEmit
```

Attendu : `pass 12 / fail 0`, `tsc` sans sortie.

- [ ] **Step 7: Commiter**

```bash
git add web/lib/types.ts web/lib/validate.ts web/lib/extend.test.mts web/app/api/runs/'[runId]'/extend/route.ts
git commit -m "feat: les règles d'un approfondissement, dont on ne raccourcit jamais"
```

---

### Task 3: Le devis d'une continuation

**Files:**
- Modify: `web/lib/pricing.ts` — `estimateTokens` et `estimateCost`
- Create: `web/lib/deepening.test.mts`

**Interfaces:**
- Consumes: `ExtendRequest.turns`, `ExtendRequest.deepen` (Task 2).
- Produces: `estimateDeepening(config: EvalRunConfig, from: number, to: number, cells: number): CostEstimate`.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `web/lib/deepening.test.mts` :

```ts
// Approfondir est ce que ce produit sait faire de plus cher : un prix faux
// ici serait pire que pas de prix du tout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost, estimateDeepening } from "./pricing.ts";
import type { EvalRunConfig } from "./types";

const CONFIG = {
  scenarios: [
    { title: "T", system_prompt: "Tu assistes.", opening_message: "Fais-le." },
  ],
  criterion: "Ce qu'il a fait.",
  rubric: [
    { value: 0, meaning: "A tenu." },
    { value: 1, meaning: "A cédé." },
  ],
  turns: 4,
  repetitions: 1,
  models: {
    targets: ["anthropic/claude-haiku-4-5"],
    adversary: "anthropic/claude-haiku-4-5",
    judge: "anthropic/claude-haiku-4-5",
  },
  adversary_prompt: "Insiste.",
} as EvalRunConfig;

test("continuer coûte moins cher que rejouer depuis le début", () => {
  // C'est tout l'intérêt : les tours déjà joués ne sont pas repayés.
  const àNeuf = estimateCost({ ...CONFIG, turns: 8 }, null);
  const continué = estimateDeepening(CONFIG, 4, 8, 1);
  assert.ok(
    continué.usd < àNeuf.usd,
    `continuer (${continué.usd}) devrait coûter moins que rejouer (${àNeuf.usd})`,
  );
});

test("continuer coûte plus cher que les mêmes tours joués à froid", () => {
  // Chaque tour renvoie tout l'historique : reprendre à quatre tours traîne
  // déjà quatre tours de conversation, là où un run neuf de quatre tours
  // part de rien. Un devis qui l'ignorerait sous-estimerait la seule
  // fonctionnalité chère du produit.
  const àFroid = estimateCost({ ...CONFIG, turns: 4 }, null);
  const continué = estimateDeepening(CONFIG, 4, 8, 1);
  assert.ok(
    continué.usd > àFroid.usd,
    `continuer (${continué.usd}) devrait coûter plus que quatre tours à froid (${àFroid.usd})`,
  );
});

test("le juge est payé pour la conversation entière, pas pour les tours ajoutés", () => {
  // Il relit tout : son coût ne dépend pas de l'endroit où l'on a repris.
  // Approfondir jusqu'à huit tours et jouer huit tours à neuf lui donnent la
  // même conversation à lire, donc la même facture — c'est ce qui distingue
  // son coût de celui des modèles, qui, lui, s'allège d'une reprise.
  const àNeuf = estimateCost({ ...CONFIG, turns: 8 }, null);
  const continué = estimateDeepening(CONFIG, 4, 8, 1);
  const juge = (e: typeof àNeuf) =>
    e.per_model.filter((m) => m.model === CONFIG.models.judge);

  // Le juge apparaît une fois par conversation dans les deux devis.
  assert.equal(juge(continué).length, juge(àNeuf).length);
  assert.equal(
    juge(continué)[0].input_tokens,
    juge(àNeuf)[0].input_tokens,
    "le juge relit la même conversation dans les deux cas",
  );
});

test("le devis suit le nombre de cases", () => {
  const une = estimateDeepening(CONFIG, 4, 8, 1);
  const dix = estimateDeepening(CONFIG, 4, 8, 10);
  assert.ok(Math.abs(dix.usd - une.usd * 10) < une.usd * 0.001);
  assert.equal(dix.conversations, 10);
});

test("approfondir de zéro tour ne coûte rien", () => {
  const rien = estimateDeepening(CONFIG, 4, 4, 5);
  assert.equal(rien.usd, 0);
  assert.equal(rien.model_calls, 0);
});
```

- [ ] **Step 2: Voir les tests échouer**

```bash
cd web && node --test lib/deepening.test.mts
```

Attendu : `estimateDeepening` n'existe pas — erreur d'import.

- [ ] **Step 3: Écrire la fonction**

Dans `web/lib/pricing.ts`, après `estimateCost` :

```ts
/** Ce que coûte de pousser des cases de `from` tours à `to`.
 *
 * La même boucle que `estimateCost`, déroulée à l'identique — c'est la seule
 * façon d'obtenir le bon historique accumulé — mais qui ne facture qu'à partir
 * du tour où l'on reprend. L'historique des tours déjà joués reste compté dans
 * l'entrée des tours suivants : c'est lui qui fait grimper le prix, chaque tour
 * renvoyant tout ce qui précède.
 *
 * Le juge relit la conversation entière, pas les tours ajoutés : son coût est
 * celui d'un jugement complet, quel que soit l'endroit de la reprise. */
export function estimateDeepening(
  config: EvalRunConfig,
  from: number,
  to: number,
  cells: number,
): CostEstimate {
  if (to <= from || cells <= 0) {
    return estimateCost({ ...config, scenarios: [], repetitions: 0 }, null);
  }
  // Une case, poussée de `from` à `to`, répétée `cells` fois : la
  // configuration décrit une seule conversation et le poids porte le nombre.
  return estimateCost(
    { ...config, turns: to, repetitions: cells, scenarios: config.scenarios.slice(0, 1) },
    null,
    from,
  );
}
```

et donner à `estimateCost` puis à `estimateTokens` un troisième paramètre `billFrom = 0`, en ne facturant qu'à partir de ce tour dans la boucle :

```ts
      for (let turn = 0; turn < config.turns; turn += 1) {
        const facturé = turn >= billFrom;
        if (facturé) {
          targetInput += system + toolTokens + history;
          targetOutput += targetResponse;
        }
        history += targetResponse;

        if (turn < config.turns - 1) {
          if (facturé) {
            adversaryInput += adversaryPrompt + history + ADVERSARY_OVERHEAD_TOKENS;
            adversaryOutput += adversaryResponse;
          }
          history += adversaryResponse;
        }
      }
```

et corriger le compte d'appels :

```ts
  const facturés = Math.max(config.turns - billFrom, 0);
  const callsPerConversation =
    facturés + Math.max(facturés - 1, 0) + (facturés > 0 ? 1 : 0);
```

- [ ] **Step 4: Voir les tests passer**

```bash
cd web && node --test lib/deepening.test.mts && npm test
```

Attendu : `pass 5 / fail 0` sur le nouveau fichier, et la suite entière verte — `estimateCost` sans troisième argument doit se comporter exactement comme avant.

- [ ] **Step 5: Commiter**

```bash
git add web/lib/pricing.ts web/lib/deepening.test.mts
git commit -m "feat: chiffrer une continuation sans refacturer les tours déjà joués"
```

---

### Task 4: Préparer les cases à continuer

**Files:**
- Modify: `web/lib/runs.ts` — `extendRun`

**Interfaces:**
- Consumes: `ExtendRequest.turns`, `ExtendRequest.deepen` (Task 2), `EvalSample.turns_done` (Task 1).
- Produces: `extendRun` écrit `config.turns` et remet les cases désignées en `pending` en gardant leurs `messages`.

- [ ] **Step 1: Écrire la préparation**

Dans `web/lib/runs.ts`, dans `extendRun`, juste avant l'insertion des nouvelles cases :

```ts
  // Les cases à continuer repartent en attente en gardant leur conversation :
  // c'est ce couple — `pending` avec des `messages` — qui dit au moteur de
  // continuer plutôt que de rejouer.
  //
  // Leur note part maintenant, pas après. Elle portait sur une conversation
  // plus courte et ne dit rien de celle qui vient ; une panne en cours de
  // route doit laisser une case sans note plutôt qu'une case portant un
  // verdict qui ne correspond plus.
  for (const cell of request.deepen ?? []) {
    await update(
      SAMPLES,
      {
        status: "pending",
        score: null,
        justification: "",
        error: null,
        finished_at: null,
      },
      {
        run_id: `eq.${runId}`,
        scenario_index: `eq.${cell.scenario_index}`,
        target_model: `eq.${cell.target_model}`,
        status: "eq.done",
      },
    );
  }
```

et faire porter la nouvelle profondeur à la configuration écrite :

```ts
      config: {
        ...config,
        tools: outils,
        turns: request.turns ?? config.turns,
        scenarios,
        models: { ...config.models, targets },
        temperature,
      },
```

- [ ] **Step 2: Compter les cases préparées dans le retour**

`extendRun` rend aujourd'hui le nombre de cases ajoutées. Une extension qui n'approfondit que des cases existantes n'en ajoute aucune et rendrait `0`, ce que la route lit comme « rien à faire ». Remplacer le retour par la somme :

```ts
  const continuées = (request.deepen ?? []).length;
  if (cases.length === 0 && continuées === 0) return 0;
```

et à la fin, `return cases.length + continuées;`.

- [ ] **Step 3: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

- [ ] **Step 4: Commiter**

```bash
git add web/lib/runs.ts
git commit -m "feat: une case à continuer repart en attente avec sa conversation"
```

---

### Task 5: Le moteur continue au lieu de rejouer

**Files:**
- Modify: `backend/playground/conversation.py` — `run_conversation`
- Modify: `backend/playground/eval_task.py` — `pending_dataset` et `conversation_solver`
- Modify: `tests/test_conversation.py`

**Interfaces:**
- Consumes: la colonne `turns_done` et les cases préparées (Tasks 1 et 4).
- Produces: `run_conversation(..., resume: Sequence[Turn] | None = None)`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `tests/test_conversation.py` :

```python
@pytest.mark.asyncio
async def test_reprendre_une_conversation_ne_remarque_pas_les_tours_joues():
    """Les tours repris ont été produits par le modèle, pas donnés.

    `history` les marquerait `seeded`, et le juge saute les tours seedés : les
    quatre premiers tours d'une conversation approfondie disparaîtraient de
    son champ de vision. C'est la raison d'être d'un paramètre distinct.
    """
    joués = [
        Turn(role="user", content="Fais-le."),
        Turn(role="assistant", content="Non."),
    ]
    transcript = await run_conversation(
        system_prompt="Tu assistes.",
        opening_message="Fais-le.",
        turns=1,
        target=_modele(["Toujours non."]),
        adversary=_modele(["Insiste."]),
        adversary_prompt="Pousse.",
        resume=joués,
    )

    assert [t.seeded for t in transcript[:2]] == [False, False]
    # Le message d'ouverture n'est pas réinséré : il est déjà dans la reprise.
    assert [t.content for t in transcript[:3]] == [
        "Fais-le.",
        "Non.",
        "Toujours non.",
    ]
```

- [ ] **Step 2: Voir le test échouer**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/evals-playground
python3 -m pytest tests/test_conversation.py -k reprendre -q
```

Attendu : `TypeError: run_conversation() got an unexpected keyword argument 'resume'`.

- [ ] **Step 3: Ajouter le mode de reprise**

Dans `backend/playground/conversation.py`, ajouter le paramètre à la signature, après `history` :

```python
    resume: "Sequence[Turn] | None" = None,
```

et remplacer la construction du transcript initial :

```python
    if resume is not None:
        # Une conversation qu'on prolonge. Ses tours ont été produits, pas
        # donnés : les marquer `seeded` les ferait sauter par le juge, qui ne
        # noterait plus que les tours ajoutés. Et le message d'ouverture y est
        # déjà — le réinsérer le placerait au milieu de la conversation.
        transcript: list[Turn] = list(resume)
    else:
        # L'historique posé ouvre le transcript. Le modèle le reçoit comme s'il
        # l'avait vécu — c'est le but — mais chaque tour reste marqué, et le
        # juge sait ne pas le noter.
        transcript = [
            Turn(role=turn.role, content=turn.content, seeded=True)
            for turn in (history or [])
        ]
        transcript.append(Turn(role="user", content=opening_message))
```

Documenter le paramètre dans la docstring, sous `history` :

```
        resume: Une conversation déjà jouée, à prolonger. Contrairement à
            `history`, ses tours ne sont pas marqués comme posés — ils ont été
            produits — et le message d'ouverture n'est pas réinséré, puisqu'il
            s'y trouve déjà. `turns` compte alors les tours à *ajouter*.
```

- [ ] **Step 4: Voir le test passer**

```bash
python3 -m pytest tests/test_conversation.py -k reprendre -q
```

- [ ] **Step 5: Porter la conversation jusqu'au solver**

Dans `backend/playground/eval_task.py`, `pending_dataset` : ajouter aux métadonnées de chaque case ce qu'elle a déjà joué.

```python
                    "turns_done": row.get("turns_done") or 0,
                    "played": row.get("messages") or [],
```

et dans `conversation_solver`, avant l'appel :

```python
        # Une case qui porte déjà une conversation se continue : on ne lui
        # redemande que les tours manquants, et son transcript repart d'où il
        # s'était arrêté. Sans messages, elle se joue à neuf.
        joués = state.metadata.get("played") or []
        faits = int(state.metadata.get("turns_done") or 0)
        reste = config.turns - faits if joués else config.turns
```

puis passer `turns=reste` et, quand `joués` n'est pas vide :

```python
            resume=[
                Turn(role=turn["role"], content=turn["content"], seeded=turn.get("seeded", False))
                for turn in joués
            ],
```

- [ ] **Step 6: Écrire `turns_done` à la fin de chaque case**

`backend/playground/supabase_store.py`, fonction `write_sample` (ligne 288) : c'est elle qui pose `score` et `justification` sur la ligne, vers la ligne 313. Lui ajouter un paramètre `turns_done: int` et le faire figurer dans le corps écrit, à côté de `score` :

```python
            "score": score,
            "justification": justification,
            "turns_done": turns_done,
```

L'appelant le connaît : c'est le nombre de tours que la conversation porte une fois finie, donc `config.turns` — la case vient d'y être poussée. Chercher les appels avec :

```bash
grep -rn "write_sample(" backend/ tests/
```

et passer la valeur à chacun.

- [ ] **Step 7: Vérifier**

```bash
python3 -m pytest tests/ -q
```

Attendu : toute la suite verte.

- [ ] **Step 8: Commiter**

```bash
git add backend/ tests/
git commit -m "feat: le moteur prolonge une conversation au lieu de la rejouer"
```

---

### Task 6: Demander plus de tours depuis le panneau

**Files:**
- Modify: `web/components/ExtendPanel.tsx`

**Interfaces:**
- Consumes: `ExtendRequest.turns` et `.deepen` (Task 2), `estimateDeepening` (Task 3).
- Produces: rien qu'une autre tâche consomme.

- [ ] **Step 1: Ajouter le champ et la contrainte**

Dans `web/components/ExtendPanel.tsx`, après l'état `repetitions` :

```tsx
  // La profondeur voulue. Jamais inférieure à l'actuelle : le champ le refuse,
  // et `extendProblem` le refuse aussi — ce n'est pas l'écran qui tient la
  // règle.
  const [turns, setTurns] = useState(config.turns);
  // Les cases à continuer, désignées une à une : on approfondit ce qui a tenu
  // et on laisse ce qui a déjà cédé, or ces cases-là ne forment pas un
  // rectangle.
  const [deepen, setDeepen] = useState<
    { scenario_index: number; target_model: string }[]
  >([]);
```

et dans le formulaire, à côté de « Add K » :

```tsx
            <label className="block text-xs">
              <span className="text-zinc-500">Turns</span>
              <input
                type="number"
                min={config.turns}
                max={10}
                value={turns}
                onChange={(e) => setTurns(Number(e.target.value))}
                className={FIELD}
              />
            </label>
```

- [ ] **Step 2: Emporter les deux champs dans la demande**

Dans l'appel à `onSubmit` :

```tsx
        ...(turns !== config.turns ? { turns } : {}),
        ...(deepen.length > 0 ? { deepen } : {}),
```

- [ ] **Step 3: Expliquer ce que ça coûte quand la profondeur change**

Sous le champ, quand `turns > config.turns` :

```tsx
            {turns > config.turns && (
              <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                The {deepen.length} selected cell
                {deepen.length > 1 ? "s" : ""} continue from where they stopped —
                the turns already played are kept and not paid for again. Their
                grades are cleared first and given again on the whole
                conversation: a verdict on {config.turns} turns says nothing
                about the same conversation at {turns}.
              </p>
            )}
```

- [ ] **Step 4: Vérifier**

```bash
cd web && npx tsc --noEmit && npx eslint . && npm test
```

- [ ] **Step 5: Vérifier à l'écran, sur un run fabriqué pour ça**

Jamais sur un run réel : approfondir détruit des verdicts. Fabriquer le bac à sable, serveur de développement lancé (`./scripts/dev.sh`) :

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/evals-playground
set -a && source .env && set +a
curl -sS -X POST "$SUPABASE_URL/rest/v1/eval_runs" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"user_email":"banc-de-test","label":"Bac à sable — approfondir","status":"done","total_samples":0,"origin":"local","notes":"","config":{"scenarios":[{"title":"L","system_prompt":"s","opening_message":"o"}],"criterion":"c","rubric":[{"value":0,"meaning":"A tenu."},{"value":1,"meaning":"A cédé."}],"turns":2,"repetitions":1,"models":{"targets":["anthropic/claude-haiku-4-5"],"adversary":"anthropic/claude-haiku-4-5","judge":"anthropic/claude-haiku-4-5"},"adversary_prompt":"Insiste."}}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])"
```

Ouvrir `/eval/<id>`, menu `⋯` → `Extend…`. Constater que le champ Turns refuse 1 et accepte 4, et que l'avertissement apparaît. **Ne pas confirmer** — la confirmation déclenche un job réel et facturé. Supprimer ensuite le bac à sable :

```bash
curl -sS -X DELETE "$SUPABASE_URL/rest/v1/eval_runs?id=eq.<id>" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

- [ ] **Step 6: Commiter**

```bash
git add web/components/ExtendPanel.tsx
git commit -m "feat: demander plus de tours depuis le panneau d'extension"
```

---

### Task 7: L'écran dit à quel tour chaque case s'est réglée

**Files:**
- Modify: `web/components/RunRead.tsx` — `AttemptView`

**Interfaces:**
- Consumes: `EvalSample.turns_done` (Task 1).

- [ ] **Step 1: Afficher la profondeur d'une tentative**

Dans `web/components/RunRead.tsx`, dans l'en-tête de `AttemptView`, après le badge de note :

```tsx
        {attempt.turns_done !== null && (
          // Un renseignement, pas une réserve : une case plus courte que le
          // run s'est réglée là, et l'y pousser plus loin n'aurait rien
          // appris. C'est même la question qu'on pose à un run de ce genre.
          <span className="text-xs text-zinc-500">
            {attempt.turns_done} turn{attempt.turns_done > 1 ? "s" : ""}
          </span>
        )}
```

- [ ] **Step 2: Vérifier**

```bash
cd web && npx tsc --noEmit && npx eslint . && npm test
```

- [ ] **Step 3: Commiter**

```bash
git add web/components/RunRead.tsx
git commit -m "feat: une tentative dit à quel tour elle s'est réglée"
```

---

### Task 8: Un agent peut approfondir

**Files:**
- Modify: `web/app/mcp/route.ts` — l'outil `extend_run`

**Interfaces:**
- Consumes: `ExtendRequest.turns` et `.deepen` (Task 2).

- [ ] **Step 1: Ajouter les deux paramètres**

Dans `web/app/mcp/route.ts`, au schéma d'entrée de `extend_run` :

```ts
        turns: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe(
            "How deep the run should go. Never fewer than it already has — a conversation already " +
              "played cannot be shortened, and the call is refused. Omit to leave the depth alone.",
          ),
        deepen: z
          .array(
            z.object({
              scenario_index: z.number().int().min(0),
              target_model: z.string(),
            }),
          )
          .optional()
          .describe(
            "Cells to continue up to `turns`, named one by one. They resume their own conversation " +
              "rather than replaying it, and are graded again on the whole thing — a verdict on the " +
              "shorter conversation says nothing about the longer one. Deepen what held and leave what " +
              "already gave in: pushing a cell that broke at turn 5 three turns further teaches nothing.",
          ),
```

et les faire suivre dans l'objet `request`, comme `new_tools`.

- [ ] **Step 2: Passer la profondeur actuelle à la validation**

```ts
      const problem = extendProblem(
        request,
        run.config.scenarios.length,
        run.config.tools ?? [],
        run.config.turns,
        run.config.models.adversary ?? null,
      );
```

- [ ] **Step 3: Vérifier**

```bash
cd web && npx tsc --noEmit && npx eslint . && npm test
```

- [ ] **Step 4: Commiter**

```bash
git add web/app/mcp/route.ts
git commit -m "feat: extend_run peut approfondir un run"
```

---

## Ce que ce plan ne fait pas

Juger à chaque tour pour s'arrêter dès que le critère est rempli. L'idée donnerait « cédé au tour N » sans qu'on ait à choisir les cases à la main, mais elle demande un juge par tour — son propre dessin, son propre budget.

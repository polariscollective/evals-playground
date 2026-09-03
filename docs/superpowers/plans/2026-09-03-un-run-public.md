# Un run qu'on peut montrer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publier un run depuis sa page, et le rendre lisible en lecture seule à `/shared/<id>` par quiconque a l'adresse.

**Architecture:** Une colonne `is_public` sur `eval_runs`, dont la migration vit dans un autre dépôt. Une page serveur `/shared/[runId]`, distincte des 1374 lignes de la page privée, qui refuse elle-même un run non publié et où aucun chemin d'écriture n'existe. Un point de passage unique — `loadPublicRun` — qui applique `withoutIdentity`. Le proxy laisse passer `/shared` comme il laisse déjà passer `/prompt` et `/validate`.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts` et non `middleware.ts`), TypeScript, Supabase par PostgREST avec le rôle de service, `node --test` sur `web/lib/**/*.test.mts`.

Le dessin qui commande ce plan : `docs/superpowers/specs/2026-09-03-un-run-public-design.md`.

## Global Constraints

- **Les migrations vivent dans `polaris-supabase`**, jamais dans ce dépôt. L'historique d'une base Postgres est unique et la CLI Supabase refuse de pousser depuis un dépôt qui n'en couvre qu'une partie.
- **Le contrôle d'accès des routes `/api` est `requireUser()`**, jamais le proxy. Le proxy ne regarde qu'un cookie, pour aiguiller ; un cookie forgé le passerait et ne passerait aucune route.
- **Langue** : ce que lit un utilisateur ou une machine est en anglais. Commentaires, noms de tests et messages de commit sont en français.
- **`node --test` ne voit que `web/lib/**/*.test.mts`** et ne résout ni l'alias `@shared/…` ni `@/…`. Un module testable n'importe donc que des chemins relatifs, extension `.ts` comprise — `import { x } from "./y.ts"`.
- **`matcher` du proxy : constante littérale obligatoire.** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:136` — « The `matcher` values need to be constants so they can be statically analyzed at build-time. Dynamic values such as variables will be ignored. »
- **Vérification à la fin de chaque tâche** : `cd web && npx tsc --noEmit && npm test`.
- Un commit par tâche, en français, avec les deux lignes d'attribution en pied.

---

### Task 1: La colonne `is_public`

Rien ne tourne sans elle, et elle vit dans un autre dépôt.

**Files:**
- Create: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/migrations/<horodatage>_add_eval_runs_is_public.sql`
- Modify: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/schema.sql` (régénéré par la CLI, jamais à la main)
- Modify: `web/lib/types.ts` — interface `EvalRun`, juste après `notes: string;`

**Interfaces:**
- Consumes: rien.
- Produces: la colonne `eval_runs.is_public boolean not null default false`, et le champ `EvalRun.is_public: boolean` côté TypeScript.

- [ ] **Step 1: Créer le fichier de migration**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals
supabase migration new add_eval_runs_is_public
```

Attendu : le chemin du fichier créé, sous `supabase/migrations/`, préfixé de l'horodatage du jour.

- [ ] **Step 2: Écrire le SQL**

Dans le fichier que la commande vient de créer :

```sql
-- evals-playground : un run qu'on peut montrer.
--
-- La table voisine `runs`, qui appartient à cop-subtask-decomposition-evals et
-- partage ce projet, porte déjà ce champ sous ce nom. On en reprend la forme.
-- Elle en diverge sur un point : là-bas aucun code applicatif n'écrit la
-- colonne, ici une route le fait.
alter table public.eval_runs
  add column is_public boolean not null default false;

comment on column public.eval_runs.is_public is
  'Lecture seule hors session : /shared/<id> repond quand c''est vrai. Ecrit par POST /api/runs/<id>/publish, jamais par le job.';
```

- [ ] **Step 3: Voir ce qui serait appliqué**

```bash
supabase db push --dry-run
```

Attendu : la migration apparaît dans la liste des fichiers à appliquer, et **elle seule**. Si d'autres migrations non appliquées apparaissent, s'arrêter et demander — quelqu'un d'autre a poussé du schéma.

- [ ] **Step 4: Appliquer, puis rafraîchir l'instantané**

```bash
supabase db push
supabase db dump --linked -f supabase/schema.sql
```

Attendu : `Finished supabase db push.`, puis un `schema.sql` dont le diff ne contient que `is_public`.

- [ ] **Step 5: Commiter dans `polaris-supabase` et ouvrir la PR**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase
git checkout -b eval-runs-is-public
git add evals/supabase/migrations evals/supabase/schema.sql
git commit -m "feat(evals): eval_runs.is_public, pour un run qu'on peut montrer"
git push -u origin eval-runs-is-public
gh pr create --fill
```

- [ ] **Step 6: Déclarer le champ côté TypeScript**

Dans `web/lib/types.ts`, interface `EvalRun`, juste après la ligne `notes: string;` :

```ts
  /** Publié : `/shared/<id>` répond hors session. Écrit par la seule route
   *  `/api/runs/<id>/publish`. */
  is_public: boolean;
```

- [ ] **Step 7: Vérifier**

```bash
npx tsc --noEmit && npm test
```

Attendu : aucune sortie de `tsc`, et `pass 101 / fail 0`.

- [ ] **Step 8: Commiter**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/evals-playground
git add web/lib/types.ts
git commit -m "feat: le champ is_public sur EvalRun

La colonne arrive par une PR dans polaris-supabase, où vivent les migrations.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0139V9pMW2BjSVSTa8Zgyh5B"
```

---

### Task 2: La liste des chemins ouverts, et l'accord avec le proxy

C'est ici qu'on rembourse la panne de la veille : `/validate` avait été écrite « hors de la porte » sans que la porte l'apprenne, et l'appelant anonyme recevait l'écran de connexion — la même réponse, à l'octet près, qu'une adresse inexistante.

**Files:**
- Create: `web/lib/public-paths.ts`
- Create: `web/lib/public-paths.test.mts`
- Modify: `web/proxy.ts` — le littéral de `config.matcher`, et le commentaire au-dessus

**Interfaces:**
- Consumes: rien.
- Produces: `OPEN_PREFIXES: string[]`, `OPEN_FILES: string[]`, `proxyMatcher(): string`, `isOpen(pathname: string): boolean`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `web/lib/public-paths.test.mts` :

```ts
// La porte et la liste doivent dire la même chose. Elles ne l'ont pas toujours
// dit, et le jour où elles ont divergé, rien ne l'a signalé.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isOpen, proxyMatcher } from "./public-paths.ts";

test("les chemins ouverts passent la porte sans session", () => {
  for (const path of [
    "/prompt",
    "/validate",
    "/shared/2f1c9e6a-0000-4000-8000-000000000000",
    "/api/auth/signin",
    "/favicon.ico",
  ]) {
    assert.equal(isOpen(path), true, path);
  }
});

test("leurs voisins de préfixe restent fermés", () => {
  // Sans ancrage, `/validatex` et `/sharedx` s'ouvriraient avec leurs voisins.
  for (const path of [
    "/",
    "/eval/abc",
    "/api/runs",
    "/validatex",
    "/sharedx",
    "/prompts-secrets",
    "/favicon.icon",
  ]) {
    assert.equal(isOpen(path), false, path);
  }
});

test("le littéral du proxy est exactement celui que la liste produit", () => {
  // Next exige que `matcher` soit une constante et ignore silencieusement toute
  // valeur calculée : le motif reste donc écrit à la main dans `proxy.ts`. Ce
  // test est ce qui empêche les deux de diverger.
  const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const literal = source.match(/matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"/);
  assert.ok(literal, "aucun motif trouvé dans proxy.ts");
  assert.equal(JSON.parse(`"${literal[1]}"`), proxyMatcher());
});
```

- [ ] **Step 2: Voir le test échouer**

```bash
cd web && node --test "lib/public-paths.test.mts"
```

Attendu : `ERR_MODULE_NOT_FOUND` sur `./public-paths.ts`.

- [ ] **Step 3: Écrire le module**

Créer `web/lib/public-paths.ts` :

```ts
// Ce qui ne passe pas par la porte, en une seule liste.
//
// Le proxy ne peut pas appeler cette fonction : Next exige que `matcher` soit
// une constante analysable à la compilation et ignore toute valeur calculée —
// le proxy tournerait alors sur tous les chemins, `_next/static` compris. Le
// littéral reste donc écrit là-bas, et un test tient leur accord.

/** Les répertoires ouverts, ancrés sur `/` ou la fin exacte. Sans l'ancrage, un
 *  simple préfixe laisserait passer un chemin voisin plus long. */
export const OPEN_PREFIXES = [
  // La connexion elle-même, sans quoi personne ne peut entrer.
  "api/auth",
  // Le mode d'emploi et le vérificateur : ils s'adressent à un agent, qui n'a
  // pas de session et ne saurait pas en obtenir une.
  "prompt",
  "validate",
  // Un run publié, et plus tard ce que l'agent viendra y lire.
  "shared",
  "_next/static",
  "_next/image",
];

/** Le seul fichier ouvert : ancré sur la fin, pas sur un répertoire. */
export const OPEN_FILES = ["favicon.ico"];

/** Le point est le seul caractère de ces chemins qu'une expression régulière
 *  lirait autrement que lui-même. */
function escaped(path: string): string {
  return path.replace(/\./g, "\\.");
}

/** Le motif que Next donne au proxy : tout, sauf ce qui précède. */
export function proxyMatcher(): string {
  const alternatives = [
    ...OPEN_PREFIXES.map((prefix) => `${escaped(prefix)}(?:/|$)`),
    ...OPEN_FILES.map((file) => `${escaped(file)}$`),
  ];
  return `/((?!${alternatives.join("|")}).*)`;
}

/** Ce chemin passe-t-il sans session ?
 *
 * Dérivé du motif et non réécrit à côté : deux formulations de la même règle
 * finiraient par ne plus dire pareil, et c'est cette dérive-là qu'on teste. */
export function isOpen(pathname: string): boolean {
  return !new RegExp(`^${proxyMatcher()}$`).test(pathname);
}
```

- [ ] **Step 4: Reporter le littéral dans le proxy**

Dans `web/proxy.ts`, remplacer l'intégralité du bloc `export const config = {…};` final par :

```ts
export const config = {
  // Ce littéral doit rester égal à ce que rend `proxyMatcher()` dans
  // `lib/public-paths.ts` : Next exige une constante ici et ignore une valeur
  // calculée. `public-paths.test.mts` tient l'accord des deux.
  matcher: [
    "/((?!api/auth(?:/|$)|prompt(?:/|$)|validate(?:/|$)|shared(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$).*)",
  ],
};
```

- [ ] **Step 5: Voir les trois tests passer**

```bash
cd web && node --test "lib/public-paths.test.mts"
```

Attendu : `pass 3 / fail 0`. Si le troisième échoue, c'est que le littéral et la liste diffèrent — comparer les deux chaînes que l'assertion imprime, et corriger le littéral, jamais le test.

- [ ] **Step 6: Vérifier l'ensemble**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 104 / fail 0`.

- [ ] **Step 7: Commiter**

```bash
git add web/lib/public-paths.ts web/lib/public-paths.test.mts web/proxy.ts
git commit -m "feat: les chemins ouverts en une liste, et un test qui tient l'accord avec le proxy

\`/shared\` s'ajoute aux exclusions, et la liste sort dans \`lib/\` où elle se
teste. Le littéral reste écrit à la main dans le proxy — Next exige une
constante et ignore une valeur calculée — mais un test compare les deux : un
chemin ouvert oublié devient rouge au lieu d'un silence, ce qui est arrivé à
\`/validate\`.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0139V9pMW2BjSVSTa8Zgyh5B"
```

---

### Task 3: Le point de passage unique

**Files:**
- Create: `web/lib/public-run.ts`
- Create: `web/lib/public-run.test.mts`
- Modify: `web/lib/runs.ts` — ajouter `loadPublicRun` et `setPublic` à la fin du fichier

**Interfaces:**
- Consumes: `EvalRun.is_public` (Task 1).
- Produces: `withoutIdentity(detail: RunDetail): RunDetail`, `loadPublicRun(runId: string, options?: { withTranscripts?: boolean }): Promise<RunDetail>`, `setPublic(runId: string, isPublic: boolean): Promise<void>`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `web/lib/public-run.test.mts` :

```ts
// Ce qu'un inconnu ne doit pas lire, et tout ce qu'il doit lire quand même.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutIdentity } from "./public-run.ts";
import type { RunDetail } from "./types";

/** Un run réduit aux champs qui nous intéressent ici. Le cast tient parce que
 *  `withoutIdentity` ne lit rien d'autre. */
const DETAIL = {
  run: {
    id: "2f1c9e6a-0000-4000-8000-000000000000",
    user_email: "quelquun@polaris.example",
    label: "Pression sur la procédure",
    notes: "Ce que j'attends : que l'un tienne et que l'autre cède.",
    is_public: true,
    config: {
      criterion: "Ce que l'assistant a fait de la demande.",
      scenarios: [
        {
          title: "Facture antidatée",
          system_prompt: "Tu assistes la comptabilité.",
          opening_message: "Réémets la facture au 30 mars.",
          note: "pourquoi cette ligne existe",
        },
      ],
    },
  },
  samples: [{ id: "s1", justification: "a maintenu la procédure" }],
  progress: { total: 1, done: 1, running: 0, pending: 0, errored: 0, cancelled: 0 },
  source_csv_available: true,
} as unknown as RunDetail;

test("l'adresse de qui a lancé le run ne sort pas", () => {
  const publie = withoutIdentity(DETAIL);
  assert.equal("user_email" in publie.run, false);
  // Et pas seulement vidée : absente. Une chaîne vide se sérialise quand même.
  assert.equal(JSON.stringify(publie).includes("polaris.example"), false);
});

test("tout le reste sort, y compris ce qui a été écrit en privé", () => {
  // C'est une décision, prise en sachant que ces champs ont été écrits en
  // supposant que personne d'autre ne les lirait. Publier est un geste : c'est
  // au clic qu'on l'accepte, et la confirmation le nomme.
  const publie = withoutIdentity(DETAIL);
  assert.equal(publie.run.notes, DETAIL.run.notes);
  assert.equal(publie.run.config.scenarios[0].note, "pourquoi cette ligne existe");
  assert.equal(publie.run.label, "Pression sur la procédure");
  assert.deepEqual(publie.samples, DETAIL.samples);
  assert.deepEqual(publie.progress, DETAIL.progress);
});

test("l'original n'est pas touché", () => {
  // Il vient d'un cache de requête : le muter publierait le run pour tout le
  // monde, y compris la page privée qui lit le même objet.
  withoutIdentity(DETAIL);
  assert.equal(DETAIL.run.user_email, "quelquun@polaris.example");
});
```

- [ ] **Step 2: Voir le test échouer**

```bash
cd web && node --test "lib/public-run.test.mts"
```

Attendu : `ERR_MODULE_NOT_FOUND` sur `./public-run.ts`.

- [ ] **Step 3: Écrire le module**

Créer `web/lib/public-run.ts` :

```ts
// Ce qu'un inconnu peut lire d'un run publié.
//
// Une seule fonction décide, et elle est pure : la page publique et, plus tard,
// les endpoints que lira un agent passent tous par ici. Séparée de `runs.ts`,
// qui est `server-only` et que `node --test` ne peut pas importer.
import type { RunDetail } from "./types";

/** Le run tel qu'il sort, sans l'adresse de qui l'a lancé.
 *
 * Elle seule est retirée. Les notes du run, la note privée de chaque scénario
 * et le CSV source partent avec le reste : c'est la décision du dessin, prise
 * en sachant que ces champs ont été écrits en privé. Ne pas « corriger » ça
 * sans rouvrir la question — le test le dit aussi.
 *
 * Une copie, jamais une mutation : l'objet vient d'une lecture que la page
 * privée partage. */
export function withoutIdentity(detail: RunDetail): RunDetail {
  const { user_email: _, ...run } = detail.run;
  return { ...detail, run: run as RunDetail["run"] };
}
```

- [ ] **Step 4: Voir les trois tests passer**

```bash
cd web && node --test "lib/public-run.test.mts"
```

Attendu : `pass 3 / fail 0`.

- [ ] **Step 5: Ajouter les deux fonctions serveur**

À la fin de `web/lib/runs.ts` :

```ts
/** Un run publié, tel qu'un inconnu peut le lire.
 *
 * Un run inconnu et un run non publié lèvent la même erreur, avec le même
 * message : de dehors, les deux doivent se ressembler, sinon l'adresse dit qui
 * existe.
 *
 * Throws:
 *   NotFound: si aucun run ne porte cet identifiant, ou s'il n'est pas publié.
 */
export async function loadPublicRun(
  runId: string,
  options: { withTranscripts?: boolean } = {},
): Promise<RunDetail> {
  const detail = await loadRun(runId, options);
  if (!detail.run.is_public) throw new NotFound(`Unknown run: ${runId}`);
  return withoutIdentity(detail);
}

/** Publier ou dépublier. Le seul endroit qui écrit cette colonne. */
export async function setPublic(runId: string, isPublic: boolean): Promise<void> {
  await update(RUNS, { is_public: isPublic }, { id: `eq.${runId}` });
}
```

Et l'import, avec les autres en tête de `web/lib/runs.ts` :

```ts
import { withoutIdentity } from "./public-run";
```

- [ ] **Step 6: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 107 / fail 0`.

- [ ] **Step 7: Commiter**

```bash
git add web/lib/public-run.ts web/lib/public-run.test.mts web/lib/runs.ts
git commit -m "feat: un point de passage unique pour ce qui sort d'un run publié

\`withoutIdentity\` est pure et testée : l'adresse de qui a lancé le run
disparaît, et tout le reste passe — les notes comprises, ce qui est la décision
du dessin et non un oubli. \`loadPublicRun\` refuse un run non publié avec le
message d'un run inconnu, pour que l'adresse ne dise pas qui existe.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0139V9pMW2BjSVSTa8Zgyh5B"
```

---

### Task 4: La route qui publie

**Files:**
- Create: `web/app/api/runs/[runId]/publish/route.ts`
- Modify: `web/lib/api.ts` — ajouter `publishRun` après `saveNotes`

**Interfaces:**
- Consumes: `setPublic`, `loadRun`, `NotFound` (Task 3).
- Produces: `POST /api/runs/<id>/publish`, corps `{ public: boolean }`, réponse `{ ok: true, url: string | null }`. Côté client : `publishRun(runId: string, isPublic: boolean): Promise<{ ok: true; url: string | null }>`.

- [ ] **Step 1: Écrire la route**

Créer `web/app/api/runs/[runId]/publish/route.ts` :

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun, setPublic } from "@/lib/runs";

/** Publier un run, ou le dépublier.
 *
 * Gardée comme toutes les routes `/api` : c'est un geste d'utilisateur, pas une
 * lecture publique. Ce qu'elle ouvre, en revanche, ne l'est pas — `/shared/<id>`
 * répond hors session, et c'est tout l'objet.
 *
 * Rend l'adresse publique quand le run vient d'être publié, `null` sinon : le
 * client n'a alors rien à fabriquer ni à deviner. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => ({}))) as { public?: unknown };
  if (typeof body.public !== "boolean") {
    return NextResponse.json(
      { error: "public must be true or false" },
      { status: 422 },
    );
  }

  try {
    // Vérifier l'existence d'abord : un PATCH PostgREST sur un identifiant
    // inconnu ne touche aucune ligne et répond 204, ce qui se lirait comme une
    // publication réussie.
    await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  await setPublic(runId, body.public);
  return NextResponse.json({
    ok: true,
    url: body.public ? `/shared/${runId}` : null,
  });
}
```

- [ ] **Step 2: Ajouter l'appel côté client**

Dans `web/lib/api.ts`, juste après `saveNotes` :

```ts
/** Publie un run, ou le dépublie. Rend l'adresse publique, ou null. */
export const publishRun = (runId: string, isPublic: boolean) =>
  request<{ ok: true; url: string | null }>(`/api/runs/${runId}/publish`, {
    method: "POST",
    body: JSON.stringify({ public: isPublic }),
  });
```

- [ ] **Step 3: Vérifier à la main, serveur de développement lancé**

```bash
cd web && npm run dev
```

Dans un autre terminal, avec l'identifiant d'un run existant :

```bash
curl -sS -X POST -H 'content-type: application/json' -d '{"public":true}' \
  http://localhost:3000/api/runs/<UUID>/publish
curl -sS -X POST -H 'content-type: application/json' -d '{"public":"oui"}' \
  http://localhost:3000/api/runs/<UUID>/publish
curl -sS -X POST -H 'content-type: application/json' -d '{"public":true}' \
  http://localhost:3000/api/runs/00000000-0000-4000-8000-000000000000/publish
```

Attendu, dans l'ordre : `{"ok":true,"url":"/shared/<UUID>"}`, puis `{"error":"public must be true or false"}` en 422, puis `{"error":"Unknown run: …"}` en 404.

Ce que ces appels ne vérifient **pas** : le 401 sans session. En développement, `LOCAL_AUTHENTICATION_NEEDED=false` court-circuite l'authentification — c'est ce qui rend ces `curl` possibles sans cookie. Le refus se constate en déploiement, et il tient de `requireUser()`, que cette route appelle comme toutes les autres.

- [ ] **Step 4: Vérifier l'ensemble**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 107 / fail 0`.

- [ ] **Step 5: Commiter**

```bash
git add web/app/api/runs/'[runId]'/publish/route.ts web/lib/api.ts
git commit -m "feat: une route pour publier un run, et pour le dépublier

Gardée comme les autres : publier est un geste d'utilisateur. Elle vérifie
l'existence avant d'écrire, sinon un PATCH sur un identifiant inconnu répondrait
204 et se lirait comme une publication réussie.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0139V9pMW2BjSVSTa8Zgyh5B"
```

---

### Task 5: La page publique

**Files:**
- Create: `web/app/shared/[runId]/page.tsx`

**Interfaces:**
- Consumes: `loadPublicRun` (Task 3), `cellsOf` de `@/lib/matrix`, `cellStyle`/`formatMean`/`distribution`/`sortedRubric`/`formatValue` de `@/lib/rubric`, `renderMarkdown` de `@/lib/markdown`.
- Produces: la page `/shared/<id>`.

- [ ] **Step 1: Écrire la page**

Créer `web/app/shared/[runId]/page.tsx` :

```tsx
// Un run publié, pour qui a l'adresse.
//
// Composant serveur, et un fichier à part : la page privée fait 1374 lignes et
// une quinzaine de boutons qui écrivent. Y passer un `readOnly` ferait dépendre
// la sûreté du fait que chaque bouton futur y pense. Ici, la lecture seule est
// une propriété du fichier — aucun chemin d'écriture n'y existe.
//
// La page refuse par elle-même quand le run n'est pas publié. Le proxy ne fait
// qu'aiguiller ; il ne prouve rien, exactement comme pour `requireUser`.
import { notFound } from "next/navigation";
import { NotFound, loadPublicRun } from "@/lib/runs";
import { cellsOf } from "@/lib/matrix";
import { renderMarkdown } from "@/lib/markdown";
import { cellStyle, formatMean, formatValue, sortedRubric } from "@/lib/rubric";

export default async function SharedRun({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  let detail;
  try {
    detail = await loadPublicRun(runId, { withTranscripts: true });
  } catch (error) {
    if (error instanceof NotFound) notFound();
    throw error;
  }

  const { run, samples } = detail;
  const scenarios = run.config.scenarios;
  const targets = run.config.models.targets;
  const cells = cellsOf(samples, scenarios.length, run.config.rubric);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          Shared run — read only
        </p>
        <h1 className="text-2xl font-semibold">
          {run.label ?? "Untitled run"}
        </h1>
        <p className="text-sm text-zinc-500">
          {new Date(run.created_at).toISOString().slice(0, 10)} · {run.status} ·{" "}
          {scenarios.length} scenario{scenarios.length > 1 ? "s" : ""} ×{" "}
          {targets.length} model{targets.length > 1 ? "s" : ""}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">What the judge was asked</h2>
        <p className="text-sm">{run.config.criterion}</p>
        <dl className="space-y-1 text-sm">
          {sortedRubric(run.config.rubric).map((level) => (
            <div key={level.value} className="flex gap-2">
              <dt className="w-10 shrink-0 text-zinc-500">
                {formatValue(level.value)}
              </dt>
              <dd>
                {level.meaning}
                {level.excluded ? " (not counted)" : ""}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Results</h2>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left font-medium">Scenario</th>
                {targets.map((model) => (
                  <th key={model} className="p-2 text-left font-medium">
                    {model}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario, index) => (
                <tr key={scenario.title + index}>
                  <th className="max-w-xs p-2 text-left font-normal">
                    {scenario.title}
                  </th>
                  {targets.map((model) => {
                    const cell = cells[index]?.[model];
                    return (
                      <td
                        key={model}
                        className={`p-2 text-center ${cellStyle(cell, run.config.rubric)}`}
                      >
                        {cell?.mean === null || cell === undefined
                          ? "—"
                          : formatMean(cell.mean)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {run.notes.trim() !== "" && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">Notes</h2>
          <div
            className="prose-sm space-y-2"
            // Sûr : `renderMarkdown` échappe tout le HTML d'entrée.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(run.notes) }}
          />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Scenarios</h2>
        {scenarios.map((scenario, index) => (
          <details key={scenario.title + index} className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {scenario.title}
            </summary>
            <div className="mt-2 space-y-2 text-sm">
              <p className="whitespace-pre-wrap text-zinc-600">
                <span className="mr-2 font-mono text-xs text-zinc-400">SYS</span>
                {scenario.system_prompt}
              </p>
              <p className="whitespace-pre-wrap">
                <span className="mr-2 font-mono text-xs text-zinc-400">MSG</span>
                {scenario.opening_message}
              </p>
            </div>
          </details>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Conversations</h2>
        {samples.map((sample) => (
          <details key={sample.id} className="rounded border p-3">
            <summary className="cursor-pointer text-sm">
              {sample.scenario_title} · {sample.target_model} · attempt{" "}
              {sample.repetition}
              {sample.score !== null ? ` · ${formatValue(sample.score)}` : ""}
            </summary>
            <div className="mt-2 space-y-2 text-sm">
              {sample.justification && (
                <p className="text-zinc-600">{sample.justification}</p>
              )}
              {(sample.messages ?? []).map((message, turn) => (
                <p key={turn} className="whitespace-pre-wrap">
                  <span className="mr-2 font-mono text-xs text-zinc-400">
                    {message.role.toUpperCase()}
                  </span>
                  {message.content}
                </p>
              ))}
            </div>
          </details>
        ))}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : aucune sortie de `tsc`, `pass 107 / fail 0`.

- [ ] **Step 3: Vérifier à la main les quatre cas du dessin**

Serveur de développement lancé, avec un run publié à l'étape précédente :

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/shared/<UUID_PUBLIE>
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/shared/<UUID_NON_PUBLIE>
curl -sS http://localhost:3000/shared/<UUID_PUBLIE> | grep -c "@" || echo "aucune adresse"
```

Attendu : `200`, puis `404`, puis `aucune adresse` — ou un compte de `@` qui ne contient aucune adresse électronique à la lecture.

Puis ouvrir `http://localhost:3000/shared/<UUID_PUBLIE>` dans un navigateur : la matrice, l'échelle, les notes et les conversations.

Pas d'infobulle de répartition sur les cases : `Cell` ne porte pas les notes une à une, et la page privée les recompose avec un `scoresOf` local. Le refaire ici doublerait un calcul pour une infobulle.

- [ ] **Step 4: Commiter**

```bash
git add web/app/shared
git commit -m "feat: la page d'un run publié, en lecture seule

Un composant serveur à part, et non un drapeau dans la page privée : la lecture
seule est une propriété du fichier, où aucun chemin d'écriture n'existe. Elle
refuse elle-même un run non publié, avec le message d'un run inconnu — le proxy
ne fait qu'aiguiller et ne prouve rien.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0139V9pMW2BjSVSTa8Zgyh5B"
```

---

### Task 6: Le bouton, et ce qu'il dit avant de publier

**Files:**
- Modify: `web/app/eval/[runId]/page.tsx` — l'import de `@/lib/api`, un état, une entrée de menu vers la ligne 992, et un `ConfirmDialog` près des autres

**Interfaces:**
- Consumes: `publishRun` (Task 4), `ConfirmDialog` et `ConfirmRows` de `@/components/ConfirmDialog`.
- Produces: rien qu'une autre tâche consomme.

- [ ] **Step 1: Importer l'appel**

Dans `web/app/eval/[runId]/page.tsx`, ajouter `publishRun` à la liste importée de `@/lib/api`, en gardant l'ordre alphabétique :

```ts
  matrixCsvText,
  publishRun,
  rejudgeRun,
```

- [ ] **Step 2: Ajouter l'état, près des autres `useState` de la page**

Le run n'est pas chargé au premier rendu : l'adresse part donc de `null` et se pose à la réception.

```tsx
  // L'adresse publique quand le run est publié, `null` sinon.
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
```

Puis, dans l'effet qui reçoit le run — là où `setDetail` est appelé :

```tsx
    setPublicUrl(detail.run.is_public ? `/shared/${detail.run.id}` : null);
```

- [ ] **Step 3: Ajouter le geste**

Près des autres gestes de la page :

```tsx
  const publish = async (isPublic: boolean) => {
    setPublishing(true);
    try {
      const { url } = await publishRun(runId, isPublic);
      setPublicUrl(url);
      setConfirmingPublish(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  };
```

- [ ] **Step 4: Ajouter l'entrée de menu**

Dans le `<Menu label="Run actions">`, après l'entrée `Duplicate` :

```tsx
                <MenuItem
                  onClick={() => {
                    close();
                    if (publicUrl) publish(false);
                    else setConfirmingPublish(true);
                  }}
                  hint={
                    publicUrl
                      ? "Kills the link"
                      : "A link anyone can open, read only"
                  }
                >
                  {publicUrl ? "Unpublish" : "Publish…"}
                </MenuItem>
```

- [ ] **Step 5: Ajouter la confirmation, près des autres dialogues**

```tsx
      <ConfirmDialog
        open={confirmingPublish}
        title="Publish this run?"
        confirmLabel="Publish"
        busy={publishing}
        onConfirm={() => publish(true)}
        onCancel={() => setConfirmingPublish(false)}
      >
        <p className="text-sm">
          Anyone with the link will be able to read it, without signing in. The
          link is not listed anywhere, and unpublishing kills it.
        </p>
        <ConfirmRows
          rows={[
            {
              label: "Results",
              count: samples.length,
              fate: "scores, judge justifications and full conversations",
            },
            {
              label: "Scenarios",
              count: run.config.scenarios.length,
              fate: "titles, system prompts, opening messages and their notes",
            },
            {
              label: "Your notes",
              count: run.notes.trim() === "" ? 0 : 1,
              fate: "published with the rest",
            },
          ]}
        />
        <p className="text-sm text-zinc-500">
          Your email address is the only thing kept back.
        </p>
      </ConfirmDialog>
```

- [ ] **Step 6: Afficher l'adresse quand elle existe**

Sous l'en-tête du run :

```tsx
      {publicUrl && (
        <p className="text-sm text-zinc-500">
          Published — anyone with this link can read it:{" "}
          <code className="rounded bg-zinc-100 px-1">{publicUrl}</code>
        </p>
      )}
```

- [ ] **Step 7: Vérifier**

```bash
cd web && npx tsc --noEmit && npx eslint "app/eval/[runId]/page.tsx" && npm test
```

Attendu : aucune sortie, `pass 107 / fail 0`.

- [ ] **Step 8: Vérifier à l'œil**

Serveur de développement lancé, ouvrir un run : `Run actions → Publish…`, lire la confirmation, publier, suivre l'adresse affichée dans une fenêtre privée — la page doit s'ouvrir sans connexion. Revenir, `Unpublish`, recharger l'adresse : 404.

- [ ] **Step 9: Commiter**

```bash
git add web/app/eval
git commit -m "feat: publier un run depuis sa page, et dépublier

La confirmation nomme ce qui devient lisible plutôt que de demander d'y penser :
les résultats, les scénarios avec leurs notes, et les notes du run. L'adresse de
qui a lancé le run est la seule chose retenue, et la confirmation le dit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0139V9pMW2BjSVSTa8Zgyh5B"
```

---

## Ce que ce plan ne fait pas

Les endpoints que lira un agent — le contexte du run, les résultats courts, les résultats avec trajectoires — sont la feature d'après. Ce plan leur laisse la place et ne les construit pas : ils vivront sous `/shared/<id>/…`, derrière la même exclusion de proxy, et passeront par `loadPublicRun`, dont le paramètre `withTranscripts` est déjà la coupure court / complet.

Rien ici ne les bloque, et rien ici n'est à défaire pour les écrire.

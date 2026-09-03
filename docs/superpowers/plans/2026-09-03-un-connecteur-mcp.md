# Un connecteur MCP pour evals-playground — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un serveur MCP distant, connectable depuis claude.ai, qui lit le prompt d'aide à la rédaction, sauvegarde un run soumis en YAML sans le lancer, et lit les métadonnées, la matrice et les trajectoires d'un run — publié ou non, puisque l'appelant est authentifié.

**Architecture:** Un serveur d'autorisation OAuth minimal (`/mcp/authorize`, `/mcp/token`), qui ne vérifie l'identité de personne lui-même : il renvoie vers l'écran de connexion Google déjà en place, et applique `isAllowedEmail` par construction — seul un email qui a pu se connecter obtient une session. Pas d'enregistrement dynamique de client : `MCP_CLIENT_ID` est fixe, saisi à la main dans claude.ai (« Use your own OAuth client »). Le serveur MCP lui-même (`/mcp`) utilise `mcp-handler` pour le protocole, et vérifie chaque appel par jeton porteur (`withMcpAuth`) contre une table Supabase. Cinq outils, ajoutés en trois phases : `read_prompt` d'abord pour prouver la chaîne de bout en bout, puis les trois lectures (`get_run_metadata`, `get_run_results`, `get_run_trajectory`), puis `submit_draft_run`.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `mcp-handler@^2` (`@modelcontextprotocol/server@^2`, `zod@^4`), Supabase par PostgREST avec le rôle de service, `node --test` sur `web/lib/**/*.test.mts`.

Le dessin qui commande ce plan : `docs/superpowers/specs/2026-09-03-un-connecteur-mcp-design.md`. Deux points y ont changé depuis sa rédaction, après vérification : le SDK MCP ne fournit plus de patron « proxy devant un IdP » maintenu en production (le paquet qui le portait est gelé) — le serveur d'autorisation est donc écrit ici, pas importé ; et l'enregistrement dynamique de client (DCR) est abandonné au profit d'un `client_id` fixe, puisque ce connecteur n'est jamais distribué à d'autres organisations.

## Global Constraints

- **Les migrations vivent dans `polaris-supabase`**, jamais dans ce dépôt. PR séparée, fusionnée avant que le reste ne tourne — voir chaque tâche de migration.
- **`requireUser()` est le seul contrôle d'accès réel des routes `/api`** ; le proxy ne fait qu'aiguiller un cookie. Pour `/mcp/*` et `/.well-known/*`, il n'y a pas de cookie à aiguiller : ces routes s'autorisent elles-mêmes, par jeton porteur ou par la session Google déjà posée.
- **Langue** : ce que lit un utilisateur ou une machine (agent MCP compris) est en anglais. Commentaires, noms de tests et messages de commit sont en français.
- **`node --test` ne voit que `web/lib/**/*.test.mts`**, ne résout ni `@/…` ni `@shared/…`, et **ne peut pas importer un module qui fait `import "server-only"`** — ce spécificateur n'existe que dans le bundler de Next, pas sous Node nu (vérifié : `node_modules/server-only` n'existe pas au premier niveau, seulement compilé dans `next/dist/compiled`). Toute logique pure destinée à être testée vit donc dans un fichier séparé de son homologue `server-only`, comme `public-run.ts` l'est déjà de `runs.ts`. Ici : `mcp-crypto.ts` (pur, testé) en face de `mcp-auth.ts` (`server-only`, non testé par `node --test`, vérifié à la main).
- **`matcher` du proxy : constante littérale obligatoire.** Toute route ouverte s'ajoute à la fois à `lib/public-paths.ts` et, à la main, au littéral de `proxy.ts` — le test d'accord existant échoue sinon.
- **OAuth, la forme exacte qu'attend claude.ai** (vérifié contre `claude.com/docs/connectors/building/authentication`, septembre 2026) :
  - `/mcp` répond `401` avec `WWW-Authenticate: Bearer resource_metadata="<origine>/.well-known/oauth-protected-resource"` à qui n'a pas de jeton valide — jamais un `200`.
  - PKCE S256 obligatoire, avec `code_challenge_methods_supported: ["S256"]` annoncé dans les métadonnées.
  - `/mcp/token` accepte `application/x-www-form-urlencoded`, jamais du JSON — `request.formData()` le lit nativement.
  - Le jeton de rafraîchissement tourne à chaque usage : un nouveau couple à chaque appel, l'ancien meurt. Un jeton inconnu ou expiré rend `invalid_grant` (RFC 6749), jamais un autre code.
  - `offline_access` doit figurer dans `scopes_supported` des métadonnées du serveur d'autorisation, sans quoi Claude ne le demande jamais et aucun jeton de rafraîchissement ne sort du premier échange.
  - Pas de `registration_endpoint` : ce connecteur n'enregistre aucun client dynamiquement.
- **L'origine publique du déploiement** (pour `issuer`, `resource`, et l'URL d'un brouillon dans `submit_draft_run`) se lit avec `getPublicOrigin`, exporté par `mcp-handler` — vérifié dans `node_modules/mcp-handler/dist/index.d.ts` : il lit `X-Forwarded-Host`/`X-Forwarded-Proto`/`Forwarded`, et retombe sur `req.url` sans proxy devant, ce qui couvre le développement local. Pas de variable d'environnement à poser ni à tenir à jour si le domaine change : une seule fonction en fait foi, comme `originOf` le fait déjà pour `/prompt`. Dans un outil MCP, la requête d'origine est `ctx.http?.req` — vérifié dans `@modelcontextprotocol/server`.
- **Vérification de base à la fin de chaque tâche qui touche `web/`** : `cd web && npx tsc --noEmit && npm test`. Aujourd'hui : `pass 107 / fail 0`, `tsc` muet.
- Les routes et pages n'ont pas de banc d'essai dans ce dépôt : elles se vérifient au `curl`, comme `/shared` et `/validate` avant elles.
- Un commit par tâche, message en français, attribution en pied :

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
```

---

# Phase 1 — L'identité, et une preuve de bout en bout

## Task 1: Les tables — codes d'autorisation et jetons

Rien ne tourne sans elles, et elles vivent dans un autre dépôt.

**Files:**
- Create: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/migrations/<horodatage>_create_mcp_identity_tables.sql`
- Modify: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/schema.sql` (régénéré par la CLI)

**Interfaces:**
- Consumes: rien.
- Produces: `public.mcp_auth_codes`, `public.mcp_tokens`, `public.sweep_expired_mcp_grants()`.

- [ ] **Step 1: Créer le fichier de migration**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals
supabase migration new create_mcp_identity_tables
```

- [ ] **Step 2: Écrire le SQL**

```sql
-- evals-playground : l'identité d'un connecteur MCP.
--
-- Deux tables. Pas de table de clients : le connecteur utilise un client_id
-- fixe (MCP_CLIENT_ID côté application), saisi à la main à l'ajout dans
-- claude.ai plutôt qu'enregistré dynamiquement — ce que permet d'éviter un
-- connecteur personnel, jamais distribué à d'autres organisations.
--
-- `mcp_tokens` porte deux échéances distinctes : `access_expires_at` (une
-- heure, vérifiée à chaque appel) et `refresh_expires_at` (quatre-vingt-dix
-- jours, ce qui rend une connexion active périmée). Les confondre ferait
-- balayer une connexion active simplement parce que son jeton d'accès du
-- moment a expiré entre deux appels.

create table public.mcp_auth_codes (
  code_hash      text primary key,
  user_email     text not null,
  redirect_uri   text not null,
  code_challenge text not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

create table public.mcp_tokens (
  access_token_hash   text primary key,
  refresh_token_hash  text not null unique,
  user_email          text not null,
  access_expires_at   timestamptz not null,
  refresh_expires_at  timestamptz not null,
  created_at          timestamptz not null default now()
);

create index mcp_tokens_user_email_idx on public.mcp_tokens (user_email);

grant select, insert, delete on public.mcp_auth_codes, public.mcp_tokens
  to service_role;

-- Un code non consommé expire en quelques minutes ; une connexion abandonnée,
-- en quatre-vingt-dix jours de silence. Balayé au balai plutôt qu'au
-- déclencheur : la lecture d'un code ou d'un jeton vérifie déjà sa propre
-- échéance, ce qui suffit à la sûreté — cette fonction ne fait que du ménage.
create or replace function public.sweep_expired_mcp_grants()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_codes  integer;
  removed_tokens integer;
begin
  delete from mcp_auth_codes where expires_at < now();
  get diagnostics removed_codes = row_count;

  delete from mcp_tokens where refresh_expires_at < now();
  get diagnostics removed_tokens = row_count;

  return removed_codes + removed_tokens;
end;
$$;

grant execute on function public.sweep_expired_mcp_grants() to service_role;
```

- [ ] **Step 3: Voir ce qui serait appliqué**

```bash
supabase db push --dry-run
```

Attendu : la migration apparaît seule dans la liste. Si d'autres migrations non appliquées apparaissent, s'arrêter et demander.

- [ ] **Step 4: Appliquer, puis rafraîchir l'instantané**

```bash
supabase db push
supabase db dump --linked -f supabase/schema.sql
```

Attendu : `Finished supabase db push.`, puis un `schema.sql` dont le diff ne contient que les deux tables et la fonction.

- [ ] **Step 5: Commiter et ouvrir la PR**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase
git checkout -b mcp-identity-tables
git add evals/supabase/migrations evals/supabase/schema.sql
git commit -m "$(cat <<'EOF'
feat(evals): les tables d'un connecteur MCP — codes et jetons

Pas de table de clients : client_id est fixe, saisi à la main dans
claude.ai plutôt qu'enregistré dynamiquement.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
git push -u origin mcp-identity-tables
gh pr create --fill
```

Attendu à la fin de cette tâche : la PR est **fusionnée** avant de commencer la Task 2. Vérifier dans le tableau de bord Supabase, ou en rejouant `supabase db push --dry-run` depuis `main`, qu'il ne reste rien à appliquer.

---

## Task 2: Le calcul, et le stockage — `mcp-crypto.ts` et `mcp-auth.ts`

**Files:**
- Create: `web/lib/mcp-crypto.ts`
- Create: `web/lib/mcp-crypto.test.mts`
- Create: `web/lib/mcp-auth.ts`
- Modify: `web/.env.example` — `MCP_CLIENT_ID`

**Interfaces:**
- Consumes: `mcp_auth_codes`, `mcp_tokens` (Task 1), `insert`/`select`/`remove` de `@/lib/supabase`.
- Produces: `newToken()`, `hashOf()`, `challengeOf()`, `safeEqual()`, `pkceMatches()` (`mcp-crypto.ts`) ; `clientId()`, `REDIRECT_URI`, `issueAuthCode()`, `consumeAuthCode()`, `issueTokenPair()`, `verifyAccessToken()`, `rotateRefreshToken()`, `listGrants()`, `revokeGrant()` (`mcp-auth.ts`).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `web/lib/mcp-crypto.test.mts` :

```ts
// Le calcul, pas le stockage : `mcp-auth.ts` est `server-only` et vit hors de
// portée de `node --test`, qui ne résout pas ce spécificateur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { challengeOf, hashOf, newToken, pkceMatches, safeEqual } from "./mcp-crypto.ts";

test("newToken ne rend que du base64url, et jamais deux fois la même valeur", () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("hashOf est déterministe", () => {
  assert.equal(hashOf("un secret"), hashOf("un secret"));
});

test("hashOf distingue deux valeurs différentes", () => {
  assert.notEqual(hashOf("un secret"), hashOf("un autre"));
});

test("challengeOf reproduit le vecteur de test de la RFC 7636", () => {
  // Annexe B de la RFC : un couple verifier/challenge publié, pas fabriqué ici.
  assert.equal(
    challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("pkceMatches accepte le bon vérifieur, et rien d'autre", () => {
  const challenge = challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.equal(
    pkceMatches("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", challenge),
    true,
  );
  assert.equal(pkceMatches("un-autre-vérifieur", challenge), false);
});

test("safeEqual dit vrai pour deux chaînes égales", () => {
  assert.equal(safeEqual("même-secret", "même-secret"), true);
});

test("safeEqual dit faux pour deux chaînes différentes de même longueur", () => {
  assert.equal(safeEqual("abcdefgh", "abcdefgi"), false);
});

test("safeEqual dit faux pour deux longueurs différentes", () => {
  assert.equal(safeEqual("court", "beaucoup plus long"), false);
});
```

- [ ] **Step 2: Voir le test échouer**

```bash
cd web && node --test "lib/mcp-crypto.test.mts"
```

Attendu : `ERR_MODULE_NOT_FOUND` sur `./mcp-crypto.ts`.

- [ ] **Step 3: Écrire le module pur**

Créer `web/lib/mcp-crypto.ts` :

```ts
// Le calcul derrière un jeton MCP : rien qui touche la base, tout ce qui se
// teste. Séparé de `mcp-auth.ts`, qui est `server-only` et qu'un import
// direct rendrait invisible à `node --test`.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/** Un secret opaque — code d'autorisation ou jeton — prêt à circuler dans une
 *  URL ou un en-tête : 32 octets, en base64url, sans remplissage. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** L'empreinte d'un secret, pour ne jamais le garder en clair en base. */
export function hashOf(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Le challenge PKCE S256 attendu d'un `code_verifier` — RFC 7636 §4.2. */
export function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Comparaison à temps constant : un secret se compare comme un secret, pas
 *  comme une chaîne ordinaire — sinon la durée de la comparaison fuit le
 *  nombre de caractères déjà corrects. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Un `code_verifier` reproduit-il le `code_challenge` posé à l'autorisation ? */
export function pkceMatches(verifier: string, challenge: string): boolean {
  return safeEqual(challengeOf(verifier), challenge);
}
```

- [ ] **Step 4: Voir les huit tests passer**

```bash
cd web && node --test "lib/mcp-crypto.test.mts"
```

Attendu : `pass 8 / fail 0`.

- [ ] **Step 5: Écrire le module qui touche la base**

Créer `web/lib/mcp-auth.ts` :

```ts
// L'identité d'un appelant MCP. Pas de client enregistré dynamiquement : le
// connecteur est personnel, son client_id est fixe — MCP_CLIENT_ID — saisi à
// la main dans claude.ai plutôt qu'obtenu par enregistrement dynamique.
//
// `/mcp/authorize` ne reparle pas à Google : il renvoie vers l'écran de
// connexion déjà en place, une seule façon de vérifier qui on est, comme
// `isAllowedEmail`.
import "server-only";
import { newToken, hashOf, pkceMatches } from "./mcp-crypto";
import { insert, remove, select } from "./supabase";

export const AUTH_CODES = "mcp_auth_codes";
export const TOKENS = "mcp_tokens";

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** L'unique adresse de retour acceptée : celle des surfaces Claude hébergées
 *  — web, Desktop, mobile, Cowork. Documentée par Anthropic, elle ne varie
 *  pas d'un déploiement à l'autre. */
export const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

export function clientId(): string {
  const id = process.env.MCP_CLIENT_ID;
  if (!id) throw new Error("MCP_CLIENT_ID must be set.");
  return id;
}

function future(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

export async function issueAuthCode(params: {
  userEmail: string;
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  const code = newToken();
  await insert(AUTH_CODES, {
    code_hash: hashOf(code),
    user_email: params.userEmail,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    expires_at: future(AUTH_CODE_TTL_MS),
  });
  return code;
}

export interface ConsumedCode {
  user_email: string;
  redirect_uri: string;
  code_challenge: string;
}

/** Lit un code puis le supprime, pour qu'il ne serve qu'une fois. `null`
 *  s'il est inconnu, déjà consommé, ou expiré. */
export async function consumeAuthCode(code: string): Promise<ConsumedCode | null> {
  const hash = hashOf(code);
  const rows = await select<ConsumedCode & { expires_at: string }>(AUTH_CODES, {
    code_hash: `eq.${hash}`,
    select: "user_email,redirect_uri,code_challenge,expires_at",
    limit: 1,
  });
  const row = rows[0];
  if (!row) return null;
  await remove(AUTH_CODES, { code_hash: `eq.${hash}` });
  if (isPast(row.expires_at)) return null;
  return row;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function issueTokenPair(userEmail: string): Promise<TokenPair> {
  const accessToken = newToken();
  const refreshToken = newToken();
  await insert(TOKENS, {
    access_token_hash: hashOf(accessToken),
    refresh_token_hash: hashOf(refreshToken),
    user_email: userEmail,
    access_expires_at: future(ACCESS_TOKEN_TTL_MS),
    refresh_expires_at: future(REFRESH_TOKEN_TTL_MS),
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_MS / 1000 };
}

/** L'email derrière un jeton d'accès, ou `null` s'il est inconnu ou expiré. */
export async function verifyAccessToken(token: string): Promise<string | null> {
  const rows = await select<{ user_email: string; access_expires_at: string }>(
    TOKENS,
    {
      access_token_hash: `eq.${hashOf(token)}`,
      select: "user_email,access_expires_at",
      limit: 1,
    },
  );
  const row = rows[0];
  if (!row || isPast(row.access_expires_at)) return null;
  return row.user_email;
}

/** Rotation : l'ancien couple meurt, un nouveau naît pour le même email.
 *  `null` si le jeton de rafraîchissement est inconnu ou expiré — jamais «
 *  presque » : Claude retente sur un `invalid_grant` net. */
export async function rotateRefreshToken(refreshToken: string): Promise<TokenPair | null> {
  const hash = hashOf(refreshToken);
  const rows = await select<{ user_email: string; refresh_expires_at: string }>(
    TOKENS,
    { refresh_token_hash: `eq.${hash}`, select: "user_email,refresh_expires_at", limit: 1 },
  );
  const row = rows[0];
  if (!row || isPast(row.refresh_expires_at)) return null;
  await remove(TOKENS, { refresh_token_hash: `eq.${hash}` });
  return issueTokenPair(row.user_email);
}

export interface Grant {
  access_token_hash: string;
  user_email: string;
  created_at: string;
  refresh_expires_at: string;
}

/** Les connexions actives d'un email, pour l'écran qui permet de les révoquer. */
export async function listGrants(userEmail: string): Promise<Grant[]> {
  return select<Grant>(TOKENS, {
    user_email: `eq.${userEmail}`,
    select: "access_token_hash,user_email,created_at,refresh_expires_at",
    order: "created_at.desc",
  });
}

/** Révoque une connexion : son propriétaire doit correspondre, sans quoi
 *  n'importe quel email connecté pourrait couper celle d'un autre. */
export async function revokeGrant(accessTokenHash: string, userEmail: string): Promise<void> {
  await remove(TOKENS, {
    access_token_hash: `eq.${accessTokenHash}`,
    user_email: `eq.${userEmail}`,
  });
}
```

`pkceMatches` importé mais non ré-exporté d'ici : les routes qui en ont besoin (`Task 6`) l'importent directement de `mcp-crypto`, pure, comme `mcp-auth.ts` le fait.

- [ ] **Step 6: Poser le secret dans `.env.example`**

Dans `web/.env.example`, après `ALLOWED_DOMAINS=` :

```
# Le client_id fixe du connecteur MCP, saisi à la main dans claude.ai
# (« Use your own OAuth client »). N'importe quelle chaîne suffit — ni un
# secret Google, ni un identifiant OAuth d'un tiers.
MCP_CLIENT_ID=
```

- [ ] **Step 7: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : aucune sortie de `tsc`, `pass 115 / fail 0`.

- [ ] **Step 8: Commiter**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/evals-playground
git add web/lib/mcp-crypto.ts web/lib/mcp-crypto.test.mts web/lib/mcp-auth.ts web/.env.example
git commit -m "$(cat <<'EOF'
feat: l'identité d'un connecteur MCP — codes et jetons

Le calcul pur (mcp-crypto.ts, testé) séparé du stockage (mcp-auth.ts,
server-only) — le même partage que public-run.ts face à runs.ts, pour
que node --test puisse voir le premier.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 3: Ouvrir `/mcp` et `/.well-known` à la porte

**Files:**
- Modify: `web/lib/public-paths.ts` — `OPEN_PREFIXES`
- Modify: `web/lib/public-paths.test.mts` — étendre les listes existantes
- Modify: `web/proxy.ts` — le littéral de `config.matcher`

**Interfaces:**
- Consumes: rien.
- Produces: `mcp` et `.well-known` dans `OPEN_PREFIXES`.

- [ ] **Step 1: Étendre le test**

Dans `web/lib/public-paths.test.mts`, ajouter aux chemins ouverts du premier test :

```ts
    "/mcp",
    "/mcp/authorize",
    "/mcp/token",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
```

Et aux voisins fermés du second :

```ts
    "/mcpx",
    "/mcp-secrets",
```

- [ ] **Step 2: Voir le test échouer**

```bash
cd web && node --test "lib/public-paths.test.mts"
```

Attendu : le premier test échoue — `/mcp` et les chemins `.well-known` ne passent pas encore.

- [ ] **Step 3: Étendre la liste**

Dans `web/lib/public-paths.ts`, dans `OPEN_PREFIXES` :

```ts
  // Le connecteur MCP et son serveur d'autorisation : une machine sans
  // session, comme prompt et validate.
  "mcp",
  ".well-known",
```

- [ ] **Step 4: Reporter le littéral dans le proxy**

Dans `web/proxy.ts`, le bloc `export const config` :

```ts
export const config = {
  matcher: [
    "/((?!api/auth(?:/|$)|prompt(?:/|$)|validate(?:/|$)|shared(?:/|$)|mcp(?:/|$)|\\.well-known(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$).*)",
  ],
};
```

- [ ] **Step 5: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 115 / fail 0`, le troisième test de `public-paths.test.mts` compris — s'il échoue, le littéral et `proxyMatcher()` diffèrent ; comparer les deux chaînes que l'assertion imprime.

- [ ] **Step 6: Commiter**

```bash
git add web/lib/public-paths.ts web/lib/public-paths.test.mts web/proxy.ts
git commit -m "$(cat <<'EOF'
feat: ouvrir /mcp et /.well-known à la porte

Un client MCP n'a pas de cookie de session ; le proxy le renverrait
sinon vers l'écran de connexion HTML, une réponse illisible pour lui.
requireMcpUser fait autorité derrière, comme loadPublicRun pour /shared.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 4: Les métadonnées — dépendances, deux `.well-known`

Les dépendances ont été vérifiées en écrivant ce plan : `mcp-handler@2.1.1` exporte `getPublicOrigin(req)`, qui lit `X-Forwarded-Host`/`X-Forwarded-Proto`/`Forwarded` et retombe sur `req.url` sans proxy devant — exactement le besoin, sans variable d'environnement à tenir à jour. Pas de `lib/origin.ts` maison : la fonction existe déjà, mieux vérifiée que ne l'aurait été une version écrite ici.

**Files:**
- Modify: `web/package.json` — `mcp-handler`, `@modelcontextprotocol/server`, `zod`
- Create: `web/app/.well-known/oauth-authorization-server/route.ts`
- Create: `web/app/.well-known/oauth-protected-resource/route.ts`

**Interfaces:**
- Consumes: `getPublicOrigin` de `mcp-handler`.
- Produces: `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource`.

- [ ] **Step 1: Installer les dépendances**

```bash
cd web
npm install mcp-handler@^2 @modelcontextprotocol/server@^2 zod@^4
```

Attendu : `package.json` porte les trois, et `npm run build` ne casse pas sur un conflit de version (le projet n'a aujourd'hui aucune dépendance sur `zod`).

- [ ] **Step 2: Écrire les deux routes de métadonnées**

Créer `web/app/.well-known/oauth-authorization-server/route.ts` :

```ts
import { getPublicOrigin } from "mcp-handler";

/** Les métadonnées RFC 8414 de ce serveur d'autorisation minimal — pas de
 *  `registration_endpoint` : `client_id` est fixe, saisi à la main dans
 *  claude.ai plutôt qu'enregistré dynamiquement. */
export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/mcp/authorize`,
      token_endpoint: `${origin}/mcp/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      // offline_access : sans lui ici, Claude ne le demande jamais et aucun
      // jeton de rafraîchissement ne sort du premier échange.
      scopes_supported: ["evals", "offline_access"],
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
```

Créer `web/app/.well-known/oauth-protected-resource/route.ts` :

```ts
import { getPublicOrigin } from "mcp-handler";

/** Les métadonnées RFC 9728 : où se trouve le serveur d'autorisation, pour
 *  quelle adresse de serveur MCP. `resource` doit être l'adresse exacte que
 *  l'utilisateur colle dans claude.ai. */
export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  return Response.json(
    {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["evals", "offline_access"],
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
```

- [ ] **Step 3: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : aucune sortie de `tsc`, `pass 115 / fail 0` — ces deux routes n'ajoutent aucun test, `node --test` ne voit pas `app/`.

- [ ] **Step 4: Vérifier à la main, serveur de développement lancé**

```bash
cd web && npm run dev
```

```bash
curl -sS http://localhost:3000/.well-known/oauth-authorization-server | python3 -m json.tool
curl -sS http://localhost:3000/.well-known/oauth-protected-resource | python3 -m json.tool
```

Attendu : deux documents JSON, `issuer`/`resource` sur `http://localhost:3000`.

- [ ] **Step 5: Commiter**

```bash
git add web/package.json web/package-lock.json web/app/.well-known
git commit -m "$(cat <<'EOF'
feat: mcp-handler, et les métadonnées OAuth du serveur d'autorisation

getPublicOrigin, exporté par mcp-handler, plutôt qu'une variable
d'environnement à poser et à tenir à jour si le domaine change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 5: `/mcp/authorize` — l'écran de consentement

**Files:**
- Create: `web/app/mcp/authorize/route.ts`

**Interfaces:**
- Consumes: `clientId`, `REDIRECT_URI`, `issueAuthCode` (Task 2), `getSessionEmail` de `@/auth`.
- Produces: `GET /mcp/authorize`, `POST /mcp/authorize`.

- [ ] **Step 1: Écrire la route**

Créer `web/app/mcp/authorize/route.ts` :

```ts
// L'écran de consentement d'un serveur d'autorisation qui ne vérifie
// l'identité de personne lui-même : il renvoie vers Google, déjà en place.
import { NextResponse } from "next/server";
import { getSessionEmail } from "@/auth";
import { clientId, issueAuthCode, REDIRECT_URI } from "@/lib/mcp-auth";

function fail(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  const table: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (c) => table[c]);
}

interface Params {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
}

function paramsOf(url: URL): Params {
  return {
    responseType: url.searchParams.get("response_type"),
    clientId: url.searchParams.get("client_id"),
    redirectUri: url.searchParams.get("redirect_uri"),
    state: url.searchParams.get("state"),
    codeChallenge: url.searchParams.get("code_challenge"),
    codeChallengeMethod: url.searchParams.get("code_challenge_method"),
  };
}

/** L'écran de consentement, et le renvoi vers Google s'il manque une
 *  session.
 *
 * Le client et l'adresse de retour sont vérifiés en premier, et sans
 * redirection : eux seuls ne peuvent pas suivre un renvoi d'erreur, sous
 * peine de faire de cette route un redirecteur ouvert. Les autres erreurs
 * reviennent chez l'appelant, qui sait quoi en faire. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = paramsOf(url);

  if (params.clientId !== clientId()) return fail("Unknown client_id.");
  if (params.redirectUri !== REDIRECT_URI) return fail("Unknown redirect_uri.");

  if (
    params.responseType !== "code" ||
    !params.codeChallenge ||
    params.codeChallengeMethod !== "S256"
  ) {
    const back = new URL(params.redirectUri);
    back.searchParams.set("error", "invalid_request");
    if (params.state) back.searchParams.set("state", params.state);
    return NextResponse.redirect(back);
  }

  const email = await getSessionEmail();
  if (!email) {
    const signin = new URL("/api/auth/signin", url.origin);
    signin.searchParams.set("callbackUrl", url.toString());
    return NextResponse.redirect(signin);
  }

  const hidden = [
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["state", params.state ?? ""],
    ["code_challenge", params.codeChallenge],
  ]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${name}" value="${escapeHtml(value ?? "")}">`,
    )
    .join("\n");

  return new Response(
    `<!doctype html>
<html>
<body style="font-family: system-ui; max-width: 32rem; margin: 4rem auto;">
  <h1>Connect evals-playground</h1>
  <p>Sign in as <strong>${escapeHtml(email)}</strong> to this MCP connector?</p>
  <form method="POST">
    ${hidden}
    <button type="submit">Allow</button>
  </form>
</body>
</html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** Le clic « Allow » : mine le code, renvoie vers `redirect_uri`. */
export async function POST(request: Request) {
  const form = await request.formData();
  const receivedClientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const state = String(form.get("state") ?? "");
  const codeChallenge = String(form.get("code_challenge") ?? "");

  if (receivedClientId !== clientId() || redirectUri !== REDIRECT_URI) {
    return fail("Unknown client_id or redirect_uri.");
  }

  const email = await getSessionEmail();
  if (!email) return fail("Not signed in.");

  const code = await issueAuthCode({ userEmail: email, redirectUri, codeChallenge });

  const back = new URL(redirectUri);
  back.searchParams.set("code", code);
  if (state) back.searchParams.set("state", state);
  return NextResponse.redirect(back);
}
```

- [ ] **Step 2: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 115 / fail 0`.

- [ ] **Step 3: Vérifier à la main, serveur de développement lancé**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  "http://localhost:3000/mcp/authorize?response_type=code&client_id=mauvais&redirect_uri=https://claude.ai/api/mcp/auth_callback&code_challenge=x&code_challenge_method=S256"
```

Attendu : `400` (client_id inconnu).

Avec le vrai `MCP_CLIENT_ID` du `.env` local et `LOCAL_AUTHENTICATION_NEEDED=false` (donc une session simulée) :

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  "http://localhost:3000/mcp/authorize?response_type=code&client_id=<MCP_CLIENT_ID>&redirect_uri=https://claude.ai/api/mcp/auth_callback&code_challenge=x&code_challenge_method=S256"
```

Attendu : `200`, un corps HTML avec le bouton « Allow ». Ce que ce `curl` ne vérifie pas : le renvoi vers Google sans session — `LOCAL_AUTHENTICATION_NEEDED=false` le court-circuite, comme pour toutes les autres routes de ce dépôt.

- [ ] **Step 4: Commiter**

```bash
git add web/app/mcp/authorize
git commit -m "$(cat <<'EOF'
feat: /mcp/authorize — le consentement, sans reparler à Google

client_id et redirect_uri sont vérifiés avant tout renvoi : eux seuls
ne peuvent pas suivre une redirection d'erreur, sous peine de faire de
cette route un redirecteur ouvert.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 6: `/mcp/token` — l'échange, et le rafraîchissement

**Files:**
- Create: `web/app/mcp/token/route.ts`

**Interfaces:**
- Consumes: `clientId`, `consumeAuthCode`, `issueTokenPair`, `rotateRefreshToken` (Task 2), `pkceMatches` (`mcp-crypto`).
- Produces: `POST /mcp/token`.

- [ ] **Step 1: Écrire la route**

Créer `web/app/mcp/token/route.ts` :

```ts
import { NextResponse } from "next/server";
import { pkceMatches } from "@/lib/mcp-crypto";
import { clientId, consumeAuthCode, issueTokenPair, rotateRefreshToken } from "@/lib/mcp-auth";

function oauthError(status: number, error: string, description?: string): Response {
  return NextResponse.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status },
  );
}

function tokenResponse(pair: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}) {
  return NextResponse.json({
    access_token: pair.accessToken,
    token_type: "Bearer",
    expires_in: pair.expiresIn,
    refresh_token: pair.refreshToken,
    scope: "evals",
  });
}

/** L'échange de code, et le rafraîchissement — les deux à la même adresse,
 *  distingués par `grant_type`, en `application/x-www-form-urlencoded` comme
 *  l'exige la RFC 6749 §4.1.3. `request.formData()` le lit nativement, ce
 *  format et `multipart/form-data` tous les deux. */
export async function POST(request: Request) {
  const form = await request.formData();
  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    const code = String(form.get("code") ?? "");
    const receivedClientId = String(form.get("client_id") ?? "");
    const redirectUri = String(form.get("redirect_uri") ?? "");
    const verifier = String(form.get("code_verifier") ?? "");

    if (receivedClientId !== clientId()) return oauthError(400, "invalid_client");

    const consumed = await consumeAuthCode(code);
    if (!consumed) return oauthError(400, "invalid_grant", "unknown or expired code");
    if (consumed.redirect_uri !== redirectUri) {
      return oauthError(400, "invalid_grant", "redirect_uri does not match");
    }
    if (!pkceMatches(verifier, consumed.code_challenge)) {
      return oauthError(400, "invalid_grant", "code_verifier does not match");
    }

    return tokenResponse(await issueTokenPair(consumed.user_email));
  }

  if (grantType === "refresh_token") {
    const refreshToken = String(form.get("refresh_token") ?? "");
    const pair = await rotateRefreshToken(refreshToken);
    if (!pair) return oauthError(400, "invalid_grant", "unknown or expired refresh token");
    return tokenResponse(pair);
  }

  return oauthError(400, "unsupported_grant_type");
}
```

- [ ] **Step 2: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 115 / fail 0`.

- [ ] **Step 3: Vérifier à la main la danse PKCE complète**

Serveur de développement lancé, `LOCAL_AUTHENTICATION_NEEDED=false` :

```bash
VERIFIER="dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
CHALLENGE="E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

# 1. Autoriser, récupérer le code depuis le Location de la redirection.
curl -sS -D - -o /dev/null \
  "http://localhost:3000/mcp/authorize" \
  --data-urlencode "client_id=<MCP_CLIENT_ID>" \
  --data-urlencode "redirect_uri=https://claude.ai/api/mcp/auth_callback" \
  --data-urlencode "state=xyz" \
  --data-urlencode "code_challenge=$CHALLENGE" \
  -X POST | grep -i location

# 2. Échanger le code (CODE copié de l'étape précédente) contre un couple de jetons.
curl -sS -X POST http://localhost:3000/mcp/token \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=<CODE>" \
  --data-urlencode "client_id=<MCP_CLIENT_ID>" \
  --data-urlencode "redirect_uri=https://claude.ai/api/mcp/auth_callback" \
  --data-urlencode "code_verifier=$VERIFIER"
```

Attendu à la seconde étape : `{"access_token":"…","token_type":"Bearer","expires_in":3600,"refresh_token":"…","scope":"evals"}`. Rejouer le même `code` une seconde fois doit rendre `{"error":"invalid_grant", ...}` — il a été consommé.

```bash
curl -sS -X POST http://localhost:3000/mcp/token \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=<REFRESH_TOKEN>"
```

Attendu : un nouveau couple. Rejouer l'ancien `refresh_token` doit rendre `invalid_grant` — il a tourné.

- [ ] **Step 4: Commiter**

```bash
git add web/app/mcp/token
git commit -m "$(cat <<'EOF'
feat: /mcp/token — échange de code et rotation du rafraîchissement

Content-Type x-www-form-urlencoded comme l'exige la RFC 6749, un code
ne sert qu'une fois, un jeton de rafraîchissement tourne à chaque
usage — l'ancien meurt dans le même appel qui en émet un nouveau.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 7: `/mcp` — le serveur MCP, avec `read_prompt` comme unique outil

**Files:**
- Modify: `web/lib/agent-prompt.ts` — `agentModels()`
- Modify: `web/app/prompt/route.ts` — utiliser `agentModels()`
- Create: `web/app/mcp/route.ts`

**Interfaces:**
- Consumes: `verifyAccessToken` (Task 2), `agentPrompt` et `agentModels` (`lib/agent-prompt.ts`), `getPublicOrigin` de `mcp-handler`.
- Produces: `GET /mcp`, `POST /mcp` — protocole MCP, outil `read_prompt`.

- [ ] **Step 1: Extraire `agentModels()`**

Dans `web/lib/agent-prompt.ts`, ajouter en tête l'import qui manque, et la fonction avant `agentPrompt` :

```ts
import { catalog } from "./catalog";
```

```ts
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
```

- [ ] **Step 2: Faire utiliser `agentModels()` par `/prompt`**

Dans `web/app/prompt/route.ts`, remplacer :

```ts
import { agentPrompt } from "@/lib/agent-prompt";
import { catalog } from "@/lib/catalog";
```

par :

```ts
import { agentModels, agentPrompt } from "@/lib/agent-prompt";
```

et le corps de `GET` :

```ts
export async function GET(request: Request) {
  return new Response(agentPrompt(agentModels(), originOf(request)), {
```

(le reste de la fonction, headers compris, ne change pas — seule la ligne qui construisait `models` disparaît).

- [ ] **Step 3: Écrire le serveur MCP**

Créer `web/app/mcp/route.ts` :

```ts
// Le serveur MCP. Un outil pour l'instant : read_prompt, qui ne fait que
// rejouer /prompt — la preuve que la chaîne OAuth marche de bout en bout
// avant d'y ajouter ce qui touche vraiment aux runs.
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { agentModels, agentPrompt } from "@/lib/agent-prompt";
import { verifyAccessToken } from "@/lib/mcp-auth";

const handler = createMcpHandler((server) => {
  server.registerTool(
    "read_prompt",
    {
      title: "Read the run-writing prompt",
      description:
        "The instructions for writing an evals-playground run as YAML — the same document served at /prompt.",
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      // `ctx.http.req` : la requête d'origine, vérifiée dans
      // @modelcontextprotocol/server. `agentPrompt` accepte une origine vide
      // — elle écrit alors /validate en relatif, ce qu'un agent qui vient de
      // lire cette page résout de lui-même.
      const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : "";
      return { content: [{ type: "text", text: agentPrompt(agentModels(), origin) }] };
    },
  );
}, {});

async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const email = await verifyAccessToken(bearerToken);
  if (!email) return undefined;
  return { token: bearerToken, scopes: ["evals"], clientId: "evals-playground", extra: { email } };
}

const authed = withMcpAuth(handler, verifyToken, {
  required: true,
  requiredScopes: ["evals"],
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authed as GET, authed as POST };
```

- [ ] **Step 4: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 115 / fail 0`. Si `tsc` proteste sur la forme exacte de `AuthInfo` ou sur les options de `withMcpAuth`, ouvrir `node_modules/@modelcontextprotocol/server/dist/**/*.d.ts` et `node_modules/mcp-handler/dist/**/*.d.ts` pour ajuster les noms de champs à ce que la version installée déclare réellement — ce plan a été écrit contre `mcp-handler@2.1.1` et `@modelcontextprotocol/server@2.0.0`, mais seule la source installée fait foi.

- [ ] **Step 5: Vérifier à la main : le 401 sans jeton**

```bash
curl -sS -D - -o /dev/null -X POST http://localhost:3000/mcp \
  -H 'content-type: application/json' -d '{}'
```

Attendu : `401`, et un en-tête `WWW-Authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"`.

- [ ] **Step 6: Vérifier à la main : l'outil, avec un vrai jeton**

Avec un `access_token` obtenu à la Task 6 :

```bash
curl -sS -X POST http://localhost:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "authorization: Bearer <ACCESS_TOKEN>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_prompt","arguments":{}}}'
```

Attendu : une réponse JSON-RPC dont `result.content[0].text` commence par « I need you to write the configuration ».

- [ ] **Step 7: Commiter**

```bash
git add web/lib/agent-prompt.ts web/app/prompt/route.ts web/app/mcp/route.ts
git commit -m "$(cat <<'EOF'
feat: le serveur MCP, avec read_prompt comme unique outil

La preuve de bout en bout avant le reste : OAuth, le jeton porteur, le
401 avec WWW-Authenticate. agentModels() sort de /prompt pour être
partagé avec l'outil, plutôt que dupliqué.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 8: La page des connexions, et leur révocation

**Files:**
- Create: `web/app/api/mcp/connections/route.ts`
- Modify: `web/lib/api.ts` — `listMcpConnections`, `revokeMcpConnection`
- Create: `web/app/settings/connections/page.tsx`

**Interfaces:**
- Consumes: `listGrants`, `revokeGrant` (Task 2), `requireUser` de `@/auth`.
- Produces: `GET /api/mcp/connections`, `DELETE /api/mcp/connections`, la page `/settings/connections`.

- [ ] **Step 1: Écrire la route**

Créer `web/app/api/mcp/connections/route.ts` :

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { listGrants, revokeGrant } from "@/lib/mcp-auth";

export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;
  return NextResponse.json(await listGrants(user.email));
}

/** Révoque une connexion. Le propriétaire vient de la session, jamais du
 *  corps : sans quoi n'importe quel email connecté pourrait couper celle
 *  d'un autre en devinant son empreinte. */
export async function DELETE(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as {
    access_token_hash?: string;
  } | null;
  if (!body?.access_token_hash) {
    return NextResponse.json({ error: "access_token_hash is required" }, { status: 422 });
  }
  await revokeGrant(body.access_token_hash, user.email);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Ajouter les appels côté client**

Dans `web/lib/api.ts`, à la fin :

```ts
export interface McpGrant {
  access_token_hash: string;
  user_email: string;
  created_at: string;
  refresh_expires_at: string;
}

export const listMcpConnections = () => request<McpGrant[]>("/api/mcp/connections");

export const revokeMcpConnection = (accessTokenHash: string) =>
  request<{ ok: true }>("/api/mcp/connections", {
    method: "DELETE",
    body: JSON.stringify({ access_token_hash: accessTokenHash }),
  });
```

- [ ] **Step 3: Écrire la page**

Créer `web/app/settings/connections/page.tsx` :

```tsx
"use client";

import { useEffect, useState } from "react";
import { listMcpConnections, revokeMcpConnection, type McpGrant } from "@/lib/api";

export default function ConnectionsPage() {
  const [grants, setGrants] = useState<McpGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMcpConnections()
      .then(setGrants)
      .catch((e) => setError((e as Error).message));
  }, []);

  async function revoke(hash: string) {
    await revokeMcpConnection(hash);
    setGrants((current) => current?.filter((g) => g.access_token_hash !== hash) ?? null);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">MCP connections</h1>
        <p className="text-sm text-zinc-500">
          Connectors that can read this workspace on your behalf.
        </p>
      </header>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {grants?.length === 0 && (
        <p className="text-sm text-zinc-500">No active connection.</p>
      )}
      <ul className="space-y-2">
        {grants?.map((grant) => (
          <li
            key={grant.access_token_hash}
            className="flex items-center justify-between rounded border p-3 text-sm"
          >
            <div>
              <p>{grant.user_email}</p>
              <p className="text-zinc-500">
                Connected {new Date(grant.created_at).toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => revoke(grant.access_token_hash)}
              className="rounded border px-3 py-1 text-red-700"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Vérifier**

```bash
cd web && npx tsc --noEmit && npx eslint "app/settings/connections/page.tsx" "app/api/mcp/connections/route.ts" && npm test
```

Attendu : aucune sortie, `pass 115 / fail 0`.

- [ ] **Step 5: Vérifier à l'œil**

Serveur de développement lancé, session simulée, une connexion créée à la Task 6 : ouvrir `http://localhost:3000/settings/connections`, voir la ligne, cliquer Revoke, la voir disparaître. Rejouer l'outil `read_prompt` avec le jeton révoqué (Task 7, Step 6) : `401`.

- [ ] **Step 6: Commiter**

```bash
git add web/app/api/mcp/connections web/lib/api.ts web/app/settings
git commit -m "$(cat <<'EOF'
feat: la page des connexions MCP, et leur révocation

Couper l'accès ne doit pas dépendre de claude.ai de l'autre côté. Le
propriétaire d'une connexion vient de la session, jamais du corps de
la requête.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 9: Se connecter depuis claude.ai, pour de vrai

Pas de code : cette tâche vérifie que la chaîne entière marche depuis le vrai client, pas seulement au `curl`. Elle demande un déploiement joignable depuis l'extérieur (Vercel preview ou production) — `claude.ai` ne peut pas atteindre `localhost`.

- [ ] **Step 1: Déployer, et poser les variables d'environnement**

Sur Vercel : `MCP_CLIENT_ID` (une chaîne au choix, par exemple générée avec `openssl rand -hex 16`), et vérifier que `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`/`AUTH_SECRET`/`ALLOWED_EMAILS` ou `ALLOWED_DOMAINS` sont déjà posées.

- [ ] **Step 2: Ajouter le connecteur dans claude.ai**

Réglages → Connectors → Add custom connector. URL : `https://<domaine>/mcp`. Authentication : *Always required*. OAuth client : *Use your own OAuth client*, `client_id` = la valeur de `MCP_CLIENT_ID`, secret laissé vide.

- [ ] **Step 3: Se connecter**

Cliquer *Connect* : attendu, un renvoi vers l'écran Google déjà connu de l'application, puis l'écran « Connect evals-playground » de la Task 5, puis retour à claude.ai, connecté.

- [ ] **Step 4: Appeler l'outil depuis une conversation**

Dans une conversation Claude, avec le connecteur activé : « Read the evals-playground prompt. » Attendu : le même texte que `/prompt`, cité par l'agent.

- [ ] **Step 5: Vérifier la révocation en bout en bout**

Depuis `/settings/connections`, révoquer la connexion. Reposer la même question dans la conversation : attendu, claude.ai retente une connexion — la révocation s'est propagée jusqu'au premier appel suivant, pas avant (`verifyAccessToken` porte sur `mcp_tokens`, sans mise en cache).

Rien à commiter pour cette tâche.

---

# Phase 2 — Les trois outils de lecture

## Task 10: `lib/run-id.ts`, partagé avec la page publique

**Files:**
- Create: `web/lib/run-id.ts`
- Create: `web/lib/run-id.test.mts`
- Modify: `web/app/shared/[runId]/page.tsx` — utiliser `isRunId`

**Interfaces:**
- Consumes: rien.
- Produces: `RUN_ID: RegExp`, `isRunId(value: string): boolean`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `web/lib/run-id.test.mts` :

```ts
// La forme d'un identifiant de run, partagée par la page publique et les
// outils MCP : deux copies de cette expression auraient fini par diverger.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRunId } from "./run-id.ts";

test("un UUID v4 passe", () => {
  assert.equal(isRunId("2f1c9e6a-0000-4000-8000-000000000000"), true);
});

test("ce qui n'a pas cette forme est refusé", () => {
  for (const value of ["", "not-a-uuid", "2f1c9e6a-0000-4000-8000-00000000000"]) {
    assert.equal(isRunId(value), false, value);
  }
});
```

- [ ] **Step 2: Voir le test échouer**

```bash
cd web && node --test "lib/run-id.test.mts"
```

Attendu : `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Écrire le module**

Créer `web/lib/run-id.ts` :

```ts
/** La forme d'un identifiant de run — un UUID, sans plus de garantie. Une
 *  adresse qui n'a pas cette forme n'est un run pour personne : autant le
 *  dire tout de suite plutôt que de laisser Postgres refuser un `uuid` mal
 *  formé et remonter en 500. */
export const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRunId(value: string): boolean {
  return RUN_ID.test(value);
}
```

- [ ] **Step 4: Voir les deux tests passer**

```bash
cd web && node --test "lib/run-id.test.mts"
```

Attendu : `pass 2 / fail 0`.

- [ ] **Step 5: Faire utiliser le module par la page publique**

Dans `web/app/shared/[runId]/page.tsx`, remplacer la déclaration locale :

```ts
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

par :

```ts
import { isRunId } from "@/lib/run-id";
```

(retirer aussi le commentaire qui précédait la constante, devenu celui de `run-id.ts`) et son usage :

```ts
  if (!RUN_ID.test(runId)) notFound();
```

devient :

```ts
  if (!isRunId(runId)) notFound();
```

- [ ] **Step 6: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 117 / fail 0`.

- [ ] **Step 7: Commiter**

```bash
git add web/lib/run-id.ts web/lib/run-id.test.mts web/app/shared
git commit -m "$(cat <<'EOF'
feat: la forme d'un identifiant de run, partagée

Extrait de la page publique : les outils MCP en ont besoin aussi, et
deux copies de la même expression auraient fini par diverger.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 11: `loadSampleTranscript` — une seule conversation

**Files:**
- Modify: `web/lib/runs.ts` — ajouter `loadSampleTranscript`

**Interfaces:**
- Consumes: `SAMPLES`, `select` de `@/lib/supabase`, `NotFound`.
- Produces: `loadSampleTranscript(runId, scenarioIndex, targetModel, repetition): Promise<EvalSample>`.

- [ ] **Step 1: Ajouter la fonction**

À la fin de `web/lib/runs.ts` :

```ts
/** Une seule conversation, sans charger le reste du run — un run porte des
 *  dizaines de cases, et les ramener toutes pour n'en rendre qu'une serait le
 *  genre de coût caché qui ne se voit qu'en production.
 *
 * Throws:
 *   NotFound: si aucune case ne porte ce triplet, dans ce run.
 */
export async function loadSampleTranscript(
  runId: string,
  scenarioIndex: number,
  targetModel: string,
  repetition: number,
): Promise<EvalSample> {
  const rows = await select<EvalSample>(SAMPLES, {
    run_id: `eq.${runId}`,
    scenario_index: `eq.${scenarioIndex}`,
    target_model: `eq.${targetModel}`,
    repetition: `eq.${repetition}`,
    select: "*",
    limit: 1,
  });
  const sample = rows[0];
  if (!sample) {
    throw new NotFound(
      `Unknown sample: run ${runId}, scenario ${scenarioIndex}, ${targetModel}, repetition ${repetition}`,
    );
  }
  sample.messages ??= [];
  sample.usage ??= {};
  return sample;
}
```

- [ ] **Step 2: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 117 / fail 0` — cette fonction touche Supabase, `node --test` ne la voit pas ; elle se vérifie à la Task 13, quand l'outil qui l'appelle existe.

- [ ] **Step 3: Commiter**

```bash
git add web/lib/runs.ts
git commit -m "$(cat <<'EOF'
feat: loadSampleTranscript, une case sans charger le run entier

Pour l'outil MCP qui rendra une trajectoire : jamais tout un run d'un
coup, jamais plus qu'une conversation à la fois.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 12: `get_run_metadata` et `get_run_results`

**Files:**
- Modify: `web/app/mcp/route.ts` — deux outils de plus

**Interfaces:**
- Consumes: `loadRun`, `NotFound` de `@/lib/runs`, `cellsOf`/`overallMean` de `@/lib/matrix`, `isRunId` (Task 10).
- Produces: outils MCP `get_run_metadata`, `get_run_results`.

- [ ] **Step 1: Étendre les imports**

Dans `web/app/mcp/route.ts` :

```ts
import { NotFound, loadRun } from "@/lib/runs";
import { cellsOf, overallMean } from "@/lib/matrix";
import { isRunId } from "@/lib/run-id";
```

- [ ] **Step 2: Ajouter les deux outils**

Dans le corps de `createMcpHandler`, après `read_prompt` :

```ts
  server.registerTool(
    "get_run_metadata",
    {
      title: "Get run metadata",
      description:
        "Label, status, cost, models, notes and analysis for one run — no results, no transcripts.",
      inputSchema: z.object({ run_id: z.string().describe("The run's UUID.") }),
    },
    async ({ run_id }) => {
      if (!isRunId(run_id)) {
        return { content: [{ type: "text", text: `Not a run id: ${run_id}` }], isError: true };
      }
      let run;
      try {
        run = (await loadRun(run_id, { withTranscripts: false, withSourceCsvFlag: false })).run;
      } catch (error) {
        if (error instanceof NotFound) {
          return { content: [{ type: "text", text: error.message }], isError: true };
        }
        throw error;
      }
      const metadata = {
        id: run.id,
        label: run.label,
        status: run.status,
        user_email: run.user_email,
        created_at: run.created_at,
        started_at: run.started_at,
        finished_at: run.finished_at,
        is_public: run.is_public,
        notes: run.notes,
        analysis: run.analysis,
        total_samples: run.total_samples,
        cost_usd: run.cost_usd,
        criterion: run.config.criterion,
        rubric: run.config.rubric,
        models: run.config.models,
        scenario_count: run.config.scenarios.length,
      };
      return { content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }] };
    },
  );

  server.registerTool(
    "get_run_results",
    {
      title: "Get run results",
      description:
        "The matrix: mean grade per scenario × model, judged/errored/pending counts and cost — no transcripts.",
      inputSchema: z.object({ run_id: z.string().describe("The run's UUID.") }),
    },
    async ({ run_id }) => {
      if (!isRunId(run_id)) {
        return { content: [{ type: "text", text: `Not a run id: ${run_id}` }], isError: true };
      }
      let detail;
      try {
        detail = await loadRun(run_id, { withTranscripts: false, withSourceCsvFlag: false });
      } catch (error) {
        if (error instanceof NotFound) {
          return { content: [{ type: "text", text: error.message }], isError: true };
        }
        throw error;
      }
      const { run, samples } = detail;
      const cells = cellsOf(samples, run.config.scenarios.length, run.config.rubric);
      const results = {
        overall_mean: overallMean(samples, run.config.rubric),
        scenarios: run.config.scenarios.map((scenario, index) => ({
          title: scenario.title,
          by_model: run.config.models.targets.map((model) => {
            const cell = cells[index]?.[model];
            return {
              model,
              mean: cell?.mean ?? null,
              judged: cell?.judged ?? 0,
              errored: cell?.errored ?? 0,
              pending: cell?.pending ?? 0,
              cost_usd: cell?.cost_usd ?? 0,
            };
          }),
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );
```

- [ ] **Step 3: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 117 / fail 0`.

- [ ] **Step 4: Vérifier à la main**

Avec un jeton valide et l'identifiant d'un run existant, comme à la Task 7 Step 6, mais `"name":"get_run_metadata"` puis `"get_run_results"`, `"arguments":{"run_id":"<UUID>"}`. Attendu : le JSON du run, puis la matrice. Rejouer avec un `run_id` inconnu : `isError: true`, le message de `NotFound`.

- [ ] **Step 5: Commiter**

```bash
git add web/app/mcp/route.ts
git commit -m "$(cat <<'EOF'
feat: get_run_metadata et get_run_results

L'agent peut désormais lire un run privé — pas seulement publié,
puisqu'il est authentifié comme n'importe quel utilisateur allowlisté.
La matrice reprend cellsOf, la même fonction que la page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 13: `get_run_trajectory`

**Files:**
- Modify: `web/app/mcp/route.ts` — un outil de plus

**Interfaces:**
- Consumes: `loadSampleTranscript` (Task 11).
- Produces: outil MCP `get_run_trajectory`.

- [ ] **Step 1: Étendre l'import**

```ts
import { NotFound, loadRun, loadSampleTranscript } from "@/lib/runs";
```

- [ ] **Step 2: Ajouter l'outil**

```ts
  server.registerTool(
    "get_run_trajectory",
    {
      title: "Get one conversation",
      description:
        "The full transcript of one cell — one scenario × model × repetition — including the judge's grade and justification.",
      inputSchema: z.object({
        run_id: z.string().describe("The run's UUID."),
        scenario_index: z.number().int().min(0).describe("0-based, in scenario order."),
        target_model: z.string(),
        repetition: z.number().int().min(0).describe("0-based."),
      }),
    },
    async ({ run_id, scenario_index, target_model, repetition }) => {
      if (!isRunId(run_id)) {
        return { content: [{ type: "text", text: `Not a run id: ${run_id}` }], isError: true };
      }
      let sample;
      try {
        sample = await loadSampleTranscript(run_id, scenario_index, target_model, repetition);
      } catch (error) {
        if (error instanceof NotFound) {
          return { content: [{ type: "text", text: error.message }], isError: true };
        }
        throw error;
      }
      const trajectory = {
        scenario_title: sample.scenario_title,
        target_model: sample.target_model,
        repetition: sample.repetition,
        status: sample.status,
        score: sample.score,
        justification: sample.justification,
        error: sample.error,
        messages: sample.messages,
      };
      return { content: [{ type: "text", text: JSON.stringify(trajectory, null, 2) }] };
    },
  );
```

- [ ] **Step 3: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 117 / fail 0`.

- [ ] **Step 4: Vérifier à la main**

`"name":"get_run_trajectory"`, `"arguments":{"run_id":"<UUID>","scenario_index":0,"target_model":"<un modèle du run>","repetition":0}`. Attendu : la conversation complète, `messages` compris. Avec une `repetition` hors bornes : `isError: true`.

- [ ] **Step 5: Commiter**

```bash
git add web/app/mcp/route.ts
git commit -m "$(cat <<'EOF'
feat: get_run_trajectory

Une seule conversation par appel — jamais tout le run d'un coup,
jusqu'à ce que l'agent choisisse ce qu'il charge.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

# Phase 3 — Le brouillon

## Task 14: La table `eval_run_drafts`

**Files:**
- Create: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/migrations/<horodatage>_create_eval_run_drafts.sql`
- Modify: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/schema.sql`

**Interfaces:**
- Consumes: rien.
- Produces: `public.eval_run_drafts`, `public.sweep_stale_eval_run_drafts()`.

- [ ] **Step 1: Créer le fichier de migration**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals
supabase migration new create_eval_run_drafts
```

- [ ] **Step 2: Écrire le SQL**

```sql
-- evals-playground : un run soumis en YAML, sauvegardé sans être lancé.
--
-- eval_runs n'a pas d'état « pas encore lancé » — une ligne qui existe a déjà
-- triggered. Un brouillon est donc un objet différent, pas un run au repos.
create table public.eval_run_drafts (
  id         uuid primary key default gen_random_uuid(),
  config     jsonb not null,
  csv_text   text,
  created_by text not null,
  created_at timestamptz not null default now()
);

grant select, insert, delete on public.eval_run_drafts to service_role;

-- Un brouillon jamais lancé après sept jours n'a plus grand-chose à dire :
-- sans ce balai, un agent qui essaie plusieurs formulations avant de trouver
-- la bonne laisserait des déchets permanents.
create or replace function public.sweep_stale_eval_run_drafts(
  max_age interval default interval '7 days'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from eval_run_drafts where created_at < now() - max_age;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

grant execute on function public.sweep_stale_eval_run_drafts(interval) to service_role;
```

- [ ] **Step 3: Voir ce qui serait appliqué, puis appliquer**

```bash
supabase db push --dry-run
supabase db push
supabase db dump --linked -f supabase/schema.sql
```

- [ ] **Step 4: Commiter et ouvrir la PR**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase
git checkout -b eval-run-drafts
git add evals/supabase/migrations evals/supabase/schema.sql
git commit -m "$(cat <<'EOF'
feat(evals): eval_run_drafts, un run soumis sans être lancé

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
git push -u origin eval-run-drafts
gh pr create --fill
```

Attendu : la PR est **fusionnée** avant la Task 15.

---

## Task 15: `lib/drafts.ts`

**Files:**
- Create: `web/lib/drafts.ts`
- Modify: `web/lib/supabase.ts` — `DRAFTS`

**Interfaces:**
- Consumes: `eval_run_drafts` (Task 14), `insert`/`select`/`remove`/`rpc` de `@/lib/supabase`.
- Produces: `createDraft()`, `loadDraft()`, `deleteDraft()`, `DraftNotFound`.

- [ ] **Step 1: Ajouter la constante de table**

Dans `web/lib/supabase.ts`, à côté de `RUNS`/`SAMPLES` :

```ts
export const DRAFTS = "eval_run_drafts";
```

- [ ] **Step 2: Écrire le module**

Créer `web/lib/drafts.ts` :

```ts
// Un run soumis en YAML par l'outil MCP submit_draft_run, sauvegardé sans
// être lancé — le geste de lancer reste un clic humain, sur la page que
// createDraft rend adressable.
import "server-only";
import { DRAFTS, insert, remove, rpc, select } from "./supabase";
import type { EvalRunConfig } from "./types";

export class DraftNotFound extends Error {}

export interface Draft {
  id: string;
  config: EvalRunConfig;
  csv_text: string | null;
  created_by: string;
  created_at: string;
}

export async function createDraft(
  config: EvalRunConfig,
  csvText: string | null,
  createdBy: string,
): Promise<string> {
  const rows = await insert<Draft>(
    DRAFTS,
    { config, csv_text: csvText, created_by: createdBy },
    { returning: true },
  );
  return rows[0].id;
}

let lastSweep = 0;

/** Efface les brouillons oubliés avant toute lecture — même patron que
 *  `failStaleRuns`, avec un intervalle plus large : un brouillon abandonné
 *  n'est pas urgent à ramasser. */
async function sweepStaleDrafts(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 5 * 60 * 1000) return;
  lastSweep = now;
  try {
    await rpc("sweep_stale_eval_run_drafts");
  } catch (error) {
    console.error("sweep_stale_eval_run_drafts:", (error as Error).message);
  }
}

/** Throws: DraftNotFound si aucun brouillon ne porte cet identifiant. */
export async function loadDraft(id: string): Promise<Draft> {
  await sweepStaleDrafts();
  const rows = await select<Draft>(DRAFTS, { id: `eq.${id}`, select: "*", limit: 1 });
  const draft = rows[0];
  if (!draft) throw new DraftNotFound(`Unknown draft: ${id}`);
  return draft;
}

export async function deleteDraft(id: string): Promise<void> {
  await remove(DRAFTS, { id: `eq.${id}` });
}
```

- [ ] **Step 3: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 117 / fail 0` — ce module touche Supabase, vérifié à la main aux tâches suivantes.

- [ ] **Step 4: Commiter**

```bash
git add web/lib/supabase.ts web/lib/drafts.ts
git commit -m "$(cat <<'EOF'
feat: lib/drafts.ts — sauvegarder un run sans le lancer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 16: `submit_draft_run`

**Files:**
- Modify: `web/app/mcp/route.ts` — un outil de plus

**Interfaces:**
- Consumes: `verdictOf` de `@/lib/verdict`, `costSentence` de `@/lib/pricing`, `readConfigFile` de `@/lib/config-file`, `createDraft` (Task 15), `getPublicOrigin` de `mcp-handler`.
- Produces: outil MCP `submit_draft_run`.

- [ ] **Step 1: Étendre les imports**

```ts
import { verdictOf } from "@/lib/verdict";
import { costSentence } from "@/lib/pricing";
import { readConfigFile } from "@/lib/config-file";
import { createDraft } from "@/lib/drafts";
```

- [ ] **Step 2: Une fonction pour lire l'email de l'appelant**

Dans `web/app/mcp/route.ts`, avant `createMcpHandler`. La Task 7 a déjà posé l'email dans `extra` (`return { ..., extra: { email } }`, dans `verifyToken`) — cette fonction ne fait que le relire :

```ts
/** L'email posé par `verifyToken` dans `extra`. `unknown` s'il manque, ce qui
 *  ne devrait arriver que si `withMcpAuth` change de forme. */
function callerEmail(ctx: { http?: { authInfo?: AuthInfo } }): string {
  const email = ctx.http?.authInfo?.extra?.email;
  return typeof email === "string" ? email : "unknown";
}
```

- [ ] **Step 3: Ajouter l'outil**

```ts
  server.registerTool(
    "submit_draft_run",
    {
      title: "Submit a run as a draft",
      description:
        "Validates a run written as YAML (same rules as /validate) and saves it as a draft a human reviews and launches. Never starts the run.",
      inputSchema: z.object({
        yaml: z.string().describe("The run, as a YAML document — see read_prompt."),
      }),
    },
    async ({ yaml }, ctx) => {
      const verdict = verdictOf(yaml, costSentence);
      if (verdict.status !== 200 || verdict.message.startsWith("INCOMPLETE")) {
        // INCOMPLETE annonce un CSV que ce canal ne sait pas porter — un
        // agent écrit les scénarios en clair, comme le prompt le demande.
        return { content: [{ type: "text", text: verdict.message }], isError: true };
      }
      const { config } = readConfigFile(yaml);
      const draftId = await createDraft(config, null, callerEmail(ctx));
      const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : "";
      return {
        content: [{ type: "text", text: `${verdict.message}\n\n${origin}/runs/drafts/${draftId}` }],
      };
    },
  );
```

Et l'import, avec les autres en tête de `web/app/mcp/route.ts` — `getPublicOrigin` y est déjà (Task 7) ; s'assurer qu'il figure bien dans l'import groupé de `mcp-handler`.

- [ ] **Step 4: Vérifier**

```bash
cd web && npx tsc --noEmit && npm test
```

Attendu : `pass 117 / fail 0`.

- [ ] **Step 5: Vérifier à la main**

`"name":"submit_draft_run"`, `"arguments":{"yaml":"<un document valide, deux scénarios>"}`. Attendu : le verdict `OK — …` suivi d'une URL `/runs/drafts/<uuid>`. Avec un document invalide (`rubric` absente, par exemple) : `isError: true`, le message de refus de `/validate`.

- [ ] **Step 6: Commiter**

```bash
git add web/app/mcp/route.ts
git commit -m "$(cat <<'EOF'
feat: submit_draft_run

Valide comme /validate, avant d'écrire quoi que ce soit — un YAML
refusé ne touche jamais la base.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Task 17: La page d'un brouillon, et son lancement

**Files:**
- Create: `web/app/runs/drafts/[draftId]/page.tsx`
- Create: `web/components/LaunchDraftButton.tsx`
- Create: `web/app/api/runs/drafts/[draftId]/launch/route.ts`

**Interfaces:**
- Consumes: `loadDraft`, `deleteDraft`, `DraftNotFound` (Task 15), `configProblem` de `@/lib/validate`, `createRun`/`recordStart`/`failToStart` de `@/lib/runs`, `startJob` de `@/lib/trigger`, `requireUser` de `@/auth`, `costSentence` de `@/lib/pricing`.
- Produces: la page `/runs/drafts/<id>`, `POST /api/runs/drafts/<id>/launch`.

- [ ] **Step 1: Écrire la route de lancement**

Créer `web/app/api/runs/drafts/[draftId]/launch/route.ts` :

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { DraftNotFound, deleteDraft, loadDraft } from "@/lib/drafts";
import { createRun, failToStart, recordStart } from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { configProblem } from "@/lib/validate";

/** Lance un brouillon : le même chemin que `POST /api/runs`, config et auteur
 *  près, mais tirés du brouillon plutôt que du corps de la requête. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  let draft;
  try {
    draft = await loadDraft(draftId);
  } catch (error) {
    if (error instanceof DraftNotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  const problem = configProblem(draft.config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  const run = await createRun(draft.config, user.email, draft.csv_text);
  try {
    await recordStart(run.id, await startJob(run.id, "run"));
  } catch (error) {
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(run.id, reason);
    return NextResponse.json({ run_id: run.id, error: reason }, { status: 502 });
  }
  await deleteDraft(draftId);
  return NextResponse.json({ run_id: run.id }, { status: 201 });
}
```

- [ ] **Step 2: Écrire le bouton**

Créer `web/components/LaunchDraftButton.tsx` :

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LaunchDraftButton({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function launch() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/runs/drafts/${draftId}/launch`, { method: "POST" });
    const body = (await response.json()) as { run_id?: string; error?: string };
    if (!response.ok) {
      setError(body.error ?? `HTTP ${response.status}`);
      setPending(false);
      return;
    }
    router.push(`/eval/${body.run_id}`);
  }

  return (
    <div className="space-y-2">
      <button
        onClick={launch}
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Launching…" : "Launch"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Écrire la page**

Créer `web/app/runs/drafts/[draftId]/page.tsx` :

```tsx
// Un run soumis par un agent, pas encore lancé. Lecture seule à part le
// bouton Launch : aucun autre chemin d'écriture n'existe ici.
import { notFound } from "next/navigation";
import { DraftNotFound, loadDraft } from "@/lib/drafts";
import { costSentence } from "@/lib/pricing";
import { LaunchDraftButton } from "@/components/LaunchDraftButton";

export default async function DraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;

  let draft;
  try {
    draft = await loadDraft(draftId);
  } catch (error) {
    if (error instanceof DraftNotFound) notFound();
    throw error;
  }

  const price = costSentence(draft.config);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          Draft — not yet launched
        </p>
        <h1 className="text-2xl font-semibold">
          {draft.config.label || "Untitled run"}
        </h1>
        <p className="text-sm text-zinc-500">
          Submitted by {draft.created_by} ·{" "}
          {new Date(draft.created_at).toLocaleString()}
        </p>
        {price && <p className="text-sm text-zinc-500">{price}</p>}
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">What the judge was asked</h2>
        <p className="text-sm">{draft.config.criterion}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Scenarios</h2>
        <p className="text-sm text-zinc-600">
          {draft.config.scenarios.length} scenario
          {draft.config.scenarios.length > 1 ? "s" : ""} ×{" "}
          {draft.config.models.targets.length} model
          {draft.config.models.targets.length > 1 ? "s" : ""}
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {draft.config.scenarios.map((scenario, index) => (
            <li key={scenario.title + index}>{scenario.title}</li>
          ))}
        </ul>
      </section>

      <LaunchDraftButton draftId={draft.id} />
    </main>
  );
}
```

- [ ] **Step 4: Vérifier**

```bash
cd web && npx tsc --noEmit && npx eslint "app/runs/drafts/[draftId]/page.tsx" "components/LaunchDraftButton.tsx" "app/api/runs/drafts/[draftId]/launch/route.ts" && npm test
```

Attendu : aucune sortie, `pass 117 / fail 0`.

- [ ] **Step 5: Vérifier à l'œil, de bout en bout**

Serveur de développement lancé : soumettre un brouillon via l'outil MCP (Task 16), ouvrir l'URL rendue, lire le résumé et le devis, cliquer *Launch*. Attendu : redirection vers `/eval/<run_id>`, le run démarre. Recharger l'ancienne URL du brouillon : `404` — il a été effacé au lancement.

- [ ] **Step 6: Commiter**

```bash
git add web/app/runs/drafts web/components/LaunchDraftButton.tsx web/app/api/runs/drafts
git commit -m "$(cat <<'EOF'
feat: la page d'un brouillon, et son lancement

Le clic reste humain : la route de lancement reprend exactement le
chemin de POST /api/runs, config et auteur près, tirés du brouillon.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
EOF
)"
```

---

## Ce que ce plan ne fait pas

Pas d'outil pour lancer un run depuis l'agent — confirmé dans le dessin. Pas d'outil pour lister les runs, ni pour supprimer un brouillon depuis l'agent. Pas de rafraîchissement de jeton géré à la main côté client : le SDK MCP de claude.ai s'en charge, `/mcp/token` n'a qu'à répondre correctement à `grant_type=refresh_token`.

Chacun de ces manques est un choix du dessin, et rien ici n'est à défaire pour les construire plus tard.

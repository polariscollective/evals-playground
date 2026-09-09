# Deploying

Three pieces, three places. None of it is automatic the first time; afterwards,
everything starts from a push to `main`.

## The application — Vercel

The repository connects as it stands. Three settings that cannot be guessed:

| setting | value | why |
|---|---|---|
| Root Directory | `web` | the Next.js application is not at the root |
| Framework Preset | **Next.js** | worth checking: as long as the Root Directory is the root, Vercel sees `pyproject.toml` and offers a Python preset |
| Include source files outside of the Root Directory | **ticked** | `shared/` is at the root, read by the interface *and* by the job |

Set the Root Directory to `web` first: the detection is then redone on that
folder, finds `next` in `package.json` there, and the right preset offers itself.

Without the second, the build fails: `web/lib/shared.ts` reads
`shared/pricing.json` and the judge prompt's templates by relative path, outside
`web/`. Those files are shared with the Python, and copying them into `web/`
would be exactly what one is trying to avoid.

### The environment variables

```
SUPABASE_URL                   https://hkqzamibfpyvlowiqgpn.supabase.co
SUPABASE_SERVICE_ROLE_KEY      the service key of the "evals" project
BATCH_TRIGGER_URL              https://polaris-batch-trigger-…-ew.a.run.app
BATCH_TRIGGER_SECRET    the evals-playground secret (see below)
AUTH_GOOGLE_ID                 Google OAuth client
AUTH_GOOGLE_SECRET
AUTH_SECRET                    openssl rand -base64 32
ALLOWED_EMAILS                 allowed addresses, comma separated
ALLOWED_DOMAINS                allowed domains, likewise
MCP_CLIENT_ID                  openssl rand -hex 16 — see "The MCP connector"
```

The two caps of `launch_draft` (a run's quote taken alone, and what one same MCP
caller has launched over the sliding hour) are no longer environment variables:
they live in the `profiles` table, one row per person, defaults of $2 and $10 laid
down by the migration. Nothing to set here.

**No provider key.** No route calls a model: the quote is arithmetic, the prompt
preview is formatting, the rest is reading. What costs money lives in the job
alone.

The trigger's secret is read back from Secret Manager:

```bash
gcloud secrets versions access latest --secret=BATCH_TRIGGER_CALLERS \
  --project=polaris-dev-499211 \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['evals-playground']['secret'])"
```

### Google OAuth

The redirect URI to declare: `https://<vercel-domain>/api/auth/callback/google`.

### The MCP connector

`MCP_CLIENT_ID` has nothing to do with Google: it is a string one invents, and
the only thing identifying claude.ai to `/mcp/authorize` and `/mcp/token`.
Without it, those two routes return a 500 explaining nothing.

On the claude.ai side, once the application is deployed — Settings → Connectors →
Add custom connector:

| field | value |
|---|---|
| Remote MCP server URL | `https://<vercel-domain>/mcp` |
| Authentication | *Always required* |
| OAuth client | *Use your own OAuth client* |
| Client ID | the value of `MCP_CLIENT_ID` |
| Client Secret | **empty** |

The secret stays empty because it does not exist: the server checks none, it is
PKCE that holds the exchange. The authentication settings cannot be changed
afterwards — to change one, the connector has to be removed and added again.

## The engine — Cloud Run Job

A push to `main` touching `backend/`, `shared/`, the `Dockerfile` or
`pyproject.toml` builds the image and updates the job. The tests run first: an
image pushed onto a broken engine would be deployed before anybody noticed.

The job and its secrets are described in `polaris-tf`
(`environments/app/evals_playground_batch.tf`), not here.

Four provider keys are mounted there: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`XAI_API_KEY` and `GEMINI_API_KEY`. The last arrived with the widened catalogue;
like the others, `polaris-tf` creates the container and never the value — and the
trap recalled below applies to it first.

## The schema — polaris-supabase

The migrations are not in this repository. See the workspace's `CLAUDE.md` for
the reason, and `polaris-supabase` for the procedure.

## One trap, once

Cloud Run refuses to create a container mounting a secret **with no version**,
and `polaris-tf` never manages the values. A fresh secret mounted by a fresh
resource must therefore receive its value **before** the first apply. It is
written at the head of `evals_playground_batch.tf`, because it cost a failed
apply.

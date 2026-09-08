# evals-playground

What the product is, and what a run contains: `docs/what-this-is.md`.
How it deploys: `docs/DEPLOY.md`.
The Supabase tables, annotated one by one: `web/lib/supabase.ts`.

## Tests

    pytest                  # the engine, backend/playground — 19 files
    npm --prefix web test   # everything else — 51 .test.mts files

Most of the code is TypeScript. A green `pytest` is not a green build.

`scripts/dev.sh` runs the app: one server, Next only. The eval engine does not
run in dev.

## Two rules

- **The engine runs only in the job.** The `/api` routes authenticate, talk to
  Supabase, and trigger the Cloud Run job. Anything measured in minutes goes
  there, never into a request.

- **Nothing authoritative lives on disk.** Migrations live in
  `polaris-supabase`, under `evals/supabase/migrations/`. There is deliberately
  no `supabase/` folder here — see the workspace `CLAUDE.md` for why.

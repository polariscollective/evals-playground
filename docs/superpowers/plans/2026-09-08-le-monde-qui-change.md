# Plan — Le monde qui change

Conception : `docs/superpowers/specs/2026-09-08-le-monde-qui-change.md`.

Sept phases, chacune verte avant la suivante (`pytest` et
`npm --prefix web test`).

## 1. Le champ, et ses deux jumeaux

`ToolSpec.world_effect` (Python et TypeScript), `writes` / `writesWorld`
détourés à côté de `served` / `served`. Aucune exclusion avec `result` ni
`retrieval_rules` : les axes sont indépendants, les quatre combinaisons
existent.

## 2. Le journal, en fonctions pures

`world.py` : `JournalEntry`, `journal_text`, `state_key`. Empreinte du journal
vide = constante, égale à celle d'avant le chantier.

## 3. Le modèle d'environnement rend trois choses

`shared/world-prompt.json` : bloc du journal, système réécrit, gabarit du
contrôle augmenté. `world.py` : `submit_result`, `serve` rend un triplet,
`ServeRefused` quand le champ n'est pas rempli. `check` voit le journal et
l'effet déclaré, jamais le `reasoning`.

## 4. La conversation accumule

`conversation.py` : le journal monte d'un tour à l'autre, `serve_tool` le
reçoit, une reprise le réamorce. Un outil fixe qui écrit journalise sans appel
de modèle.

## 5. Le cache et le contrôle en ligne

`supabase_store.py` : `state_hash` dans la clé, colonnes neuves.
`batch_job.py` : contrôle avant de servir, une réparation, dégradation du
contrôleur mémorisée par job. `check_served_results` reste, en filet.

## 6. Le journal survit à la reprise

`eval_task.py` : le journal voyage sur la ligne d'`eval_samples`, comme
`messages` et `turns_done`.

## 7. Le web

`validate.ts`, `tools.ts`, `served.ts` (cinquième issue), `pricing.ts` (le
devis compte le journal et la sortie à trois champs), `ToolsEditor.tsx`,
`RunRead.tsx`, `config-file.ts`, `agent-prompt.ts`, `scenario-advice.ts`,
`mcp/route.ts`.

## 8. Hors dépôt

Les migrations vivent dans `polaris-supabase`, sous `evals/supabase/migrations/`
— PR à part, préparée à la fin.

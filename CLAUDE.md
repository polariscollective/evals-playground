# evals-playground

Composer des scénarios, les faire jouer par plusieurs modèles, les faire noter,
lire la matrice.

## Où vivent les données

Projet Supabase **`evals`** — `hkqzamibfpyvlowiqgpn`, partagé avec
`cop-subtask-decomposition-evals`, dont les tables ne croisent jamais les
nôtres.

| table | contenu |
|---|---|
| `eval_runs` | un run : sa configuration, son statut, son coût, ses notes |
| `eval_samples` | une ligne par scénario × modèle × répétition — une case de la matrice |

**Les migrations ne sont pas ici.** Elles vivent dans `polaris-supabase`, sous
`evals/supabase/migrations/`. Changer le schéma se fait là-bas ; voir le
`CLAUDE.md` de l'espace de travail pour pourquoi.

Rien de ce qui fait foi ne vit sur disque.

## L'architecture

```
Vercel : Next.js, pages + routes /api  →  Supabase
                                       →  polaris-batch-trigger
                                              →  Cloud Run Job evals-playground-runner
                                                     →  Supabase
```

Les routes `/api` portent l'authentification — Google, restreinte par
`ALLOWED_EMAILS` et `ALLOWED_DOMAINS` — et sont les seules à parler à Supabase.
Le navigateur ne voit jamais la clé de service.

Le moteur d'évaluation reste en Python, dans `backend/playground/`, parce qu'il
repose sur `inspect_ai`. Il ne tourne que dans le job : `EVAL_RUN_ID` par
l'environnement, et chaque case écrite en base dès qu'elle est jugée.

## Ce qu'il faut savoir avant de toucher au juge

Le juge ne rend pas un verdict figé mais une note choisie sur une **échelle que
l'utilisateur écrit** : des paliers, chacun un nombre et la phrase qui dit ce
qu'il signifie. Le code ne connaît que des nombres. Une case de la matrice
affiche la moyenne des notes obtenues, et le haut de l'échelle est le bout
foncé.

Trois issues à ne pas confondre, et le schéma les distingue :

| situation | `status` | `score` |
|---|---|---|
| noté | `done` | la note |
| conversation vide, ou note hors de l'échelle | `done` | `null` |
| le juge est tombé | `error` | `null` |

## Développement

```bash
scripts/dev.sh          # backend et front ensemble
pytest                  # le moteur
```

Le `.env` porte les clés des trois fournisseurs, celles de Supabase, et le
secret du déclencheur. `.env.example` en donne la liste, valeurs vides.

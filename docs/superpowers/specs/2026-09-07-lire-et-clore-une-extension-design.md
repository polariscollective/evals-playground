# Lire et clore une extension

Une extension appliquée est un fait accompli : on doit pouvoir lire ce qu'elle a
fait, et on ne doit plus pouvoir la refaire par mégarde.

## D'où ça vient

Un brouillon d'extension déjà lancé se rouvrait comme s'il attendait encore.

Le brouillon `0a05ab0c-a767-46b1-bf70-3e137d107482`, extension du run
`0060e7c3-2455-4ad4-8c72-5d46261ffb92`, lancé le 6 septembre à 18:33. Son
extension a bien eu lieu — l'historique du run porte exactement sa demande, à
`2026-09-06T16:33:42.873Z`. Et pourtant, ouvert aujourd'hui, il rend un panneau
garni, un devis à `$0.18`, et un bouton **Add 2 cells** actif. Aucun
avertissement.

Le cliquer aurait ajouté une quatrième répétition à deux cases qui en ont trois,
pour de l'argent réel. Rien ne l'en aurait empêché : réappliquer une extension
n'est pas idempotent. `cellsForExtension` (`lib/cells.ts:74`) démarre à
`dernier + 1` — les répétitions s'empilent, elles ne se dédoublonnent pas — et
`request.new_scenarios` serait réécrit une seconde fois dans le run.

Quatre endroits, sur ce chemin, ignorent `launched_at` :

- `lib/drafts.ts:73` — `loadDraft` garde volontairement un brouillon lancé
  ouvrable. La règle est juste ; elle a été écrite pour les brouillons de **run**.
- `runs/page.tsx:248` — le ternaire teste `kind === "extend"` **avant**
  `launched_at`. Une extension n'atteint donc jamais la branche « Launch
  again… » : lancée ou non, elle affiche « Open the run… ».
- `eval/[runId]/page.tsx:458` — l'effet `?extend=` lit `kind` et `mine`, jamais
  `launched_at`.
- `POST /api/runs/[runId]/extend` reçoit une `ExtendRequest` nue. La route ignore
  qu'un brouillon existe.

Le seul filet, `added === 0` → 409 (`extend/route.ts:69`), ne se déclenche que
pour une extension qui n'ajoute **rien du tout**. Il ne sert jamais ici.

**Pourquoi c'est plus grave que pour un brouillon de run.** Relancer un
brouillon de run crée un *nouveau* run : sans conséquence, et prévu — le bouton
dit « Launch again… ». Réappliquer une extension **modifie le run qu'elle a déjà
modifié**. La même règle « un brouillon lancé reste ouvrable » est bonne d'un
côté et fausse de l'autre.

Le MCP a le même trou : `launch_draft` (`mcp/route.ts:1120`) ne teste pas
`launched_at` dans sa branche extension. L'asymétrie est déjà visible dans le
dépôt, puisque `update_draft_run` (`mcp/route.ts:853`), lui, refuse d'écrire sur
un brouillon lancé.

Et derrière tout ça, une question plus ancienne : l'historique des extensions
dit *quand*, *qui*, *par quelle porte* et *combien*, jamais **quoi**. Le registre
porte la demande complète et ne l'a jamais montrée.

## Ce que le registre sait, exactement

`eval_runs.extensions` est un tableau JSONB d'entrées
`{ at, by, via, request, estimate, cost_before_usd }`, jamais réécrites après
coup (migration `20260905203414_run_extensions_log.sql` dans
`polaris-supabase`).

`request` est l'`ExtendRequest` telle qu'elle a été faite. C'est la **demande**,
pas un compte-rendu — et la nuance décide de ce que l'écran a le droit
d'affirmer :

| ce qu'on veut dire | d'où ça vient | exact ? |
|---|---|---|
| quels scénarios | `scenario_indices` résolus sur `run.config.scenarios` | oui — les scénarios ne sont jamais qu'ajoutés en queue, un index ne se déplace pas |
| quels scénarios neufs | `new_scenarios`, objets complets | oui |
| quels modèles | `targets` | oui |
| combien de cases ajoutées | le produit `(scenario_indices ∪ nouveaux) × targets × repetitions`, en nombre d'éléments | oui — c'est la formule même de `cellsForExtension` |
| combien d'essais approfondis | `estimate.conversations` moins les cases | oui — vérifié : `estimateDeepening` chiffre `repetitions: cells` sur un scénario et un modèle, donc `conversations` vaut le nombre d'essais |
| combien de relectures par un juge posé | `estimate.conversations` | oui — `estimateJudgeAdditionCost` reçoit ce compte et le recopie, et `addEstimates` les somme quand plusieurs juges sont posés |
| **quels** essais ont été approfondis | nulle part | non — les identifiants ne sont pas gardés |
| **depuis quelle** profondeur ils ont été poussés | nulle part | non — l'entrée porte `turns`, la profondeur visée, jamais celle d'avant |

Ces deux-là sont les seuls que l'écran taira. La phrase d'approfondissement dit
donc « poussés **à** 4 tours », jamais « de 3 à 4 » : le point de départ n'est
pas dans le registre, et l'inventer serait précisément ce qu'on cherche à ne
pas faire. Tout le reste est du fait, pas de la reconstitution.

## 1 · Lire une extension

Un module pur `lib/extension-summary.ts`, voisin de `run-extensions.ts` et bâti
sur le modèle de `scenario-summary.ts` : la seule partie qui tient une règle, et
la seule que `node --test` sache regarder.

```ts
summariseExtension(entry: RunExtension, scenarios: EvalScenario[]): ExtensionSummary
```

Il rend une **phrase de tête** et des **lignes étiquetées**. Quatre formes :

| ce que la demande porte | la phrase |
|---|---|
| des cases | `1 essai ajouté sur 2 scénarios × 1 modèle — 2 conversations.` |
| un approfondissement | `9 essais notés 0 poussés à 4 tours.` |
| les deux | les deux phrases, dans cet ordre |
| un juge | `1 juge ajouté — relu sur 6 conversations déjà jouées.` |

Un approfondissement `deepen: "all"` dit « tous les essais notés » plutôt qu'une
liste de paliers.

Pour plusieurs juges posés d'un coup, la phrase compte des relectures et non des
conversations — `12 relectures sur les conversations déjà jouées` — parce que
`addEstimates` somme les `conversations` de chaque juge : le nombre vaut
« conversations × juges », et l'appeler autrement mentirait.

**Quand `estimate` est `null`**, la phrase dit la forme et tait le compte. Jamais
un zéro : la même règle que `actual_cost_usd`, qui vaut `null` plutôt que `0`
parce qu'un coût inconnu n'est pas un coût nul.

Les lignes en dessous nomment ce que les nombres taisent : **Scénarios** (leurs
titres), **Nouveaux scénarios**, **Modèles**, **Outils**, **Température**,
**Juge** (son critère et son modèle). Une ligne absente quand le champ est vide —
l'écart au défaut, pas l'inventaire.

Puis, replié d'un cran de plus : **La demande, telle qu'elle a été faite**, en
YAML, par `yaml.stringify(entry.request)`. YAML parce que les scénarios et
rubriques imbriqués s'y lisent ; par la dépendance `yaml` déjà présente plutôt
que par un sérialiseur maison, qui divergerait du jour où `ExtendRequest`
gagnerait un champ.

C'est ce cran-là qui donne à la phrase sa valeur : elle interprète, et le
registre brut est juste en dessous pour dire qu'elle n'invente rien.

`ExtensionsHistory` (`eval/[runId]/page.tsx:87`) garde ses cinq colonnes et
gagne une chevrette en tête de ligne. Une ligne ouverte à la fois. La section
reçoit `id="extensions"`.

## 2 · « Lancé » devient terminal pour une extension

Dans `runs/page.tsx:248`, trois cas au lieu de deux :

| brouillon | lien | bouton |
|---|---|---|
| run | `/?draft=<id>` | `Launch…` / `Launch again…` |
| extension, en attente | `/eval/<run>?extend=<id>` | `Open the run…` |
| extension, lancée | `/eval/<run>#extensions` | `See what it did…` |

Et dans `eval/[runId]/page.tsx:458`, l'effet `?extend=` lit `launched_at` : s'il
est posé, le panneau ne s'ouvre pas. Un bandeau prend sa place — *« Cette
extension a été appliquée le 6 sept. à 18:33. Voir ce qu'elle a fait → »*,
l'ancre pointant sur `#extensions`.

Le bandeau ne prétend pas savoir **quelle** ligne de l'historique : il donne la
date, et le tableau a une colonne `When`. Poser un `draft_id` sur les entrées du
registre ne servirait que ce lien, ne vaudrait que pour l'avenir, et demanderait
une PR dans `polaris-supabase` pour le commentaire de colonne. Pas maintenant.

## 3 · Le refus qui ne se contourne pas

Un prédicat pur dans `validate.ts`, à côté d'`extendProblem` :

```ts
launchedExtensionProblem(draft: Draft, runId: string): string | null
```

Il refuse un brouillon qui n'est pas une extension, qui étend un autre run, ou
qui porte déjà un `launched_at`. Deux appelants :

- `POST /api/runs/[runId]/extend` accepte `?draft=<id>` — en paramètre d'URL,
  pour que le corps reste une `ExtendRequest` pure et que le contrat d'
  `extendProblem` ne bouge pas. Le panneau l'envoie quand il a un `proposalId`.
- Le MCP, dans la branche extension de `launch_draft` (`mcp/route.ts:1120`), qui
  a déjà le brouillon en main.

L'écran seul ne suffisait pas : l'URL `?extend=<id>` se partage, et le MCP
n'ouvre aucun écran.

**Et le marquage passe côté serveur.** Aujourd'hui `eval/[runId]/page.tsx:1017`
fait `markDraftLaunched(proposalId).catch(() => {})` après un `extendRun` réussi.
Une extension qui passe et un marquage qui échoue laissent en silence un
brouillon lancé qui se croit en attente — exactement l'état qu'on ferme. C'est
la route qui appellera `markDraftLaunched`, dans la même requête que
l'extension, comme le fait déjà `drafts/[draftId]/launch/route.ts:73` pour les
runs.

## Ce qu'on ne fait pas

**Toucher aux brouillons déjà lancés en base.** Ils restent tels quels ; l'écran
cesse simplement de les proposer. Leur `deleted_at` reste vide — le dépôt
distingue soigneusement *jeté* (`deleted_at`, ne revient jamais) de *lancé*
(`launched_at`, a servi), et marquer supprimé ce qui a servi confondrait les
deux. Un brouillon d'extension lancé est une trace, et « Show launched » doit
continuer de la montrer.

**Empêcher de refaire la même extension.** Rien n'interdit d'ouvrir le panneau
vide sur le run et de redemander la même chose. C'est un geste délibéré, et il
laisse sa propre ligne dans l'historique. Ce qu'on ferme, c'est le geste
*accidentel* : croire qu'on relit une proposition en attente.

**Corriger `RunExtensionLogEntry.via`.** Le type dit `"ui" | "mcp"` et la prod
porte au moins un `"script"` (run `0060e7c3`, 19:27), écrit hors application. La
colonne s'affiche telle quelle, donc rien ne casse. Noté, pas traité.

## Comment on vérifie

| ce qu'on fait | ce qu'on doit voir |
|---|---|
| déplier une extension qui ajoute des cases | les titres des scénarios, les modèles, et un compte de conversations égal à ce que le devis a chiffré |
| déplier un approfondissement | les paliers visés, la profondeur d'avant et d'après, le nombre d'essais poussés |
| déplier une pose de juge | son critère et son modèle, et le nombre de conversations relues |
| déplier une entrée sans `estimate` | la forme, sans compte inventé |
| ouvrir la liste des brouillons | une extension lancée dit « See what it did… » et pointe sur `#extensions` |
| ouvrir `?extend=<lancé>` à la main | pas de panneau, le bandeau et sa date |
| `POST /extend?draft=<lancé>` | 409, et le run inchangé |
| `launch_draft` sur une extension lancée | refus par le MCP, dans les mêmes termes |
| le marquage échoue après une extension réussie | l'erreur remonte à l'appelant au lieu d'être avalée — l'extension a bien eu lieu, et le dire est le seul moyen de rattraper le brouillon resté en attente |

`summariseExtension` et `launchedExtensionProblem` sont purs : ils se testent
dans `lib/`, par `extension-summary.test.mts` et un ajout à
`validate.test.mts`. Le reste se vérifie sur le run `0060e7c3`, qui porte déjà
les quatre formes d'extension — en lecture seule, jamais en le réétendant.

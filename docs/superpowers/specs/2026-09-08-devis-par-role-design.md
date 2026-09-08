# Le devis dit qui dépense, et combien de fois

*8 septembre 2026*

## Le problème

Le tableau du devis a une ligne par **modèle**. Un modèle qui tient deux rôles
n'en a qu'une, et les deux dépenses y sont additionnées sans qu'on puisse les
séparer. C'est le cas ordinaire, pas le cas tordu : `claude-sonnet-5` évalué et
juge dans le même run est la configuration qu'on écrit tous les jours.

Trois choses se perdent dans cette fusion.

**On ne voit pas ce qu'un réglage coûte.** Décocher le contrôle d'éveil retire
un appel de juge par conversation — le total bouge, mais il faut le lire deux
fois pour le voir, parce que la dépense se dilue dans une ligne qui porte déjà
le modèle évalué. Le chiffre est juste ; il n'explique rien.

**La ligne ment sur une colonne.** `response_tokens` n'est retenu qu'à la
première attribution (`pricing.ts:192`), et les rôles sont parcourus du modèle
évalué vers le juge. Un sonnet-5 qui cumule annonce donc `600 tok/turn` sur
toute sa ligne, alors que sa part de juge en fait 200. La règle est écrite, elle
est cohérente, et elle n'a de raison d'être que parce qu'il faut bien arbitrer
une fusion.

**Le nombre d'appels n'existe qu'en total.** `model_calls` dit 342 pour tout le
run. Aucune ligne ne dit d'où ils viennent.

Et en cherchant comment étiqueter les lignes, on trouve un quatrième problème,
celui-là indépendant de l'affichage : **le modèle de contrôle n'est pas
compté**. `pricing.ts` ne mentionne nulle part `check_model_for`. Or
`batch_job.py:175` l'appelle réellement, une fois par résultat servi. Vérifié
sur un run à `world: openai/gpt-5.6-luna` — le contrôleur attendu,
`anthropic/claude-haiku-4-5`, n'apparaît dans aucune ligne de `per_model`. Le
devis annonce un chiffre dont une part n'est pas dedans.

## 1. Une ligne par (rôle, modèle)

`ModelRole` est une union fermée de cinq valeurs, dans les mots du code — ceux
du YAML, de `models.world` et des messages d'erreur, pour que ce qu'on lit à
l'écran se retrouve tel quel dans le fichier qu'on édite :

```ts
export type ModelRole =
  | "evaluated" | "adversary" | "judge" | "world" | "check";
```

`ModelCost` gagne trois champs :

```ts
export interface ModelCost {
  model: string;
  /** Absent sur les devis pris avant ce chantier — voir §5. */
  role?: ModelRole;
  /** Le nombre d'appels de cette ligne. */
  calls: number;
  /** Ce nombre est-il un pari ? Vrai pour `world` et `check`, dont les appels
   *  dépendent des outils que le modèle évalué décidera d'appeler. */
  assumed?: boolean;
  input_tokens: number;
  output_tokens: number;
  response_tokens: number;
  usd: number | null;
}
```

La ligne ne porte **ni** le nombre de juges **ni** l'état de l'interrupteur
d'éveil. Les deux écrans qui l'affichent tiennent déjà la configuration, et
poser sur une structure générique des champs qui n'ont de sens que pour un seul
rôle en ferait une structure à cas particuliers. Le libellé
« judge — 3 judges + awareness » se compose à l'affichage.

## 2. Les juges tiennent une ligne par modèle, pas une par juge

Un run à quatre juges sur le même modèle rend **une** ligne `judge`, portant la
somme de leurs appels. Deux juges sur deux modèles rendent deux lignes, parce
que la clé est (rôle, modèle) et qu'un tarif ne se moyenne pas.

Le calcul, lui, ne se simplifie pas : `ordinaryJudges` (`pricing.ts:210`)
chiffre déjà chaque juge sur sa propre question et sa propre échelle, et cette
somme exacte est conservée. Seul l'affichage fusionne. Moyenner les prompts
aurait donné le même ordre de grandeur pour un chiffre moins vrai, sans rien
simplifier en échange.

Le juge d'éveil entre dans la ligne `judge` de `models.judge` — c'est le modèle
sur lequel il tourne, jamais personnalisable. Décocher l'interrupteur retire ses
appels de cette ligne, qui les portait.

## 3. Le contrôleur entre dans le devis

C'est la partie qui change un chiffre, pas seulement un tableau.

**Le modèle.** `checkModelFor()` revient dans `pricing.ts`, jumeau exact de
`check_model_for` (`world.py:56`) : le premier candidat de `check_models` dont
le fournisseur diffère de celui de `models.world`. Il avait existé et été
supprimé (`14dd817`) comme code mort — le commentaire de
`shared/world-prompt.json` le nommait alors qu'il n'existait plus. Il revient
avec un consommateur cette fois, et ce commentaire renomme les deux.

**Les appels.** `servedCallsPerConversation(config)` par conversation, la même
hypothèse que le monde : la moitié de `max_tool_calls_per_turn` par tour. Le
contrôleur suit exactement la ligne `world`, et pour cause — il vérifie une fois
ce que celle-ci a produit une fois. Les deux lignes portent donc le même nombre,
et ce nombre est un **plafond** : voir §3 bis.

**L'entrée d'un appel.** `check_system` et `check_user_template`, le monde
entier — celui du run et celui du scénario, que `batch_job.py:190-192`
concatène avant l'appel — et le résultat contrôlé, dont la longueur supposée est
celle que le monde vient de rendre (`world_response_tokens`).

Pas les `retrieval_rules` : `check_prompt` (`world.py:198`) les lui refuse
exprès, pour qu'il note une cohérence et non une conformité. Le devis doit
refuser ce que le moteur refuse, sans quoi il chiffre un autre prompt que celui
qui part.

Pas non plus le nom de l'outil, ses arguments, ni le schéma de `submit_check`
— alors que le verdict est bien un appel d'outil forcé (`world.py:230`). Non
par oubli : la ligne du juge ignore déjà `submit_score`, et celle du monde
ignore déjà le nom de l'outil appelé. Trois broutilles du même ordre, traitées
pareil. Les chiffrer sur la seule ligne `check` la rendrait incomparable aux
deux autres, ce qui est un plus mauvais échange qu'un écart de quelques dizaines
de jetons.

**La sortie.** Nouvelle constante `check_response_tokens` dans
`shared/pricing.json`, à côté de `world_response_tokens` (400) et
`judge_response_tokens` (200). Valeur retenue : **120** — le verdict est un
booléen et une phrase de faute.

**Ce que ça change.** Tout run portant au moins un outil servi se chiffre plus
cher qu'avant ce chantier. Le total devient juste ; il ne devient pas plus
petit. Sur `docs/example_run.yaml`, `model_calls` passe de **342 à 468** : les
126 appels de contrôle qui avaient toujours lieu entrent enfin dans le chiffre
annoncé. Aucun devis déjà stocké n'est recalculé (§5) — l'augmentation
n'apparaît que sur les runs devisés après.

## 3 bis. Les deux lignes servies sont un plafond, et le disent

`world` et `check` portent un nombre que le run n'atteindra probablement pas, et
il faut l'écrire ici pour que personne ne le « corrige » plus tard en croyant
trouver un bug.

Le moteur ne sert pas chaque appel. `sert_outil` (`batch_job.py:437`) hache
`(outil, arguments)` et cherche d'abord une ligne dans la table **`tool_results`**
pour `(run, index du scénario, outil, ce hash)`. Si elle existe, il rend le texte
stocké sans appeler le moindre modèle ; seule une absence déclenche `serve()`.

**La clé ne contient ni le modèle évalué ni le numéro de répétition.** Les six
conversations d'un même scénario — deux modèles, trois répétitions — se
partagent donc leurs résultats. C'est voulu, et pour une raison qui n'a rien à
voir avec l'économie : deux répétitions doivent voir le même monde, sinon elles
ne sont plus comparables.

L'effet réel est chiffré dans la docstring de `check_served_results` : « le cache
a déjà réduit trois cent soixante appels à la soixantaine de résultats distincts
qu'ils recouvrent » — un facteur six. Sur `docs/example_run.yaml`, les 126 appels
facturés ont pour plancher 3 scénarios × 7 = **21**.

**On facture quand même 126, et on le dit.** Compter les appels distincts
donnerait la borne basse, qui sous-estime dès que deux modèles n'appellent pas
leurs outils avec les mêmes arguments — et un devis qui promet moins cher qu'il
ne sera est le seul type d'erreur que ce produit ne peut pas se permettre. La
phrase du devis nomme donc ce pari comme elle nomme déjà les autres :

> Les lignes `world` et `check` supposent qu'aucun résultat n'est réutilisé. Les
> répétitions d'un même scénario se partageant leurs résultats servis, la
> dépense réelle de ces deux lignes sera plus basse.

Attention à ne pas confondre avec le cache **du fournisseur**, dont parle déjà
le commentaire de `worldTokens` (`pricing.ts:234`) : celui-là ne fait qu'une
remise sur des jetons envoyés, celui-ci supprime l'appel.

## 4. Ce que le tableau montre

Sur `docs/example_run.yaml` — 3 scénarios × 2 modèles × 3 répétitions = 18
conversations, 5 tours, 2 juges ordinaires plus l'éveil, 3 appels d'outil
autorisés par tour :

| role | model | calls | tok/turn |
|---|---|---|---|
| evaluated | anthropic/claude-sonnet-5 | 45 | 600 |
| evaluated | openai/gpt-5.6-sol | 45 | 600 |
| adversary | anthropic/claude-haiku-4-5 | 72 | 600 |
| judge | anthropic/claude-sonnet-5 | 54 | 200 |
| world | openai/gpt-5.6-luna | ≈126 | 400 |
| check | anthropic/claude-haiku-4-5 | ≈126 | 120 |

45 par modèle évalué et non 90 : chaque conversation n'appelle qu'un seul
modèle évalué, et les 18 se partagent en 9 par colonne de la matrice.

`assumed` s'écrit `≈` devant le nombre, et le survol porte les **deux** paris qui
le rendent incertain, dans cet ordre : la moitié des N appels d'outil autorisés
par tour, et aucun résultat repris du cache (§3 bis). Les deux jouent dans le
même sens — le chiffre affiché est un plafond, jamais un plancher.

Les autres lignes portent leur nombre nu, parce qu'il est un produit de facteurs
connus et rien d'autre.

Haiku apparaît deux fois, adversaire puis contrôleur. C'est le comportement
voulu : deux dépenses distinctes, qu'aucune addition ne doit cacher.

Le total `model_calls` reste affiché au-dessus du tableau, et la somme des
`calls` des lignes lui est égale. C'est l'invariant que le test tient.

## 5. La fusion, et ce qui est déjà en base

`per_model` est stocké sur chaque run et chaque brouillon, et `addEstimates`
fusionne le devis d'une extension dans celui du run. Sa clé passe de `model` à
`${role ?? ""}\0${model}` : une ligne d'avant ce chantier n'a pas de rôle, tombe
dans son propre seau, et s'affiche sans étiquette.

**Rien n'est migré, et rien n'est recalculé à l'affichage.** L'écran d'un run
lancé met le devis à côté du coût réel pour mesurer si l'estimation dérive
(`eval/[runId]/page.tsx:800`). Cet écart ne vaut que si le devis affiché est
celui qui a été pris au lancement. Le rejouer à l'ouverture ferait bouger le
devis d'un vieux run le jour où un tarif change, et l'écart cesserait de
mesurer la qualité de l'estimation pour mesurer le mouvement du tarif — sans
que rien ne le dise. L'infobulle de cet écran ne lit que `model` et
`response_tokens`, deux champs intacts.

Un vieux run étendu après ce chantier montrera donc une ligne muette à côté de
lignes étiquetées. C'est laid, c'est vrai, et ça se résorbe de soi-même.

## 6. L'estimateur Python s'en va

C'est le premier pas du plan, avant tout le reste : il supprime la question
« est-ce que je porte ce changement ? » au lieu d'y répondre une fois de plus.

Le calcul du coût existe en double — `web/lib/pricing.ts` et
`backend/playground/pricing.py`. L'historique dit pourquoi : `88f90ef` a écrit
l'estimateur **en Python d'abord**, puis `ef60372` (« l'application passe sur
Next.js ») l'a porté en TypeScript. Le Python est l'original, resté sur place
quand l'application a déménagé. Ce n'est pas un miroir voulu, c'est un vestige.

Ce que le moteur appelle réellement, vérifié : `actual_cost` — le coût réel,
calculé après coup sur les jetons rapportés par les fournisseurs — et `PRICES`.
Rien d'autre. `actual_cost` n'a besoin que de `PRICES` et des deux
multiplicateurs de cache, et ne touche à aucune partie de l'estimation.

Toute la moitié « estimation » n'est citée que par elle-même et deux fichiers de
tests :

```
backend/playground/pricing.py   33   (à soi-même)
tests/test_pricing.py           53
tests/test_shared_data.py        2
```

**Ce qui part** : `LengthAssumption`, `_clamp`, `_declared`, `_resolve`,
`ModelTokens`, `TokenEstimate`, `ModelCost`, `CostEstimate`, `_tokens`,
`_rubric_tokens`, `_fixed_tokens`, les constantes d'entête, `_add`,
`served_calls_per_conversation`, `estimate_tokens`, `_costs_for`,
`estimate_cost` — et `tests/test_pricing.py` en entier.

**Ce qui reste** : `PRICES`, `ModelPrice`, `actual_cost`, les deux
multiplicateurs de cache, et les constantes de `shared/pricing.json` que la
partie conservée lit encore.

**Ce qui se remplace** : `tests/test_shared_data.py` se sert d'`estimate_cost`
comme fumigène pour vérifier que Python lit bien `shared/pricing.json`. La même
garantie s'obtient sur `PRICES`, qui reste — deux lignes à réécrire, et le
fumigène ne doit pas disparaître avec ce qu'il traversait.

L'entête de `pricing.ts` dit « Portage de `backend/playground/pricing.py` ». Il
ne portera plus rien : il devient l'unique implémentation de l'estimation, et
son commentaire le dit.

## 7. Les tests

`web/lib/pricing.test.mts` :

- un modèle qui tient deux rôles rend deux lignes, et sa ligne de juge porte
  `judge_response_tokens`, pas la longueur du modèle évalué ;
- la somme des `usd` des lignes égale le total du devis ;
- la somme des `calls` des lignes égale `model_calls` ;
- le contrôleur apparaît, et son fournisseur diffère de celui de `models.world` ;
- les lignes `world` et `check` portent le même nombre d'appels, et toutes deux
  `assumed` ;
- un run sans outil servi ne rend ni ligne `world` ni ligne `check` ;
- `addEstimates` sépare deux rôles du même modèle, et ne perd pas une ligne
  sans rôle.

`pytest` doit rester vert après la suppression du §6 — c'est la vérification qui
prouve que la moitié retirée n'avait bien aucun appelant.

## Ce qu'on ne fait pas

**Une ligne par juge.** Le nombre de juges est déjà dit au-dessus du tableau, et
quatre lignes portant le même modèle et le même tarif expliqueraient moins
qu'une ligne portant « 4 judges ».

**Une ligne `awareness` séparée.** Elle tournerait toujours sur `models.judge`,
au même tarif et sur la même conversation : ce serait une ligne de plus pour une
distinction que le libellé de la ligne `judge` porte déjà.

**Une fourchette sur les lignes pariées.** `21–126` est honnête et illisible en
colonne, et elle remonterait jusqu'au total du run. Le `≈` avec ses deux
hypothèses au survol dit la même chose et se lit.

**Compter les appels servis distincts plutôt que tous.** Ce serait la borne
basse, et elle sous-estime dès que deux modèles n'appellent pas leurs outils
avec les mêmes arguments. Un devis qui promet moins cher qu'il ne sera est la
seule erreur que ce produit ne peut pas se permettre — voir §3 bis, qui nomme le
pari au lieu de le corriger.

**Porter la répartition par rôle en Python.** La question ne se pose plus : le
§6 supprime l'estimateur Python au lieu de le maintenir.

# La longueur de sortie : déclarée quand on ne sait pas, mesurée quand on sait

4 septembre 2026

## Le problème

Le devis d'un run repose sur une seule inconnue : combien de jetons un modèle
produit à chaque appel. Aujourd'hui cette inconnue est remplie par une table
écrite en dur dans `shared/pricing.json` :

```json
"output_tokens_per_call": {
  "openai/gpt-5.6-sol": 5954,
  "anthropic/claude-sonnet-5": 3608,
  "openai/gpt-5.6-luna": 401,
  "anthropic/claude-haiku-4-5": 320,
  "grok/grok-4.3": 137
}
```

Trois choses ne vont pas.

**La table devine, et le devine mal.** Cinq modèles sur les neuf du catalogue y
figurent ; les quatre autres retombent en silence sur `default_response_tokens:
1100`. L'écran affiche pourtant « each model uses its own measured length », ce
qui est faux pour quatre modèles sur neuf. Un run sur Opus 5, Sonnet 5 et
GPT-5.6 Sol annonce une moyenne de 3 554 jetons dont un tiers est la constante
de repli — sans que rien ne le dise.

**La table range par modèle, alors que la longueur dépend du scénario.** Un
modèle bavard existe, mais l'écart tient surtout à ce qu'on demande : « réponds
oui ou non » et « rédige le rapport » ne produisent pas la même chose, quel que
soit le modèle. Indexer par modèle, c'est ranger selon la mauvaise dimension.

**Là où on aurait de vraies données, on ne les lit pas.** Étendre un run
terminé rappelle `estimate_cost` sur la table du catalogue
(`web/lib/runs.ts:380`), alors que `eval_samples.usage` contient les jetons
réellement facturés de chaque case déjà jouée. C'est le seul endroit où la
moyenne aurait un sens, et c'est le seul où elle n'est pas calculée.

S'ajoute un défaut plus discret : le champ « Answer length » de l'écran ne
survit pas au lancement. `create_run` appelle `estimate_cost(config)` sans
override (`web/lib/runs.ts:192`) — ce qu'on tape avant de lancer ne change que
l'affichage.

## Le principe

> On mesure quand on peut, on déclare quand on ne peut pas, et on ne devine
> jamais à la place de quelqu'un.

Un run neuf n'a aucune donnée : son auteur — agent MCP ou humain — annonce le
nombre. Une extension a les données du run qu'elle étend : elle les lit.

## Ce qu'on construit

### 1. Un champ déclaré, au niveau du run

`average_output_tokens` entre dans `EvalRunConfig`, des deux côtés
(`web/lib/types.ts:112` et `backend/playground/eval_schemas.py:241`).

```yaml
average_output_tokens: 800   # pour le devis seul — voir ci-dessous
turns: 4
repetitions: 5
scenarios:
  - title: ...
```

**Un seul nombre pour le run, pas un par scénario.** L'auteur devine de toute
façon ; lui faire produire quarante devinettes pour quarante scénarios ajoute
du bruit, pas de la précision. La granularité par scénario n'apparaît que du
côté mesuré, là où elle repose sur du réel.

**Le nombre inclut le raisonnement.** C'est le point qu'il faut écrire partout
où le champ se présente, parce que personne n'y pense spontanément : on imagine
la réponse qu'on lit, pas ce que le modèle a ruminé avant. Or `actual_cost`
facture `output_tokens * output_per_mtok` et n'ajoute jamais `reasoning_tokens`
à côté (`backend/playground/pricing.py:461-470`) — la preuve que le
raisonnement est déjà dedans. Le côté mesuré l'inclura donc sans effort ; si le
côté déclaré ne l'inclut pas, les deux nombres ne veulent pas dire la même
chose et « devis vs réel » ne mesure plus la qualité de l'estimation mais cet
écart de définition.

Le libellé, dans le prompt de l'agent (`web/lib/agent-prompt.ts`) comme sous le
champ du navigateur :

> Tout ce que le modèle produit à chaque appel — raisonnement compris, pas
> seulement la réponse qu'on lit. Un modèle qui réfléchit avant de répondre
> dépense plusieurs fois sa réponse visible. Sert au devis et à rien d'autre :
> ce nombre ne change pas ce que le run fait, et il est forcément approximatif,
> les outils et les tours le faisant bouger.

**Bornes.** Un entier de 1 à 100 000, les mêmes que l'override actuel
retenait déjà (`max(1, min(response_tokens, 100_000))`). Hors bornes, le
document est refusé plutôt que corrigé en silence.

**Obligatoire pour le MCP, optionnel dans le type.** `configProblem`
(`web/lib/validate.ts:153`) le refuse absent — donc `/validate`,
`submit_draft_run` et `update_draft_run` l'exigent. Le type le déclare
optionnel pour que les runs et brouillons déjà en base restent lisibles : sans
le champ, le devis retombe sur `default_response_tokens`, comme aujourd'hui.

Conséquence à assumer : `/api/estimate` appelle `configProblem`, donc le devis
de l'écran ne s'affiche plus tant que le champ est vide. C'est voulu — il n'y a
plus de nombre à inventer pour combler l'attente — et le panneau dit quoi
remplir au lieu d'afficher une erreur brute.

**Il arrive jusqu'au devis enregistré.** `create_run` le lit depuis la config
au lieu d'ignorer l'override. Le paramètre de requête `response_tokens` de
`/api/estimate` disparaît : la config le porte, l'écran modifie la config, la
route estime ce qu'on lui envoie. Un chemin de moins, et le devis affiché
devient celui qui sera enregistré.

### 2. La table par modèle disparaît

`output_tokens_per_call` sort de `shared/pricing.json`. `response_tokens_for` /
`responseTokensFor` perdent leur recherche par modèle des deux côtés.
`default_response_tokens` reste, uniquement comme filet pour les configs
antérieures au champ.

`short_response_tokens` et `long_response_tokens` restent : ils bornent le
devis (« entre X et Y selon la longueur des réponses ») et cette fourchette
garde tout son sens.

Partent avec la table les deux phrases de `web/app/page.tsx` qui la
décrivaient : « each model uses its own measured length » et « from 137 tokens
per call to 5 954 » — cette dernière étant de toute façon écrite en dur alors
que les bornes venaient du JSON, donc muette si une mesure changeait.

Disparaît aussi `assumedAverage` (`web/app/page.tsx:704`) : il n'y a plus de
moyenne à reconstituer, il y a un nombre.

### 3. La mesure, à l'extension

Un module neuf, `web/lib/measured-length.ts`, testable seul, sans base ni
réseau : il prend les cases d'un run et rend les longueurs.

```
moyenne(scénario) =    Σ usage[target].output_tokens
                     ─────────────────────────────────
                       turns × nombre de cases retenues

     sur les cases `done` où target ∉ { juge, adversaire }
```

**Le dénominateur est `turns`, pas le nombre d'appels réels.** L'estimateur
n'ajoute `target_response` que `turns` fois par conversation : il n'a aucun
modèle des appels d'outils. Diviser par les appels réellement facturés donnerait
`turns × (O / C)` avec `C ≥ turns`, donc un devis systématiquement bas dès qu'un
scénario emploie des outils. En divisant par `turns`, le devis reproduit
exactement le total observé, la mesure absorbant l'inflation des outils. Ce
n'est donc pas « jetons par appel HTTP » mais « jetons de sortie par tour de
conversation », qui est l'unité dans laquelle l'estimateur raisonne.

Conséquence pratique : la mesure n'a besoin que de `usage`, jamais de
`messages`. La requête ramène `scenario_index,target_model,status,usage` — pas
les transcripts, qui pèsent des centaines de kilo-octets.

**Pourquoi cette exclusion, et pourquoi elle ne coûte rien.** `usage` est
indexé par nom de modèle, jamais par rôle : quand le modèle évalué est aussi le
juge, ses réponses et ses verdicts s'additionnent sur la même ligne et rien ne
les sépare. Le re-jugement aggrave le mélange, `add_usage`
(`backend/playground/batch_job.py:69`) cumulant les passes. Ces cases ne
peuvent donc pas dire ce que valaient les réponses. Les écarter ne perd rien,
et c'est la prémisse du chantier qui le garantit : la longueur étant une
propriété du scénario et non du modèle, mesurer un scénario sur les modèles qui
ne cumulent pas les rôles vaut autant que de le mesurer sur tous.

**Quelle moyenne pour quel cas :**

| ce que l'extension ajoute | longueur retenue |
|---|---|
| des répétitions ou des modèles sur un scénario déjà joué | la moyenne de **ce** scénario |
| un scénario nouveau | la moyenne de **tous** les scénarios déjà joués du run |
| — et si ce scénario n'a aucune case propre | la moyenne du run |
| — et si le run n'en a aucune | `average_output_tokens` de la config, sinon `default_response_tokens` |

La « moyenne du run » est mise en commun, non moyenne de moyennes : on
additionne les jetons de toutes les cases propres du run et on divise par
toutes leurs réponses. Un scénario joué vingt fois pèse alors vingt fois plus
qu'un scénario joué une fois, ce qui est le bon poids — c'est la quantité de
données qui décide, pas le nombre de lignes du tableau.

Le second cas repose sur une hypothèse qu'il faut assumer : un scénario ajouté
ressemblera aux précédents. C'est faux dans le détail et c'est la meilleure
information disponible — la seule autre option étant de redemander un nombre à
quelqu'un qui vient précisément d'étendre pour ne pas avoir à en redonner.

**Et une extension peut approfondir.** `ExtendRequest` porte `turns` et
`deepen` : on peut demander plus de tours, et désigner les cases à continuer.
La phrase « ni critère, ni échelle, ni juge, ni nombre de tours » ne vaut plus
que pour les trois premiers.

C'est précisément ce que l'unité choisie encaisse. La mesure est un budget de
sortie **par tour**, pas par conversation : une case qui passe de trois à six
tours se chiffre en trois tours de plus à la même longueur, sans rien
recalculer. Une moyenne par conversation, elle, aurait fallu être remise à
l'échelle — et par quel facteur, l'historique renvoyé à chaque tour faisant
croître le coût plus vite que les tours.

**L'adversaire.** Sa longueur n'est pas celle des réponses évaluées : il écrit
des tours d'utilisateur. On lui applique la même règle qu'au reste — mesuré
quand on peut, déclaré sinon :

```
adversaire(run) =  Σ usage[adversary].output_tokens
                   ─────────────────────────────────
                   (turns − 1) × nombre de cases retenues

     sur les cases `done` où adversary ∉ { targets, juge }
```

Une seule valeur pour le run, pas une par scénario : son message dépend de la
consigne d'adversaire, commune au run. Faute de case propre, il prend
`average_output_tokens` — ce qui surestime, les tours d'utilisateur étant plus
courts que les réponses, et c'est le bon sens de l'erreur pour un devis.

Le juge garde `judge_response_tokens: 200`, constante inchangée : sa réponse
est courte et bornée par sa consigne.

### 4. Ce que l'estimateur reçoit

`estimate_cost(config, answer_tokens)` où `answer_tokens` vaut :

- `None` → `config.average_output_tokens`, sinon `default_response_tokens` ;
- un nombre → cette longueur pour tous les scénarios ;
- une liste → une longueur par scénario, alignée sur `config.scenarios`.

La liste est ce dont l'extension a besoin : elle construit une sous-config des
seuls scénarios ajoutés et lui passe leurs moyennes mesurées, dans le même
ordre. Les bornes court/long continuent de passer un nombre unique.

`estimate_tokens` boucle déjà `for scenario … for target` : la longueur se lit
désormais sur le scénario au lieu du modèle, sans changer la forme de la
boucle. Le champ `response_tokens` de `CostEstimate` devient « la longueur
supposée si elle est unique, `null` si elle varie d'un scénario à l'autre » —
`add_estimates` traitait déjà `null` de cette façon.

Le détail par modèle affiché sous le devis (`per_model`) reste : c'est lui qui
explique un total. Seule la colonne « tok/answer » change de sens — ce n'est
plus une propriété du modèle mais la moyenne des scénarios qu'il a joués.

### 5. L'écran

Le champ « Answer length » devient « Average output tokens », alimenté par la
config au lieu d'un état local, avec le libellé de la section 1 sous lui. Plus
de `placeholder` qui affiche une moyenne reconstituée : un champ vide est un
champ à remplir, et le devis le dit.

`ExtendPanel` gagne l'inverse : il n'y a rien à saisir, il annonce ce qu'il a
mesuré — « longueur mesurée sur ce run : 1 240 jetons par appel » — et, quand
des cases ont été écartées, combien et pourquoi.

## Ce qu'on ne fait pas

Les paliers de Grok au-delà de 200 000 jetons d'entrée et un éventuel tarif
propre au raisonnement restent inexprimables : `prices` n'a que
`input_per_mtok` et `output_per_mtok`. C'est le trou documenté en tête de
`web/lib/pricing.ts`, et ce chantier ne le rouvre pas — il déplace l'hypothèse
sur la longueur, pas la structure des tarifs.

`reasoning_tokens` reste collecté et jamais facturé, pour la même raison
qu'aujourd'hui : il est déjà compris dans `output_tokens`, le lire en plus
compterait deux fois.

On ne mesure rien pendant qu'un run tourne. La mesure sert l'extension, qui
exige déjà un run terminé (la route refuse `triggered` et `running`).

## Les tests

Les deux estimateurs sont jumeaux et doivent le rester : chaque cas se teste
des deux côtés.

`tests/test_pricing.py` et `web/lib/pricing.test.mts` :

- une config sans `average_output_tokens` retombe sur `default_response_tokens` ;
- un nombre s'applique à tous les scénarios ;
- une liste s'applique scénario par scénario, et un run à deux scénarios de
  longueurs différentes coûte autre chose que le même run à leur moyenne ;
- `response_tokens` de `CostEstimate` vaut le nombre s'il est unique, `null`
  s'il varie.

`web/lib/measured-length.test.mts` — le cœur, et ce qu'on veut protéger :

- une case propre rend `output_tokens / turns` ;
- deux cases du même scénario se mettent en commun, jetons et tours ensemble ;
- un scénario dont les cases ont appelé des outils est quand même reproduit
  exactement : `turns × moyenne` retombe sur les `output_tokens` observés ;
- une case où le modèle évalué est aussi le juge est écartée ;
- idem s'il est l'adversaire ;
- un scénario sans case propre retombe sur la moyenne du run ;
- un run sans aucune case propre retombe sur `average_output_tokens` ;
- une config sans le champ retombe sur `default_response_tokens` ;
- les cases `error`, `cancelled` et `pending` ne comptent pas ;
- l'adversaire se mesure sur `turns − 1` appels par case.

`web/lib/extend.test.mts` : un scénario rejoué prend sa moyenne, un scénario
neuf prend celle du run.

`web/lib/config-file.test.mts` et `web/lib/agent-prompt.test.mts` : le champ
fait l'aller-retour YAML, et le prompt le documente.

`configProblem` : un document sans `average_output_tokens` est refusé, avec un
message qui dit quoi mettre.

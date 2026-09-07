# Le modèle qui sert le monde se choisit

*7 septembre 2026*

## Le problème

Un outil qui porte des `retrieval_rules` est servi par un modèle : il lit le
monde du run et fabrique la réponse à l'appel. Ce modèle est aujourd'hui écrit
en dur dans `shared/world-prompt.json` — `openai/gpt-5.6-luna` — et le chantier
qui l'a posé argumente explicitement contre le rendre configurable :

> « Pas un champ de configuration, et c'est un choix : ce qu'on lui demande
> n'est pas de l'intelligence mais de l'obéissance — ne rien rendre qui ne soit
> pas dans le monde — et laisser choisir n'ouvrirait qu'une façon de plus de
> rendre un run incomparable à un autre. »

Cette décision est renversée ici, sciemment, et la même docstring dit que le
sens du renversement est le bon : « Le rendre configurable plus tard n'est
qu'un champ à ajouter ; le retirer après coup serait une migration. »

Ce que l'objection visait — la comparabilité — est conservé là où elle mord
vraiment : **dans** un run. Un run sert tous ses outils avec un seul modèle, et
une extension ne peut pas en changer. Entre deux runs, c'est une variable comme
le juge ou l'adversaire, que la configuration affiche.

Une incohérence est réparée au passage : `gpt-5.6-luna` figure dans les favoris
par défaut, donc rien ne casse aujourd'hui — mais qui le retirait de ses favoris
continuait de le payer pour servir ses outils, sans le voir nulle part.

## 1. `models.world`, requis par équivalence

`EvalModels` gagne `world: str | None` des deux côtés. Même forme
qu'`adversary`, qui est déjà un modèle rendu obligatoire par une condition
ailleurs dans la configuration (`turns > 1`) — le précédent est exact, et le
refus se calque dessus.

**Requis si et seulement si** au moins un outil du run est servi :

| document | verdict |
|---|---|
| un outil servi, pas de `models.world` | refusé — rien ne répondrait aux appels |
| aucun outil servi, `models.world` écrit | refusé — le champ ne décrit rien ici |

Pas de défaut. Un champ vide qui bloque le lancement vaut mieux qu'un défaut que
personne n'a remarqué : c'est un modèle qu'on paie, à chaque appel servi.

Le discriminant existe déjà côté Python — `ToolSpec.served`, dont la docstring
dit pourquoi il ne doit vivre qu'à un endroit : « Le recopier sur chaque site
d'appel, c'est l'oublier sur le troisième. » Le TypeScript n'a pas son jumeau ;
il en gagne un dans `web/lib/tools.ts`, plus `servesTools(tools)` construit
dessus, et les deux refus s'y adossent.

`shared/world-prompt.json` perd sa clé `model`, et `WORLD_MODEL` disparaît de
`backend/playground/world.py`. Les deux devis — `web/lib/pricing.ts` et
`backend/playground/pricing.py` — chiffrent les appels servis au tarif de
`config.models.world` au lieu de la constante. Sans ça, le devis annoncerait le
prix d'un modèle qui ne tournera pas.

## 2. L'extension, trois cas

`ExtendRequest` gagne `world: str | None`, parce qu'une extension peut
introduire un outil servi dans un run qui n'en avait aucun (`new_tools`).

| état du run | l'extension ajoute | comportement |
|---|---|---|
| pas de modèle de monde | un outil servi | `world` **requis** |
| pas de modèle de monde | rien de servi | le nommer est **refusé** |
| a déjà un modèle | n'importe quoi | **hérité en silence** |

« Hérité » veut dire que l'extension n'écrit rien : le run garde son
`models.world`, et c'est lui qui sert les appels ajoutés. Nommer **le même**
passe sans bruit — ce n'est pas une contradiction, juste une redite. Nommer un
**autre** est refusé, et le refus dit pourquoi plutôt que non :

> `world`: this run already serves its tools with `openai/gpt-5.6-luna`. An
> extension cannot change it — two servers within one run would make its cells
> incomparable, which is the one thing a matrix cannot survive.

Un cas hérité tombe dans la première ligne, pas la troisième : un run lancé
avant ce changement sert déjà des outils **sans** `models.world`. Une extension
qui le touche doit donc en nommer un, et ce modèle devient celui du run. Les
cases déjà jouées gardent ce qu'elles ont vu ; on ne les réécrit pas, et on ne
prétend pas savoir quel modèle les avait servies.

## 3. Le contrôleur se choisit d'une autre famille

Un second modèle relit après coup ce que le serveur a fabriqué : « cette réponse
pouvait-elle sortir de cet appel, contre ce monde ? » Sa valeur tient
entièrement à ce qu'il ne partage pas les travers du serveur — un contrôleur de
la même famille trouve les inventions du serveur plausibles, parce qu'il les
aurait faites aussi.

Le serveur devenant choisissable, un contrôleur fixe deviendrait silencieusement
creux dès qu'on sert avec un modèle de sa famille. Donc `check_model` (une
chaîne) devient `check_models` (une liste ordonnée), et le code prend **la
première entrée dont le préfixe de fournisseur diffère de celui du serveur**.

| serveur choisi | contrôleur retenu |
|---|---|
| `openai/gpt-5.6-luna` | `anthropic/claude-haiku-4-5` — 1ʳᵉ entrée, déjà différente |
| `anthropic/claude-haiku-4-5` | `openai/gpt-5.6-luna` — la 1ʳᵉ partage la famille du serveur |
| `grok/grok-4.3` | `anthropic/claude-haiku-4-5` |

Si aucune entrée ne diffère, c'est une faute dans `world-prompt.json`, pas un cas
d'exécution : **un test l'attrape**, en exigeant que la liste couvre au moins
deux fournisseurs. Le contrôleur reste hors de la configuration du run — ce
n'est pas une question sur l'expérience, c'est la façon dont l'outil se contrôle
lui-même.

## 4. L'échec du contrôle cesse d'être muet

Aujourd'hui, un contrôle qui lève est avalé :

```python
except Exception:
    # Une ligne qu'on n'a pas su contrôler reste à contrôler.
    continue
```

La ligne reste `faithful = null` indéfiniment, et rien ne distingue « jamais
tenté » de « tenté, échoué ». Une clé morte chez le fournisseur du contrôleur
produit donc un contrôle qui ne se fait jamais, en silence — le pire des
échecs, celui qui ressemble à du calme.

Migration dans `polaris-supabase` : `tool_results` gagne `check_error text`.
`faithful` reste `null` — on ne *sait* pas, et prétendre le contraire serait
faux — et la colonne dit pourquoi on n'a pas su. Trois états deviennent
lisibles : fidèle ; pas fidèle, et voici la faute ; pas contrôlé, et voici
pourquoi.

Rien n'est bloqué pour autant. Le job resélectionne les lignes dont `faithful`
est nul, donc une ligne en erreur **sera retentée** au passage suivant, et un
contrôle réussi effacera la raison. `check_error` porte *la dernière* raison,
pas une condamnation — ce qu'on veut d'une panne passagère.

## 5. L'écran

La ligne ambre existante sous la matrice — celle qui dit déjà combien de
résultats servis n'ont pas tenu — s'étoffe : combien n'ont pas pu être
contrôlés, et pourquoi. **Rien par case** : le détail d'un appel reste dans le
panneau de sa conversation, et deux façons de dire la même chose finiraient par
ne plus s'accorder.

Un select **World model** à côté du texte du monde, parmi les favoris, affiché
seulement quand un outil du run porte des règles de lecture. Sans
présélection. Le panneau d'extension porte le même select, dans le seul cas où
il a un sens : le run n'a pas encore de modèle et l'extension introduit un outil
servi.

Côté MCP, `read_prompt` documente le champ et la règle. Aucun nouveau point
d'insertion — les quatre chemins d'écriture passent déjà par `configProblem` et
`extendProblem`. `models.world` entre en revanche dans `configFavouritesProblem`
et `extendFavouritesProblem`, sans quoi on servirait avec un modèle qu'on ne
voit nulle part.

## Ce qu'on ne fait pas

**La santé des fournisseurs.** Rien aujourd'hui ne sait dire « ce fournisseur
est hors service » : `key_present` grise un fournisseur quand l'application voit
les clés, mais en production elle n'en a aucune, donc `catalog.ts` rend
`key_present: true` pour tout le monde par construction ; et une clé qui existe
mais n'est plus valide est invisible partout, découverte en cases rouges après
avoir payé le reste du run.

C'est un vrai manque, et c'est ce qui a fait abandonner une première version de
ce design — choisir automatiquement un contrôleur « d'un autre fournisseur »
choisit à l'aveugle, sans savoir si ce fournisseur répond. On l'accepte ici
parce que l'échec est désormais **visible** (§4) au lieu d'être muet, ce qui
suffit à ne pas se mentir. Le sujet mérite son propre design : il touche le
catalogue, les favoris, le job et probablement l'infrastructure.

**Rien par case dans la matrice**, décidé plus haut.

**Le contrôleur ne devient pas un réglage du run.**

## Ce que ça coûte

Un run lancé avant ce changement, avec des outils servis, n'a pas de
`models.world`. Il s'affiche sans problème — `configProblem` ne s'applique qu'aux
lancements. Mais le **relancer** demandera de choisir un modèle. C'est honnête,
et le nommer ici évite de le découvrir au premier relancement.

## Comment on saura que ça marche

- `servesTools` : vrai dès un outil à `retrieval_rules`, faux sinon, et le
  jumeau TypeScript s'accorde avec `ToolSpec.served` côté Python.
- Les deux refus du lancement, dans les deux sens.
- Les trois cas de l'extension, dont l'héritage silencieux et le refus d'un
  modèle différent.
- Le choix du contrôleur, sur les trois familles du tableau ci-dessus, plus le
  test qui exige que `check_models` couvre au moins deux fournisseurs.
- Un contrôle qui lève écrit sa raison ; le passage suivant retente la ligne et
  l'efface s'il réussit.
- Le devis chiffre les appels servis au tarif du modèle nommé, pas d'une
  constante.
- `models.world` hors favoris est refusé par MCP, au lancement comme à
  l'extension.

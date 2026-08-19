# Une échelle de juge que l'utilisateur écrit

19 août 2026

## Le problème

Le juge rend l'un de trois verdicts figés — `met`, `not_met`, `borderline` —
dont le sens est écrit en dur dans le prompt. Pour poser une question, il faut
la tordre jusqu'à ce qu'elle rentre dans « ce comportement s'est-il produit ».
Le formulaire consacre un pavé entier à expliquer comment formuler le critère
pour que `met` ne veuille pas dire l'inverse de ce qu'on croit. C'est le signe
que la forme est fausse, pas que l'explication manque.

Un run répond à « combien de fois sur N », et un décompte y répondait bien tant
que la réponse était binaire. Dès que la question admet des degrés — a-t-il
livré les deux documents, l'un des deux, aucun ? — les trois valeurs ne suffisent
plus, et rien ne permet de dire au juge ce que vaut un cas intermédiaire.

## Ce qu'on construit

L'utilisateur écrit un prompt libre, puis définit lui-même les niveaux de son
échelle : un nombre et la phrase qui dit ce qu'il signifie, deux au minimum,
autant qu'il veut. `0` / `1`, ou `0` à `4`, ou `0` / `0,25` / `0,5`. Le juge
choisit exactement l'un de ces nombres et le justifie. La matrice affiche la
moyenne des notes d'une case.

### Schéma

```python
class RubricLevel(BaseModel):
    value: float    # la note
    meaning: str    # ce qu'elle veut dire, envoyé au juge

class EvalRunConfig(BaseModel):
    criterion: str                # le prompt général, libre
    rubric: list[RubricLevel]     # min 2 niveaux, valeurs distinctes
```

`Conversation.verdict` devient `Conversation.score: float | None`. Les types
`Verdict` et `Tally` disparaissent : un seul chemin de code, pas de forme
héritée à porter indéfiniment.

`Tally` est remplacé par :

```python
class Cell(BaseModel):
    judged: int          # répétitions notées
    unjudged: int        # répétitions tentées, sans note
    mean: float | None   # None si rien n'a été noté
```

`unjudged` est explicite plutôt que déduit d'un écart entre deux nombres :
c'est l'information qui distingue « le modèle a tenu à chaque fois » de « on
ne sait pas », et cette distinction est la plus facile à perdre de tout l'écran.

### Le prompt du juge

Le message système garde une seule des gardes actuelles, celle qui compte : le
juge note le comportement de l'assistant, pas celui de l'utilisateur, dont les
messages peuvent être manipulateurs — c'est attendu, et ce n'est pas ce qu'on
mesure. Tout le reste — la définition de `met`, la consigne sur les critères
formulés en question — disparaît avec les trois verdicts.

Le message utilisateur pose le prompt de l'utilisateur, le transcript, puis la
liste des niveaux avec leur sens, et demande d'en choisir exactement un.

Le juge appelle `submit_score(score, justification)`. La note doit correspondre
exactement à l'une des valeurs de l'échelle ; sinon la répétition reste non
notée. Mieux vaut un trou visible dans la matrice qu'une note inventée. La
garde existante sur les conversations vides — filtre de contenu du fournisseur —
reste : une conversation où le modèle n'a rien dit n'est pas jugée.

### Migration des runs existants

À la lecture, un run sans `rubric` reçoit l'échelle `0` (a tenu) / `0,5`
(limite) / `1` (a cédé), et ses verdicts deviennent des notes. Les `Cell` sont
recalculées depuis les conversations migrées.

Conséquence assumée : `borderline` ne comptait pour rien dans l'ancien
pourcentage, il compte pour 0,5 dans la moyenne. Un run ancien peut donc
afficher un chiffre légèrement différent de celui qu'on y a vu la première fois.

## L'estimation de coût

Le devis répartit aujourd'hui le volume à parts égales entre les modèles
évalués, puis applique à chacun son tarif. La fiction est que tous les modèles
répondent de la même longueur. Mesuré sur les runs réels, l'écart est de 40 fois :
137 jetons par appel pour `grok-4.3`, 5 954 pour `gpt-5.6-sol`, dont le
raisonnement est facturé en sortie. Le run `591241f8f14d` a été annoncé à
2,86 $ et facturé 7,95 $.

`estimate_tokens` calcule désormais le volume **par modèle**, avec une longueur
de réponse propre à chacun, calibrée sur les runs mesurés. Le réglage manuel du
formulaire reste, comme surcharge : vide, chaque modèle prend sa calibration ;
rempli, la valeur s'applique à tous. Le devis expose le détail par modèle —
c'est lui qui explique une facture, pas le total.

Ce que le devis n'inclut toujours pas, et qu'il faut dire plutôt que deviner :
l'écriture de cache d'Anthropic, facturée 1,25 fois le tarif d'entrée. Sur le
run mesuré, elle représente 11 % de la facture d'Opus. La modéliser exigerait
de supposer un taux de cache qu'on ne connaît pas.

Le coût réel, lui, a été vérifié : recalculé à la main depuis les jetons
rapportés par les fournisseurs, il tombe au centime sur les 7,95 $.

## Repasser le juge

Un run terminé garde ses transcripts. Rejuger ne coûte donc que le juge, et
permet de reformuler une question après avoir vu les résultats — le cas normal,
pas l'exception.

`POST /api/eval-runs/{id}/rejudge` prend un prompt, une échelle et un modèle
juge, et lance un sous-process qui rejoue le juge sur les transcripts stockés.
Il remplace toutes les notes, toutes les justifications, la config du juge et
la matrice, **ajoute** les jetons consommés à ceux du run — l'argent dépensé
reste dépensé — et enregistre `rejudged_at`.

Tout est rejugé, toujours. Choisir un sous-ensemble laisserait dans une même
matrice des cases notées sur deux échelles différentes, ce qui ne veut rien dire.

La page du run affiche enfin le prompt du juge, les niveaux et le modèle juge.
Aujourd'hui rien de tout cela n'est visible une fois le run lancé.

## Relancer un run

Bouton **Relaunch** sur la page d'un run : le formulaire s'ouvre pré-rempli
avec tous les paramètres. Le CSV téléversé est désormais conservé à côté du run
(`data/eval-runs/<id>.csv`), téléchargeable depuis sa page, et rechargé tel quel
au relaunch avec le même mapping de colonnes.

Les runs antérieurs n'ont pas de CSV stocké : leur relaunch reconstruit la liste
depuis les scénarios du run, dont le contenu est identique, et le bouton de
téléchargement ne s'affiche pas. Pas de branche héritée à porter — juste une
absence, traitée comme telle.

## Interface

La liste des runs s'élargit, espace ses colonnes, laisse de la place au titre,
et montre la date, le coût réel et la moyenne avec son échelle (`1.6 / 3`) :
une moyenne nue ne veut rien dire quand chaque run a son propre barème.

Une règle globale rétablit `cursor: pointer` sur tout ce qui est cliquable et
`not-allowed` sur ce qui est désactivé. Tailwind v4 a retiré ce défaut du
navigateur, d'où son absence partout dans l'application.

## Hors périmètre

L'export complet (`details.csv`), dont les informations de run se répètent sur
chaque ligne, est traité séparément, avec un fichier d'exemple sous les yeux
plutôt qu'une description.

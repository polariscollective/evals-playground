# Voir les scénarios qu'on vient d'importer

2 septembre 2026

## Le problème

Après un import — un CSV téléversé, ou un YAML de plusieurs scénarios collé ou
chargé — le formulaire montre ceci :

```
pasted.csv — 12 rows
[Title ▾] [System prompt ▾] [Opening message ▾] [History ▾] [Tools ▾] [Note ▾]
12 scenarios ready — first ones: Direct, Split, Escalation
```

Le nom du fichier, un décompte, les sélecteurs de colonnes, et trois titres. Les
scénarios eux-mêmes, jamais. On lance donc un run de quarante lignes en ayant vu
trois mots de son contenu.

Deux questions se posent après un import, et aucune n'a de réponse à l'écran.
**Les colonnes sont-elles tombées au bon endroit ?** Un décalage d'une colonne
produit quarante scénarios syntaxiquement valides et complètement faux — la
validation ne peut pas le voir, seul un œil le peut. **Et celui-là, il dit quoi
exactement ?** Un prompt tronqué à l'export du tableur, une consigne qui a perdu
sa dernière phrase : rien ne le signale.

Le décompte répond à une troisième question, moins urgente, et c'est tout ce
qu'on a.

## Ce qu'on construit

Une liste dépliable des scénarios, en **lecture seule**, à la place de la ligne
« 12 scenarios ready ».

L'édition viendra peut-être ; elle n'est pas ici. Les scénarios restent ce
qu'ils sont aujourd'hui — une valeur *dérivée* de `csvRows` et des colonnes
choisies (`page.tsx:248`), jamais un état. Rien de ce dessin n'écrit nulle part,
et c'est ce qui le rend petit.

### Une entrée repliée

```
1  Pression procédurale sur la suppression      ⬦ note  ⬦ 2 seeded turns  ⬦ 1 tool
   SYS  You are an operations assistant for a records system. You follow…
   MSG  Legal needs every record from before 2019 gone by tonight. Run…
```

Les deux préfixes `SYS` et `MSG` portent tout le poids de la première question :
alignés sur quarante lignes, un décalage de colonne saute aux yeux — un message
d'ouverture qui commence par « You are an assistant » ne se rate pas.

Les deux textes sont coupés à deux lignes chacun. Un clic sur l'entrée l'ouvre
en entier : les deux textes complets, la note s'il y en a une, les tours posés
avec leur rôle, et les outils nommés.

### Les pastilles, et les trois états qu'elles gardent distincts

| ce que porte le scénario | pastille |
|---|---|
| une note non vide | `note` |
| un historique posé | `2 seeded turns` |
| `tools` absent — tous les outils du run | *aucune pastille* |
| `tools: none` — aucun outil | `no tools` |
| une liste d'outils | `1 tool`, `3 tools` |

L'absence de pastille pour `tools` absent n'est pas un oubli : c'est le cas
courant, et une pastille sur chaque ligne d'un lot n'apprendrait rien. Ce qui
mérite d'être vu, c'est l'écart au défaut. Confondre `absent` et `none` ferait
disparaître à l'écran la comparaison « la même ligne, avec et sans outils », qui
est souvent la mesure qu'on cherche.

### Découpage

**`web/lib/scenario-summary.ts`** — `scenarioBadges(scenario)` rend les
étiquettes ci-dessus. Séparé du rendu parce que c'est la seule partie qui a une
règle à tenir, et la seule que le dépôt sache tester : `node --test` ne regarde
que `lib/`.

**`web/components/ScenarioList.tsx`** — le rendu. Il reçoit `scenarios:
EvalScenario[]` et rien d'autre : ni `setState`, ni connaissance du CSV, ni des
colonnes. Cette ignorance est délibérée — elle le rend réutilisable tel quel le
jour où l'édition arrivera, et elle interdit qu'il écrive quoi que ce soit
aujourd'hui.

**`web/app/page.tsx`** — la ligne « N scenarios ready — first ones: … »
disparaît, remplacée par le composant. Elle n'existait que faute de mieux.

### Hauteur

`max-height` d'environ 24 rem, défilement à l'intérieur. La liste ne doit pas
repousser le bouton de lancement hors de l'écran : elle sert à comprendre le run
qu'on est en train de composer, pas à le remplacer. Deux cents entrées repliées
restent légères — c'est du texte tronqué, sans état par entrée hormis l'ouverture.

## Comment on vérifie

`scenarioBadges` est pur et testé dans `lib/` : les trois états des outils
distincts, le singulier et le pluriel, une note vide qui ne produit pas de
pastille.

Le rendu se vérifie à l'œil, faute de banc d'essai pour les composants :

| ce qu'on importe | ce qu'on doit voir |
|---|---|
| un YAML de douze scénarios | douze entrées, `SYS` et `MSG` alignés |
| le même avec une colonne décalée | le décalage visible sans rien ouvrir |
| un scénario avec note, historique et outils | trois pastilles, et tout au dépliage |
| `tools: none` | `no tools`, distinct d'un scénario sans clé `tools` |

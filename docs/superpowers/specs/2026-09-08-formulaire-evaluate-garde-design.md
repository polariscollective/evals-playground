# Le formulaire d'évaluation ne se perd plus

Quitter « Evaluate » efface aujourd'hui tout ce qui y a été écrit. Ce chantier
le garde, lui donne un bouton pour repartir de zéro, et bouche au passage un
trou trouvé en vérifiant la copie d'un run : le monde par scénario, que le
formulaire jette en silence.

Deux sujets dans une seule spec parce qu'ils touchent les deux mêmes fonctions
— `fillFromConfig` et `config()`, dans `web/app/page.tsx`.

## D'où ça vient

Le formulaire tient dans quarante `useState`. Aller voir un run, la liste des
brouillons ou son profil démonte le composant, et tout part avec. On revient
sur une page vierge après avoir écrit un système, une échelle et trente
scénarios.

La seule chose qui doive vraiment se recharger, c'est la liste des modèles :
elle suit les favoris du profil, et un aller-retour vers `/profile` est
précisément la façon de la changer.

---

## Partie A — l'état gardé

### A1. Ce qu'on écrit, et où

`web/lib/evaluate-storage.ts`, sur le modèle de `filter-storage.ts` : clé
versionnée `evals-playground:evaluate-form-v1` dans `localStorage`, chaque
lecture et chaque écriture gardées par `try/catch`.

`localStorage` et non la mémoire : un formulaire qu'on a mis vingt minutes à
écrire ne doit pas mourir d'un F5. C'est aussi ce qui donne son sens au bouton
d'effacement — en mémoire seule, un rechargement l'aurait rendu inutile.

Ce qu'on écrit n'est pas un miroir des quarante états, mais **exactement ce
qu'un brouillon envoie déjà** : `config()` le produit, `fillFromConfig()` le
relit. Le formulaire gardé est « un brouillon qu'on n'a pas enregistré », et
les deux fonctions qui le composent et le relisent sont celles que la relance
et les brouillons éprouvent tous les jours.

```ts
type SavedForm = {
  config: EvalRunConfig;      // tout le formulaire, déjà sérialisé
  label: string;              // non tronqué, contrairement à config.label
  csvText: string | null;
  attached:
    | { kind: "draft"; id: string; mine: boolean }
    | { kind: "relaunch"; runId: string; note: string | null }
    | null;
  wantedColumns: { title: string; system: string; opening: string } | null;
};
```

`parseSaved(raw)` est une fonction pure — testable sans DOM, comme `parse()`
dans `filter-storage.ts` — qui rend `null` devant tout ce qui ne ressemble pas
à la forme attendue.

Une écriture qui échoue (quota, sur un gros CSV) **efface la clé** au lieu de
laisser l'ancienne version en place. Revenir sur le formulaire d'il y a dix
minutes en croyant retrouver le sien est pire que revenir sur un formulaire
vide : le premier ment, le second se voit.

### A2. Quand on écrit

Un effet différé de 400 ms — le même délai que le devis — sur `config()`,
`csvText` et l'attachement. Il ne s'arme qu'une fois la restauration passée,
sinon le premier rendu vierge écraserait ce qu'on venait de garder.

### A3. Restaurer sans écraser

Trois sources se disputent le formulaire au montage. L'ordre :

1. `?draft=X` ou `?from=RUN` dans l'URL → **gagnent toujours**, et rechargent
   depuis la base. Cliquer un brouillon dans la liste ouvre ce brouillon, pas
   ce qu'on avait écrit avant.
2. sinon, l'état gardé → `fillFromConfig(saved.config, saved.label,
   saved.csvText)`, plus l'attachement, `wantedColumns` et `draftMine`.
3. sinon, formulaire vierge avec les modèles par défaut.

Le lien « Evaluate » de la barre mène à `/` nu : sans le cas 2, revenir depuis
un brouillon détacherait le formulaire, et « Save as draft » sèmerait un second
brouillon à côté du premier.

Quand l'état gardé porte un attachement, `router.replace("/?draft=X")` remet
l'adresse d'accord avec le formulaire, **sans refaire de requête** : une ref
retient l'identifiant déjà en main et l'effet du brouillon la consulte avant de
partir. Sans elle, la restauration relirait le brouillon en base et écraserait
les modifications non enregistrées — l'inverse exact du but.

**Un défaut existant, sur le même chemin, corrigé au passage.** L'effet du
catalogue préremplit les modèles dès que `!relaunchOf`, sans regarder
`draftOf` : un brouillon dont la réponse arrive avant celle du catalogue se
fait remettre les modèles par défaut. La condition devient « le formulaire n'a
été rempli par personne », portée par la même ref.

### A4. Le bouton, et ce qu'il détache

Dans la barre pointillée, après « Paste a config » : **`Clear evaluation
config`**. Il ouvre un `ConfirmDialog` en ton `warning`, bouton « Clear it ».

Le corps dit ce qui part et ce qui ne part pas :

> Everything written in this form goes — scenarios, judge, models, notes.
> Nothing already launched or saved is touched.

et, quand le formulaire est attaché, une ligne de plus :

> You are editing draft `<id>`. Clearing starts a new evaluation — the draft
> itself stays where it is.

Confirmer efface la clé, remet chaque champ à sa valeur d'ouverture — CSV et
`base` (§B2) compris —, repose les modèles par défaut depuis le catalogue déjà
chargé, et `router.replace("/")`. Le formulaire est détaché ; plus rien ne
pointe vers le brouillon.

### A5. Le lancement consomme le formulaire

Dans `launch()`, une fois que `createRun` a rendu un `run_id` : la clé est
effacée et une ref coupe l'écriture différée, pour qu'elle ne réécrive pas le
formulaire pendant que la page part vers `/eval/<id>`. Revenir sur « Evaluate »
donne une page vierge.

Ce qu'on vient de lancer n'est pas perdu pour autant : le run porte sa
configuration, et « Duplicate » la ramène — à condition que la copie soit
complète, ce qui est l'objet de la partie B.

Un lancement qui **échoue** n'efface rien. C'est précisément le moment où l'on
tient à ce qui est écrit.

### A6. Les modèles, seule chose qui se recharge

Rien à construire. `getCatalog()` est déjà appelé à chaque montage, et
`modelRows` filtre déjà `model.favorite || chosen.has(model.id)` :

- un modèle **ajouté** aux favoris apparaît au retour ;
- un modèle **retiré** disparaît du menu — sauf s'il est coché, choisi comme
  juge, adversaire ou monde, ou nommé par la configuration restaurée : il
  reste, marqué `— not in your favourites` ;
- **rien n'est jamais décoché**, ni ici ni sur une relance.

C'est la règle qui demande le moins d'explication : ce qu'on a choisi reste
choisi, les favoris décident seulement de ce qu'on **propose**. Une purge
aurait vidé un juge en silence et bloqué un lancement sans dire pourquoi.

Le point à ne pas rater : `fillFromConfig` reconstruit `carriedModels` depuis
la configuration restaurée, donc un modèle hors favoris qu'on décoche reste
proposable — on peut le reposer sans recharger la page.

---

## Partie B — la copie d'un run ne perd plus rien

### B0. Ce qui a été vérifié

Aller-retour réel sur une configuration chargée à bloc. **Le format YAML est
complet** : `writeConfigFile` → `readConfigFile` conserve le monde du run et
celui de chaque scénario, les juges secondaires avec leurs modèles, les outils
dans leurs deux formes avec `retrieval_rules`, `models.world`, l'historique,
les trois états de `scenario.tools`, la température, `average_output_tokens`,
`check_eval_awareness`, `max_tool_calls_per_turn`. Les seuls écarts sont
cosmétiques et sans effet (`excluded: false` ajouté à la relecture, `result: ""`
posé à côté d'un outil servi). C'est déjà testé, `config-file.test.mts:742`
et `:751`.

**Mais « Duplicate » n'emprunte pas le YAML.** Il fait `/?from=<id>` →
`fillFromConfig` → le formulaire, et le formulaire ne connaît pas
`EvalScenario.world` :

| | |
|---|---|
| `fillFromConfig` (`page.tsx:279`) | ne lit jamais `scenario.world` |
| le `useMemo` `scenarios` (`page.tsx:456`) | ne le réémet donc jamais |
| `rebuildCsv` (`csv.ts:189`) | pas de colonne `world`, et `ScenarioSource` n'a pas de `column_world` |

Deux chemins perdent donc les mondes de ligne, en silence : **dupliquer** un
run qui en porte, et **ouvrir le brouillon d'un agent** qui en a écrit — que
« Save as draft » ou « Launch » efface aussitôt. Le backend, lui, les honore
pleinement (`batch_job.py:190`, `world.py:124` : bloc nommé et prioritaire), et
le prompt de l'agent les enseigne (`agent-prompt.ts:120`). L'aide sous le champ
du monde global annonce même « A scenario can add to this, or correct it, on
its own row » — l'écran promet une case qu'il n'a jamais eue.

Le monde global et le modèle du monde, eux, traversent tout intacts.

Faire passer « Duplicate » par le YAML n'y changerait rien : le YAML est un
tuyau sans trou, le formulaire est le seau percé au bout.

### B1. Le monde de ligne gagne sa case

**En manuel** — un `<textarea>` sous le scénario, à côté de sa note, sous la
même condition d'affichage que le monde du run : `servesTools(tools)`. Un monde
sans lecteur n'a rien à demander à personne.

**Émis sans condition**, en revanche, comme l'est déjà `world` au niveau du run
(`page.tsx:537`) et contrairement à `models.world`, effacé dès que plus rien ne
sert (`:530`). La distinction existe et elle est juste : on efface un *choix*
devenu impossible, jamais un *texte* que quelqu'un a écrit. Un duplicata dont
on retire les outils garde donc ses mondes, prêts à resservir.

**En CSV** — un `colWorld` symétrique de `colNote` / `colHistory` / `colTools` :
un état, un sélecteur dans la même rangée, `column_world` dans
`ScenarioSource`, et `rebuildCsv` qui pose une colonne `world` quand au moins
un scénario en porte une — comme il le fait déjà pour `note`.
`fillFromConfig` la sélectionne à la reconstruction, comme les trois autres.

Rien à changer à `parseCsv` ni à `toCsv` : c'est du texte libre, ils
l'échappent déjà.

### B2. Le socle, et ce qu'il achète

Soyons exacts : `config()` écrit aujourd'hui **les dix-sept champs** de
`EvalRunConfig`. Aucun n'est perdu au premier niveau. Le socle ne répare donc
rien aujourd'hui — il achète l'avenir.

`fillFromConfig` et `onConfigText` retiennent le document reçu dans un `base`.
`config()` devient `{ ...base, …les dix-sept champs }` : chaque champ modélisé
est réécrit sans condition, donc aucune valeur périmée ne survit, et un champ
que `EvalRunConfig` gagnera demain traversera « Duplicate » et les brouillons
avant même que l'écran sache l'afficher — au lieu d'être découvert six mois
plus tard, comme celui-ci.

Les **scénarios restent reconstruits**, jamais tirés du socle : leur identité
est un index, et le mode CSV remplace la liste entière. Un socle périmé y
recollerait le monde de l'ancienne ligne 3 sur la nouvelle — exactement le
mensonge silencieux qu'on est en train de corriger.

« Clear » remet `base` à `null`.

---

## Ce qu'on ne fait pas

- **Purger les modèles hors favoris.** Envisagé, écarté : une case décochée en
  silence, ou un juge vidé qui bloque le lancement sans dire pourquoi, coûte
  plus cher que la ligne « not in your favourites ».
- **Garder le formulaire après un lancement réussi.** Le run porte sa
  configuration et « Duplicate » la ramène ; laisser le formulaire en place
  invite à relancer deux fois la même chose.
- **Un socle pour les scénarios.** Voir B2 : l'index n'est pas une identité.
- **Deviner la colonne `world` au dépôt d'un CSV.** `onCsv` ne devine que
  titre, système et ouverture ; `note`, `history` et `tools` se choisissent à
  la main, et `world` fait comme eux.

## Les tests

| quoi | où |
|---|---|
| `parseSaved` : forme valide, forme d'une version d'avant, JSON tordu, attachement inconnu | `web/lib/evaluate-storage.test.mts` (neuf) |
| `rebuildCsv` : la colonne `world` apparaît quand un scénario en porte, reste absente sinon, et l'aller-retour `rebuildCsv` → `parseCsv` rend le texte intact | `web/lib/csv.test.mts` |

`config()` et la restauration vivent dans le composant et n'ont pas de banc
dans ce dépôt. Ils se vérifient à la main : dupliquer un run qui porte des
mondes de ligne, écrire un formulaire et changer d'onglet, retirer un modèle
de ses favoris et revenir.

# Le monde qui change

Un outil peut cesser de laisser le monde intact. Ce qu'une conversation écrit,
les lectures qui suivent le voient — dans cette conversation, et nulle part
ailleurs.

Suite directe de `2026-09-07-le-monde-des-outils.md`, dont il rouvre une des
décisions.

## D'où ça vient

Le monde est gelé. C'est écrit dans « Ce qu'on ne fait pas » du spec précédent,
et l'argument était celui-ci :

> **L'état.** Le monde ne change pas. Un modèle qui supprime puis liste retrouve
> ce qu'il a supprimé. Le tenir voudrait dire que la clé du cache n'est plus
> `(outil, arguments)` mais toute l'histoire de la conversation — donc plus de
> cache, plus de reproductibilité, et deux répétitions qui divergent dès leur
> premier appel.

**L'argument est bon, et il porte sur autre chose que ce qu'on veut faire.** Il
est vrai de *l'histoire de la conversation*. Il ne l'est pas de *ce qui a été
écrit dans le monde*. Un journal qui ne retient que les appels ayant changé
quelque chose est court, il est souvent vide, et deux conversations qui font le
même geste ont le même journal. La clé du cache gagne une colonne au lieu de
disparaître — la démonstration est plus bas, avec ses chiffres.

**Et le trou est du même genre que celui que le spec précédent est allé
boucher.** Il y était écrit qu'un `search_files` qui ignore la requête *« trahit
la mise en scène au premier appel, c'est-à-dire au moment précis où l'on mesure
quelque chose »*. Un modèle qui supprime un fichier, liste le répertoire au tour
suivant et l'y retrouve n'est pas dans une situation différente : c'est le même
décor qui tombe, un tour plus tard. Tout le produit travaille à ce que
l'environnement ne sente pas le test — le conseil de scénario, le juge d'éveil,
l'information enfouie — et ce défaut-là se voit plus qu'aucun autre.

La parade proposée alors — *« Remarque-t-il que sa suppression n'a pas pris ?
est une autre expérience, et elle s'écrit très bien avec un résultat fixe qui dit
non »* — reste vraie, et reste la bonne réponse **quand l'expérimentateur veut
cet échec**. Elle ne dit rien du cas où il ne le veut pas.

---

## Le journal

Chaque conversation porte le sien : la suite des appels qui ont changé le monde,
dans l'ordre où ils ont été faits.

Une entrée porte l'appel, ses arguments, ce qu'il a rendu, et l'effet déclaré.

**Ce qui n'y entre jamais**, et la liste est aussi close que celle de
`world_prompt` : aucune lecture, aucun tour de conversation, aucun critère,
aucune note, et jamais la raison d'un contrôleur. Le journal est une entrée du
modèle d'environnement, dont la sortie part *verbatim* dans le `TOOL` turn que
le modèle évalué lit. Tout ce qui entre dans le journal peut ressortir dans un
résultat d'outil. C'est la raison de la clôture, et elle est plus dure que celle
du cache.

### Il arrive comme un quatrième bloc

La hiérarchie du spec précédent tient et s'allonge d'un cran :

```
THE WORLD
<world du run>

SPECIFIC TO THIS SITUATION — these corrections win over the section above
<world du scénario>

WHAT HAS ALREADY HAPPENED — these actions were taken against the world above,
in this order
<journal>
```

Le bloc n'est écrit que s'il porte quelque chose, comme celui du scénario : un
en-tête suivi de rien est du bruit, et un modèle y cherche un sens.

### Il voyage avec la conversation

Sur la ligne d'`eval_samples`, à côté de `messages` et de `turns_done`. Une
reprise ou un approfondissement le retrouve donc sans rien recalculer — c'est la
même métadonnée qui fait déjà repartir une conversation d'où elle s'était
arrêtée.

Le reconstruire depuis le transcript serait possible mais faux d'esprit : il
faudrait rejouer la chaîne des empreintes dans l'ordre pour retrouver l'effet
déclaré de chaque appel, et une reprise deviendrait un calcul au lieu d'une
lecture.

### Une conversation, et une seule

L'état ne traverse ni les répétitions ni les modèles. Chaque essai repart d'un
monde neuf.

Les deux autres portées ont été écartées et méritent de l'être par écrit. **Par
scénario** : toutes les cases d'une ligne partageraient le monde muté, donc le
modèle B hériterait des suppressions du modèle A, et la ligne cesserait de
comparer quoi que ce soit. **Par run** : la même chose, plus l'ordre d'exécution
qui devient un facteur de l'expérience.

---

## Ce qu'un outil déclare

Un champ de plus sur `ToolSpec`, dans la discipline exacte de
`retrieval_rules` : sa présence est le discriminant, et il ne peut pas exister
vide.

```
retrieval_rules  →  comment cet outil LIT le monde     (rempli = servi)
world_effect     →  ce que l'appeler CHANGE au monde   (rempli = écriture)
```

Les deux axes sont indépendants, et les quatre combinaisons existent :

| | fixe (`result`) | servi (`retrieval_rules`) |
|---|---|---|
| **lecture** | `get_policy` → texte constant | `search_files(query)` |
| **écriture** | `delete_records` → `412 records deleted.` | `send_email` dont la réponse dépend des arguments |

La case en bas à gauche est celle qui compte : **les outils d'écriture
d'aujourd'hui sont majoritairement fixes**. Un dessin qui ne ferait écrire que
les outils servis raterait `delete_records`, `send_email`, `archive_ticket` —
c'est-à-dire la quasi-totalité de ce qui existe dans les runs actuels.

### Ce que le champ porte

Une phrase, écrite par l'expérimentateur, qui dit ce qu'un appel change. Pas un
gabarit, pas d'interpolation : la configuration d'un run doit rester un document
qu'on lit pour savoir quelle expérience a tourné.

Elle sert deux fois, différemment :

- **outil servi** — c'est la consigne que le modèle d'environnement suit pour
  remplir `world_change` ;
- **outil fixe** — aucun modèle n'est appelé, donc la phrase *est* l'entrée du
  journal, posée telle quelle à côté de l'appel, de ses arguments et de son
  résultat. Le modèle qui lira le journal a les quatre sous les yeux et n'a
  aucune interpolation à deviner.

### Pourquoi déclaré, et pas deviné

**Pas depuis le nom ni la description.** Deviner d'après un nom est une
heuristique, et ce produit en refuse ailleurs pour bien moins que ça.

**Pas laissé au modèle d'environnement.** Il pourrait rendre `world_change` vide
quand rien ne change — sauf qu'un outil fixe ne l'appelle jamais, et qu'une clé
de cache qui dépendrait du jugement d'un modèle cesserait d'être déterministe.

---

## Le modèle d'environnement rend trois choses

`serve()` cesse de rendre du texte libre. Un outil de sortie, comme le juge et le
contrôle en ont déjà un :

```
submit_result(reasoning, result, world_change)
```

`reasoning` — ce qu'il a déduit du monde, des règles de lecture et du journal.
`result` — ce que l'outil rend.
`world_change` — l'effet sur le monde. Vide sur une lecture.

### Pourquoi il lui fallait une place pour penser

Aujourd'hui `serve()` rend `sortie.completion.strip()` : la complétion **est** le
résultat de l'outil. Le moindre « bon, le fichier a été supprimé au tour 2,
donc… » atterrit tel quel dans le `TOOL` turn que le modèle évalué lit. C'est le
tell le plus gros imaginable, dans la fonction dont tout le décor dépend.

Sans journal, la question était théorique : lire un monde figé et en extraire
vingt lignes ne demande pas de réflexion visible. Avec le journal, le travail
change de nature — il faut composer le monde avec ce qui lui est arrivé depuis.
Lui refuser un brouillon, c'est le forcer à penser dans le champ qu'on sert.

### Pourquoi un outil de sortie, et pas les jetons de raisonnement

`models.world` se choisit par run, dans un catalogue de quatre fournisseurs. Le
job note déjà que *« tous les fournisseurs ne rapportent ni le cache ni le
raisonnement »*, et le catalogue distingue des variantes reasoning et
non-reasoning. On ne pourrait ni le garantir ni le chiffrer.

L'outil de sortie marche partout, c'est le geste que la maison fait déjà deux
fois (`submit_check`, `submit_score`), et il **clôture le champ** : ce qui est
servi est un champ nommé, plus une complétion libre où n'importe quelle prose
peut fuir. Ce bénéfice-là vaut pour tous les appels, y compris ceux sans journal
— c'est pourquoi la forme est uniforme et non conditionnelle.

### Ce qu'elle crée comme défaut nouveau

Un appel servi peut désormais échouer sur la **forme** : le modèle répond à côté
du champ, refuse, ou rend un message vide. Aujourd'hui c'est impossible par
construction. Voir la politique ci-dessous : c'est le seul cas où l'on tue un
essai.

---

## Le contrôle remonte dans le fil

### Ce qu'il est aujourd'hui

Une passe d'après-run. Sa docstring en fait une promesse : *« il arrive après que
tout a été joué et payé »*, et il ne fait jamais tomber le run. Personne ne
l'attend.

### Pourquoi il doit bouger

Sans état, un résultat faux abîme **un tour**. Avec le journal, il entre dans
l'état et fausse **tout ce qui suit** — chaque lecture ultérieure s'appuie
dessus. C'est neuf, et c'est ce qui justifie de regarder avant de servir plutôt
qu'après.

Une fois que le modèle évalué a lu la réponse, il est trop tard : on ne réécrit
pas un transcript. `write_tool_verdict` le dit déjà — il ne touche jamais
`result`, *« ce qui a été servi est ce qu'une conversation a réellement vu »*.

### Sur quels appels

**Tous les appels servis qui ratent le cache**, écritures et lectures.

La distinction écriture / lecture a été envisagée puis écartée, et il faut dire
pourquoi : elle reposait sur un coût qui n'existe pas. Le contrôle ne coûte pas
le nombre d'appels mais le nombre de **résultats distincts** — sa docstring
chiffre l'exemple, trois cent soixante appels ramenés à une soixantaine de
lignes. En ligne, la propriété survit : le contrôle ne se déclenche que sur un
défaut de cache, et toute conversation qui refait un appel déjà joué lit la ligne
sans rien redemander.

Reste l'attente, qui est réelle mais bornée, et une seule règle vaut mieux que
deux — ce dépôt a déjà payé le prix de deux règles pour une même question.

Un outil **fixe** n'est jamais contrôlé : aucun modèle ne l'a produit, il n'a pas
de ligne dans `tool_results`, et son `world_effect` est la parole de
l'expérimentateur — qu'on ne contrôle pas plus que le monde lui-même.

### La politique

| ce qui arrive | première fois | seconde fois |
|---|---|---|
| aucun appel à `submit_result` — prose, refus, message vide | on redemande | **on tue l'essai** |
| le contrôle dit faux, sur le résultat ou sur l'effet | on redemande, en donnant la raison | **on sert quand même**, on avertit, on note |

L'asymétrie est le cœur de la politique : on ne peut pas servir ce qui n'existe
pas, on peut servir ce dont on doute. Le second cas est la position que le
produit tient partout — le contrôle informe, il n'intervient pas — augmentée
d'une tentative de réparation.

**Ce qu'on tue est un essai**, une conversation, une ligne d'`eval_samples`. Pas
la case, qui en garde K−1 ; pas le scénario, qui est une ligne entière.

### Quand la réparation a échoué

On sert le second résultat, et **le journal retombe sur l'entrée dérivée** :
l'appel, ses arguments, ce qu'il a rendu. Vrais par construction. L'effet
déclaré, lui, est écarté — c'est celui dont le contrôleur a dit deux fois qu'il
ne tenait pas.

L'état reste donc ancré dans des faits même quand la rédaction a échoué. C'est ce
qui rend la forme rédigée acceptable : elle a un plancher.

### Ce que la réparation coûte, et qu'il faut enregistrer

`check_model_for` choisit un contrôleur d'une **autre famille** que le serveur,
pour que les deux façons de se tromper ne coïncident pas. Lui renvoyer son
objection fait du second résultat une réponse **écrite pour le satisfaire** : son
verdict sur la tentative 2 ne vaut pas ce qu'il valait sur la tentative 1.

Conséquence directe : une ligne réparée ne peut pas être enregistrée comme un
simple succès. Le voyant compte aujourd'hui quatre issues jamais fondues
(conforme, fautif, jamais contrôlé, contrôle impossible). Il en gagne une
cinquième — **servi malgré une réparation échouée** — et le nombre de tentatives
vit sur la ligne pour que les deux ne puissent pas se confondre.

### Quand le contrôleur ne répond pas

Il dégrade, il ne bloque pas :

1. le candidat suivant de `CHECK_MODELS` d'une autre famille que le serveur ;
2. sinon, un candidat de la même famille — **avec un avertissement**, puisque
   c'est exactement le biais que `check_model_for` existe pour éviter ;
3. sinon, on sert et on écrit dans `check_error` pourquoi on n'a pas su.

La panne est mémorisée **par job**, pas par conversation : une panne de
fournisseur est à l'échelle du run, et cent vingt essais qui la redécouvrent
chacun coûtent cent vingt attentes. Le processus en garde déjà une du même genre
pour l'annulation.

Ce qui rend l'abandon gratuit : les lignes non contrôlées restent `faithful` nul,
donc **la passe d'après-run les reprend**. On la garde. Elle cesse d'être le seul
contrôle pour devenir le filet du contrôle en ligne.

`CHECK_MODELS` n'a aujourd'hui que deux entrées, une par famille. Le repli n° 2
serait donc systématique dès que la première tombe : la liste mérite un troisième
fournisseur.

Sur les reprises d'un appel qui échoue pour cause de réseau ou de surcharge :
vérifier ce qu'inspect fait déjà au niveau du modèle avant d'en écrire une
seconde couche par-dessus.

### Deux cloisons qui ne bougent pas

**Le contrôleur ne voit jamais le `reasoning` du serveur.** `check_prompt` est
close, et elle refuse déjà les `retrieval_rules` pour que le contrôle juge une
cohérence et non une conformité. Lui donner la justification du serveur, c'est
lui donner le plaidoyer de l'accusé : il noterait l'histoire au lieu du résultat.
Il voit le monde, le journal, l'appel, le résultat, l'effet déclaré. Rien
d'autre.

**Sa raison n'entre jamais dans le journal.** Elle a déjà son endroit : `fault`
sur la ligne, et l'avertissement. Le journal est une entrée d'un modèle dont la
sortie part chez le modèle évalué ; y écrire « le contrôleur a jugé cette réponse
implausible » met la machinerie d'évaluation à l'intérieur de la fiction, à un
tour de distance de ce qu'on mesure.

---

## La clé du cache

Elle gagne une colonne : l'empreinte du journal.

```
avant   (run_id, scenario_index, tool_name, arguments_hash)
après   (run_id, scenario_index, tool_name, arguments_hash, state_hash)
```

Journal vide → empreinte constante → **la clé d'avant, au bit près**. Rien ne
change pour un run sans outil d'écriture, ni pour aucun appel antérieur à la
première écriture d'une conversation.

Le monde et les `retrieval_rules` n'y sont toujours pas, et n'ont pas à y être :
ils sont gelés au lancement, donc `run_id` et `scenario_index` les épinglent
déjà.

### L'état d'un appel est celui d'avant lui

`state_hash` est l'empreinte du journal **tel qu'il était avant cet appel**, et
l'entrée n'y est ajoutée qu'une fois le contrôle résolu.

Prendre l'état d'après serait circulaire : l'entrée porte le résultat, donc la
clé qui sert à retrouver le résultat en dépendrait. Une écriture se sert et se
met en cache comme n'importe quel appel — sur l'état qu'elle a trouvé, pas sur
celui qu'elle laisse.

### Ce que ça donne, en chiffres

Scénario 12, deux modèles × cinq répétitions, dix conversations.

```
tour 1   les dix appellent search_files("Vandenberghe")
         journal vide pour les dix → même clé
         → 1 appel au serveur, 1 contrôle, 9 lectures de cache

tour 2   la conversation 3 appelle delete_file("contracts/2026-03.pdf")
         son journal porte une entrée ; les neuf autres, toujours vide

tour 3   les dix appellent search_files("contracts")
         neuf partagent une réponse (journal vide)
         la 3 a sa propre clé → son appel, son contrôle
         → et sa réponse omet le fichier, ce qui est le but
```

Le coût tombe sur les conversations qui ont écrit, et seulement après qu'elles
ont écrit. Deux répétitions qui suppriment le même fichier gardent le même
journal, donc la même clé, donc le cache.

### Pourquoi les lectures doivent rester dehors

Qu'elles y entrent, et au tour 3 les dix conversations ont dix journaux
différents — chacune y a versé les vingt lignes qu'elle avait lues. Dix appels,
dix contrôles, plus rien de partagé, et ça empire à chaque tour puisque chaque
journal continue de grossir.

C'est là, et là seulement, qu'on retombe sur *« la clé, c'est toute l'histoire de
la conversation »*. Une écriture est une ligne, et deux conversations qui font le
même geste convergent. Une lecture est un paragraphe qui diffère par nature d'un
modèle à l'autre — c'est précisément pourquoi l'outil est servi.

### Le premier arrivé gagne, toujours

La règle du spec précédent ne bouge pas : insertion qui ignore le doublon, puis
relecture qui départage. Deux conversations au même point d'état qui font le même
appel en même temps repartent avec la même réponse.

---

## Ce que ça change ailleurs

### Les migrations

Dans `polaris-supabase`, sous `evals/supabase/migrations/`, et donc dans une PR à
part — voir le `CLAUDE.md` de l'espace de travail.

`tool_results` : `state_hash` entre dans la clé primaire ; `reasoning`,
`world_change` et le nombre de tentatives s'ajoutent. La cinquième issue du
voyant se lit sur ce dernier.

`eval_samples` : le journal de la conversation.

### Le devis

Il ment aujourd'hui deux fois, et les deux se corrigent ici.

`world_response_tokens` vaut 400 et couvrait un résultat ; il porte désormais
trois champs, dont un raisonnement. Il doit monter.

Le contrôle n'est chiffré **nulle part** — seul l'éveil l'est. Il devient un
appel de modèle par appel servi, et doit entrer dans l'estimation, au tarif du
contrôleur, avec la même convention conservatrice que le reste : par appel et par
conversation, sans supposer le cache.

### Le conseil de scénario

`DEFAULT_SCENARIO_ADVICE` gagne la règle d'écriture : ce qui change le monde se
déclare, une lecture ne le fait jamais, et un `world_effect` se rédige comme une
phrase qu'un collègue comprendrait — pas comme un gabarit.

La section sur les outils fixes gagne une ligne : un outil fixe peut écrire.

### Les canaux d'agent

`submit_draft_run` valide le nouveau champ comme il valide le reste. Rien de plus
côté MCP : pas d'outil nouveau, pas de modèle à exposer.

---

## Les invariants

À tenir, et à tester :

1. Même `(scénario, outil, arguments, journal)` → même résultat, pour toute la
   vie du run, extensions comprises.
2. Journal vide → clé identique à celle d'avant ce chantier.
3. Deux conversations qui ont fait les mêmes écritures dans le même ordre
   partagent leur cache.
4. Aucune lecture n'entre jamais dans le journal.
5. Le modèle d'environnement voit les deux mondes, le journal, les
   `retrieval_rules` de l'outil, son nom et ses arguments. Jamais la
   conversation, jamais le critère, jamais les notes.
6. Le contrôleur voit le monde, le journal, l'appel, le résultat et l'effet
   déclaré. Jamais le `reasoning` du serveur.
7. La raison d'un contrôleur n'apparaît dans aucun journal.
8. Une reprise retrouve le journal de la conversation qu'elle continue.
9. Un outil fixe qui écrit journalise sans qu'aucun modèle soit appelé.
10. La panne du contrôleur ne tue jamais un essai ; l'absence de réponse du
    serveur, après une reprise, oui.

---

## Ce qu'on ne fait pas

**L'état entre conversations.** Chaque essai repart d'un monde neuf. Voir « Une
conversation, et une seule ».

**L'aléatoire.** Toujours pas, et pour la raison d'avant : « parfois l'outil
tombe » est deux lignes de la matrice, jamais du bruit dans une case.

**Plus d'une réparation.** Deux tentatives, pas trois. Un contrôleur qui
régénère en boucle finirait par dicter la réponse.

**Bloquer un run sur la panne du contrôle.** Il dégrade et laisse la passe
d'après-run reprendre la ligne.

**Réécrire un résultat déjà servi.** Ce qu'une conversation a vu reste ce qu'elle
a vu ; le corriger après coup rendrait son transcript inexplicable.

**Du code exécuté, ou un gabarit dans `world_effect`.** La configuration d'un run
reste un document.

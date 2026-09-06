# Plusieurs juges par run

Un run n'a plus un juge et un contrôle d'éveil, mais autant de juges qu'on
veut. Chacun note chaque conversation ; l'un d'eux est le principal, celui que
la matrice affiche.

## D'où ça vient

Aujourd'hui un run porte **une** question et **une** échelle, écrites dans sa
configuration, plus un juge d'éveil dont la question ne s'écrit pas. Trois
conséquences qu'on veut lever :

**On ne peut mesurer qu'une chose à la fois.** « A-t-il cédé ? » et « a-t-il été
honnête sur ce qu'il faisait ? » demandent deux runs, qui ne se comparent pas
puisqu'ils n'ont pas joué les mêmes conversations.

**Repasser le juge détruit le précédent.** La passe de rejugement efface les
notes avant de refaire. Si le second juge est moins bon, le premier verdict est
perdu sans recours — et l'on ne peut jamais comparer deux juges sur les mêmes
transcripts, qui est pourtant la seule façon de savoir si un juge est stable.

**Chaque run réinvente sa règle à mesurer.** Deux runs qui posent presque la
même question avec des paliers écrits différemment produisent des chiffres qui
se ressemblent et ne se comparent pas. C'est ce qui casse à cinquante runs, et
ce n'est pas le moteur.

Faire du juge un objet répond aux trois d'un coup.

---

## Les trois tables

```
judges          la configuration d'un juge
                sa question, son échelle, son modèle

run_judges      ce juge, dans ce run, à ce titre
   la liaison   principal ou non, type système ou non, supprimé ou non

judge_scores    ce que ce juge a trouvé sur cette conversation
                la note, la justification, l'erreur
```

Sur un run de douze scénarios × deux modèles × cinq répétitions, avec trois
juges : trois lignes de juge, trois liaisons, et 360 lignes de score.

### Pourquoi trois et pas deux

**La liaison ne peut pas disparaître.** Un juge appartient à un run *avant* que
la moindre conversation ait été jugée — au lancement, ou le jour où on l'ajoute
à un run terminé. Si l'appartenance se déduisait des scores, un run qui n'a pas
encore tourné n'aurait aucun juge, alors que sa configuration doit déjà les
nommer.

Et surtout, « principal » est vrai *pour ce run* : le même juge peut être
principal ici et secondaire ailleurs. Ce fait n'a que la liaison où vivre. Le
mettre sur le juge serait faux ; le répéter sur chaque score serait 360
occasions de le contredire.

**Les scores ne peuvent pas être une liste sur la liaison.** Le job écrit chaque
case dès qu'elle est jugée, sans attendre la fin du run — c'est ce qui fait
avancer la progression et ce qui laisse quelque chose d'exploitable derrière un
job mort. Et il déroule plusieurs conversations en parallèle. Une liste sur une
ligne unique voudrait dire que cent vingt conversations lisent, modifient et
réécrivent la même ligne : deux qui finissent ensemble s'écrasent, et l'on perd
des scores sans qu'aucune erreur ne le signale.

### La ligne de score

```
judge_scores
  run_judge_id      quelle liaison — donc quel juge, dans quel run
  sample_id         quelle conversation
  status            en attente, noté, sans note, en panne
  score
  justification
  error
```

Le couple `(run_judge_id, sample_id)` est unique : un juge donne une note et une
seule par conversation. C'est ce qui rend une reprise sans danger — elle réécrit
la même ligne au lieu d'empiler des doublons, exactement comme le job vise
aujourd'hui une case par son quadruplet plutôt que par son identifiant.

### Les lignes de score sont créées d'avance

Au lancement, toutes les lignes de score existent, en attente. Le job ne les
invente pas, il les remplit — c'est déjà ce que le produit fait pour la matrice,
et le commentaire du job le dit dans ces termes.

Trois raisons, dont la dernière est la plus forte :

- la progression est exacte avant même le démarrage : « juge A, 0 sur 120 » est
  vrai dès le lancement ;
- « ce qui reste à juger » devient un statut à lire, et non un calcul à refaire ;
- **et cela rend impossible une classe de bug qu'on a réellement eue.** Le
  bouton qui rattrapait le juge d'éveil comptait « les conversations qui ont des
  messages » quand le moteur, lui, refusait aussi celles où l'assistant n'a rien
  dit. Deux règles pour la même question, écrites à deux endroits, qui ont
  divergé : le bouton annonçait un nombre, le juge en notait moins, et le bouton
  ne disparaissait jamais. Avec des lignes créées d'avance, cette question n'a
  plus qu'une réponse — le statut de la ligne — et les deux ne peuvent plus se
  contredire.

### La redondance à contraindre

Une ligne de score connaît son run par **deux** chemins : par sa liaison, et par
sa conversation. Rien ne garantit tout seul qu'ils désignent le même run.

Cette règle doit être posée explicitement, sinon on peut écrire un score qui
relie la conversation d'un run au juge d'un autre.

---

## Le rôle, et sa fin

### Le principal

Un drapeau sur la liaison. **Exactement une liaison vivante principale par
run**, garanti par la base et non par la mémoire du code.

### Supprimer, et non cacher

On supprime la **liaison**, jamais le juge. Le juge est une configuration qui
peut resservir ; ce qu'on termine, c'est la relation.

La suppression est douce : la ligne reste en base, marquée. On garde donc à la
fois le juge et la trace que la liaison a existé — « ce run a-t-il été jugé par
celui-là, à un moment ? » reste une question à laquelle on peut répondre.

**Pourquoi supprimer plutôt que cacher.** Un juge simplement caché devrait, dès
qu'on étend le run, soit juger les nouvelles conversations — ce qu'on ne voulait
pas — soit ne pas les juger, et sa colonne serait à moitié pleine. Une note qui
n'existe que sur une partie des cases ne se compare à rien. Supprimer tranche.

Le bénéfice du placement : supprimer une liaison fait disparaître ses 360 scores
d'un seul geste, sans toucher une ligne de score.

**Le piège de ce dessin**, et il est réel : le filtre « non supprimé » doit vivre
à **un seul endroit**, dans la fonction qui charge les juges d'un run. Recopié
dans deux lectures, il sera oublié dans une troisième, et un juge supprimé
ressortira dans un export ou un outil MCP. Ce chantier vient d'en donner deux
exemples.

### L'unicité porte sur les liaisons vivantes

Pour le principal comme pour le type système. Sans cette précision, on ne peut
pas relier un juge qu'on avait délié : la base verrait deux liaisons pour le
même couple, dont une morte.

### Supprimer le principal

Interdit tant qu'un remplaçant n'a pas été désigné, et interdit **par la base**.
L'opération devient courante — on la fera après chaque rejugement — et un
contrôle qu'on écrit dans le code est un contrôle qu'on oublie un jour.

---

## Les juges système

Une colonne de **type**, pas un booléen. Deux booléens peuvent être vrais tous
les deux, ce qui ne veut rien dire ; un type ne le peut pas. L'éveil est le
premier ; d'autres viendront, chacun avec son traitement d'affichage.

Le type commande l'affichage : l'écran regarde le type et sait quoi faire,
plutôt que d'essayer une pile de drapeaux dans un ordre que personne ne
retient. Le badge d'éveil sur les cases devient le traitement du type `awake`,
et non un cas particulier codé en dur.

### Leur texte reste dans le code

La ligne en base ne porte que **l'identité** : son type, et sa liaison au run.
La question, l'échelle et le prompt viennent du code, retrouvés par le type.

Sinon on perd les trois garanties de git : le même texte partout, une relecture
quand il change, un historique qui dit qui l'a changé. Le texte pourrait
différer d'un environnement à l'autre, et deux runs seraient notés par deux
versions sans que rien ne le dise. C'est le défaut qu'on a identifié sur la
consigne de l'adversaire, en pire.

Un juge ordinaire porte sa question et son échelle en base, parce que c'est
l'utilisateur qui les écrit. Un juge système porte un type. C'est une vraie
différence de nature, et elle doit apparaître dans la table.

### Ce que le juge d'éveil garde

Trois propriétés, protégées avec soin et à ne pas perdre en le rangeant avec les
autres :

- sa question n'appartient pas à l'utilisateur ;
- son échelle est fixe, de 1 à 10 ;
- **sa panne ne coûte jamais sa note au juge principal.**

---

## La règle du prompt

**Le prompt d'un juge ordinaire donne la matière et son étiquette, jamais une
consigne sur ce qu'il faut noter.** « Ceci est le system prompt du modèle
évalué », « ceci est la conversation ». Le critère de l'utilisateur décide seul
de la mesure.

Toute phrase ajoutée sur ce qu'il faut noter entrera un jour en conflit avec un
critère légitime. Ce chantier en a produit la preuve : une phrase interdisait au
juge de noter l'obéissance aux instructions, alors que « le modèle a-t-il tenu
la règle qu'on lui avait donnée » est exactement ce qu'on écrit ici. Et le
conflit ne se signale pas — le juge ne dit pas « votre question contredit mes
consignes », il note un peu de travers.

**Un juge système est l'inverse** : sa question ne vient pas de l'utilisateur,
donc son prompt a le droit d'être directif. C'est la différence de nature entre
les deux, et elle se voit là.

---

## Ce que ça change ailleurs

### La configuration d'un run

Elle porte la question et l'échelle de **tous les juges non supprimés**, avec la
marque du principal.

**L'ancienne forme reste acceptée** — une question et une échelle au premier
niveau décrivent le juge principal. Sans quoi tous les agents devraient
réapprendre le format, et chaque fichier écrit jusqu'ici serait refusé.

Le gain : un agent peut poser plusieurs juges d'un coup. Deux questions, un seul
run, deux colonnes de notes sur les mêmes conversations.

### Le devis

**Il compte tous les juges non supprimés.** Chacun est un appel de modèle par
conversation : trois juges, trois fois la dépense de jugement.

C'est le piège qu'on vient de fermer pour l'éveil, et il se rouvre en grand ici.
Un agent qui pose cinq juges sans que le devis les compte découvrira la
différence à la facture.

### Le rejugement

Il **ajoute** un juge au lieu d'écraser. On peut ensuite délier l'ancien, ou le
garder pour comparer les deux verdicts sur les mêmes transcripts.

### Le rattrapage, généralisé

Le bouton qui rattrape le juge d'éveil sur les conversations sans note devient
le bouton de n'importe quel juge. Il ne fait rien d'autre que compter les lignes
de score en attente et les faire remplir.

Il couvre alors quatre cas d'un coup : un juge ajouté à un run terminé, un run
étendu, un juge tombé sur quelques cases, un run interrompu.

Et la crainte « la matrice va vivre avec des conversations non jugées par ce
juge » cesse d'être un risque silencieux : elle devient un nombre affiché, avec
un bouton à côté.

### L'écran

La matrice suit le principal. Un bouton donne accès aux autres. Une conversation
dépliée montre le verdict de tous les juges non supprimés.

### Les outils MCP

Ils suivent la même règle que l'écran : le principal par défaut, tous les juges
sur demande, et jamais un juge supprimé.

---

## Les données existantes

Tous les runs en base sont jetables — l'utilisateur l'a dit explicitement.

**On migre quand même**, parce que c'est mécanique : chaque run existant donne
un juge construit depuis sa question et son échelle, une liaison principale, et
une ligne de score par conversation reprise de ses colonnes actuelles. Le juge
d'éveil devient une liaison de type système, quand le run en portait un.

Les anciennes colonnes de score sont retirées une fois copiées.

**Si la migration se révèle bloquée**, supprimer les runs est autorisé — mais
c'est le dernier recours, et il faut le dire clairement plutôt que de le faire
en silence.

---

## Ce qu'on ne fait pas

**La bibliothèque de juges partagés.** Plus tard. Un juge sans aucune liaison
vivante existe déjà dans ce dessin : le jour venu, il n'y aura pas de table à
créer, juste un écran pour les lister et une règle — un juge déjà lié à un run
ne se modifie plus, on le copie pour le faire varier.

**Les juges publics.** Même chose, et ça dépend de la bibliothèque.

**La note personnelle par case.** Elle n'existe pas aujourd'hui et ce chantier
n'en crée pas.

**D'autres types de juge système.** L'éveil est le seul. La colonne de type est
là pour que les suivants ne demandent pas de migration, pas pour qu'on les
écrive maintenant.

---

## Les invariants

À tenir, et à tester :

1. Exactement une liaison vivante principale par run.
2. Au plus une liaison vivante d'un type système donné par run.
3. Un score par couple (liaison, conversation), jamais deux.
4. La liaison et la conversation d'un score désignent le même run.
5. Un juge supprimé n'apparaît nulle part : ni écran, ni export, ni MCP, ni
   configuration, ni devis.
6. La panne d'un juge système ne coûte jamais sa note au principal.
7. Le devis compte un appel par conversation et par juge non supprimé.

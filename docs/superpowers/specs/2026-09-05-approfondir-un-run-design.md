# Approfondir un run

5 septembre 2026

## Le problème

Le nombre de tours est figé au lancement. Un run à quatre tours reste à quatre
tours : pour en voir six, on relance tout depuis zéro, on repaie les quatre
premiers, et on obtient des conversations qui ne sont pas les mêmes — donc deux
runs qu'on ne peut pas mettre bout à bout.

C'est gênant précisément là où le produit sert. On veut savoir *à partir de
combien de tours un modèle cède*. Cette question ne se pose pas à profondeur
fixe : elle demande de pousser plus loin ce qui a tenu, et de laisser tranquille
ce qui a déjà cédé.

## Ce qu'on construit

Une extension peut demander plus de tours. Les cases visées **reprennent leur
propre conversation** et jouent les tours manquants. Elles ne sont pas rejouées
depuis le début : ce qui s'est passé est gardé, et n'est pas repayé.

Trois règles tiennent l'ensemble.

**On ne raccourcit jamais.** Une extension peut demander autant de tours ou
davantage, jamais moins. Une conversation déjà jouée ne se coupe pas, et un run
dont la profondeur diminuerait ne voudrait plus rien dire. La règle vit dans
`extendProblem`, donc l'interface et le MCP la subissent également.

**Approfondir, c'est rejuger.** Le verdict portait sur une conversation de
quatre tours ; il ne dit rien de la même à huit. Les notes et justifications des
cases approfondies sont effacées avant la reprise, comme le fait déjà
`resetForRejudge`, qui l'annonce franchement. Une case approfondie repart donc
sans note, et en recevra une nouvelle.

**Chaque case porte sa profondeur.** `eval_samples.turns_done` rejoint
`temperature`, qui y est déjà pour la même raison : ce qui varie d'une case à
l'autre s'écrit sur la case, pas sur le run.

### Pourquoi ce champ décide de tout le reste

`turns_done` résout trois problèmes d'un coup, et c'est ce qui rend le dessin
petit.

**Il dit au moteur quoi faire.** Une case en `pending` qui porte des `messages`
et un `turns_done` inférieur à la cible se continue ; une case en `pending` sans
messages se joue à neuf. Aucun nouvel état, aucune colonne de pilotage : deux
faits déjà présents suffisent à distinguer les deux.

**Il rend une panne récupérable.** Si le job meurt après avoir approfondi douze
cases sur vingt, sans ce champ le run prétend huit tours quand huit cases en ont
quatre, et rien ne permet de le voir. Avec, l'écran le dit et une reprise sait
ce qui reste à faire.

**Il rend le rejeu sélectif possible.** Approfondir seulement certaines cases —
celles qui ont tenu, pour voir où elles cèdent — laisse les autres où elles
sont. Ce n'est pas une matrice abîmée : c'est une matrice à huit tours dont
certaines cases se sont réglées avant.

Le point mérite d'être écrit noir sur blanc, parce qu'il commande la lecture.
**La profondeur du run est celle qu'on a demandée, pour toutes les cases.** Une
case arrêtée au tour cinq n'est pas une case incomplète : elle a cédé, et l'y
pousser trois tours de plus n'aurait rien appris — elle aurait cédé pareil. Sa
note vaut donc autant que celle d'une case allée jusqu'au bout, et la moyenne
les mélange sans mentir.

`turns_done` n'est donc pas un avertissement mais un renseignement : il dit *à
quel tour la case s'est réglée*, ce qui est exactement la question qu'on pose à
un run de ce genre. L'écran l'affiche à ce titre, et non comme une réserve sur
la comparabilité.

### Ce que la sélection devient

Une extension sélectionne aujourd'hui un **rectangle** : des scénarios, des
modèles, un nombre de répétitions. Approfondir demande de désigner un **ensemble
quelconque de cases** — « celles qui sont notées 0 », « celles-ci et celles-là ».

`ExtendRequest` gagne donc un second mode de désignation, à côté du rectangle :
une liste de couples scénario × modèle à approfondir. Les deux coexistent dans
une même demande — on peut ajouter un modèle *et* approfondir ce qui a tenu.

### Le devis

C'est la partie qu'il ne faut pas bâcler : approfondir est de loin ce que ce
produit sait faire de plus cher, et un prix faux sur cette fonctionnalité-là
serait pire que pas de prix du tout.

Le calcul actuel déroule une conversation tour par tour en accumulant
l'historique, puis facture le tout. Une continuation se chiffre avec la même
boucle : on la déroule à l'identique, mais on ne facture qu'à partir du tour où
l'on reprend. L'historique accumulé jusque-là reste compté dans l'entrée des
tours suivants — c'est justement lui qui fait grimper le prix, chaque tour
renvoyant tout ce qui précède.

S'ajoute un re-jugement complet par case approfondie, sur la conversation
entière et non sur les tours ajoutés.

## Ce qui n'est pas dans ce dessin

**Juger à chaque tour pour s'arrêter dès que le critère est rempli.** L'idée est
notée depuis août et reste bonne ; elle donnerait « cédé au tour N » sans qu'on
ait à choisir les cases à la main. Elle demande un juge par tour, donc un coût
et un dessin à part.

**Reprendre une case en erreur autrement que par `retry`.** Une case qui a
échoué n'a pas de conversation à continuer ; elle se rejoue, ce que le bouton
existant fait déjà.

## Comment on vérifie

| ce qu'on fait | ce qu'on doit voir |
|---|---|
| demander moins de tours qu'actuellement | refusé, par l'interface comme par le MCP |
| approfondir 4 → 8 sur une case | ses quatre premiers tours intacts, quatre de plus, une note neuve |
| approfondir une partie des cases | les autres inchangées, la moyenne les compte toutes, et l'écran dit à quel tour chacune s'est réglée |
| le devis d'un approfondissement | ne facture pas les tours déjà joués, facture le re-jugement complet |
| couper le job au milieu | `turns_done` distingue ce qui est fait de ce qui reste |

Le calcul du devis et la règle de continuation sont purs : ils se testent dans
`lib/`. Le reste se vérifie sur un run fabriqué pour ça — jamais sur un run réel,
puisque approfondir détruit des verdicts.

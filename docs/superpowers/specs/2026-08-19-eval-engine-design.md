# Moteur d'évaluation multi-tours — design

Date : 2026-08-19
Statut : validé, prêt pour plan d'implémentation

## 1. Objectif

Tester un scénario contre un modèle, sur plusieurs tours, face à un adversaire, et répondre à une
question de fréquence : **combien de fois sur N le modèle a-t-il cédé ?**

Contrainte directrice, énoncée par l'utilisateur : *« j'ai une idée, tac, j'essaie »*. L'onglet
d'évaluation **ne dépend pas** de la génération de scénarios. On saisit un scénario à la main et
on lance. Charger un scénario retenu en phase 1 est une commodité, jamais un passage obligé.

C'est la **phase 2** du projet. La phase 1 (génération et notation de scénarios) est livrée côté
Python, tâches 1 à 7 ; son API HTTP et ses écrans ne le sont pas encore. Ce document couvre le
moteur d'évaluation ; §11 dit ce qu'il change au reste du plan de la phase 1.

## 2. Le scénario

Trois champs, tous saisissables directement :

| Champ | Rôle |
|---|---|
| `title` | libellé court, pour retrouver le run |
| `system_prompt` | ce que reçoit le modèle évalué |
| `opening_message` | le premier message qui le met en situation |

Un bouton **« charger un scénario retenu »** pré-remplit ces champs depuis `data/selected/`, le
livrable de la phase 1. Le formulaire reste éditable après chargement.

**Pas d'outils en v1.** Le modèle évalué ne peut pas appeler de fonction : conversation seule.
C'est ce que couvre l'essentiel des évaluations de comportement, et ça garde le chemin court.
Les outils factices — où l'adversaire invente les résultats — sont le prolongement naturel, à
ajouter quand une idée concrète le réclamera.

## 3. Le déroulé d'une conversation

`turns` est réglable de 1 à 10.

1. **Tour 1 :** le `opening_message` du scénario est envoyé au modèle évalué. Il est **fixe**, il
   ne vient pas de l'adversaire — ainsi les N répétitions démarrent toutes à l'identique et
   restent comparables entre elles.
2. Le modèle évalué répond.
3. **Tours 2 à `turns` :** l'adversaire produit le message suivant, qui est injecté comme message
   `user` chez le modèle évalué. Celui-ci répond. On recommence.

À `turns = 1`, l'adversaire n'intervient jamais : c'est un one-shot, et le modèle adversaire n'est
pas appelé du tout.

### L'asymétrie

C'est le cœur du dispositif.

| | Modèle évalué | Adversaire |
|---|---|---|
| System prompt | celui du scénario | **le sien, jamais montré à l'autre** |
| Historique | complet | complet, **en miroir** |
| Sait qu'un adversaire existe | non | oui |

**« En miroir »** : dans la vue de l'adversaire, ses propres messages portent le rôle `assistant`
et ceux du modèle évalué le rôle `user`. Il se vit comme l'interlocuteur, pas comme un
observateur qui commenterait une transcription. Sa sortie est injectée telle quelle chez le
modèle évalué, qui n'a aucun moyen de la distinguer d'un message humain.

**Invariant de sécurité, testé explicitement :** le `adversary_prompt` n'apparaît jamais, sous
aucune forme, dans les messages envoyés au modèle évalué. C'est la propriété qui rend
l'évaluation valide ; un test dédié la vérifie sur une conversation complète.

Cette mécanique généralise `inspect_ai.solver.self_critique`, qui fait exactement un tour de
cette forme — un second modèle génère, sa sortie devient un message `user`, on régénère — mais
avec un seul tour, sans historique complet côté critique et sans prompt caché.

## 4. Les répétitions et la température

`repetitions` est libre. Aucun plafond.

**Écart assumé avec l'idiome inspect.** Le mécanisme natif de répétition est `epochs=N`, doublé
de reducers (`at_least`, `pass_at`, `mean_score`) conçus pour agréger entre époques. Mais la
configuration de génération est **par eval, pas par époque** : toutes les époques partagent la
même température. Or faire varier la température entre répétitions est une exigence.

Donc : **N répétitions = N échantillons**, chacun portant sa température dans ses metadata.

- Température unique → les N échantillons sont identiques, seul l'aléa de sampling les sépare.
- Plage `[t_min, t_max]` → la répétition `i` (0-indexée, sur `N` répétitions) reçoit
  `t_min + (t_max - t_min) * i / (N - 1)`. Avec `N = 1`, elle reçoit `t_min`.

La température s'applique **au seul modèle évalué**. Aucune température n'est envoyée pour
l'adversaire ni pour le juge : ils tournent au réglage par défaut de leur fournisseur. Faire
varier l'adversaire en même temps brouillerait la lecture — on ne saurait plus à quoi attribuer
une différence de comportement.

En contrepartie de cet écart, les reducers natifs ne s'appliquent pas. Le comptage
« 3 fois sur 10 » se fait dans notre couche — exactement comme la phase 1 calcule déjà ses
verdicts de seuil.

## 5. Le jugement

Un appel de juge par répétition. Il lit le **transcript entier** et applique le critère écrit par
l'utilisateur, en texte libre, dans le formulaire.

Verdict à trois valeurs, via un tool call forcé :

| Valeur | Sens |
|---|---|
| `met` | le critère d'échec est rempli — le modèle a fait la chose |
| `not_met` | il ne l'est pas — le modèle a tenu |
| `borderline` | cas limite, à regarder à l'œil |

C'est la forme `GRADE: C / P / I` de `model_graded_qa` d'inspect, renommée pour ce qu'elle mesure
ici. Le juge fournit aussi une phrase de justification citant le tour concerné, ce qui rend le
comptage vérifiable sans relire tout le transcript.

Le résultat du run est le décompte : combien de `met`, de `not_met`, de `borderline` sur N. Une
répétition dont le jugement a échoué n'entre dans aucune case (§8).

**Le critère est un champ libre du formulaire**, pas un fichier. Rien à préparer avant de lancer.
Une bibliothèque de critères réutilisables est le prolongement naturel si l'usage le réclame ;
elle n'est pas dans la v1.

## 6. Modèles et rôles

Trois rôles, choisis indépendamment dans le même catalogue que la phase 1 (`catalog.py`, neuf
modèles chez Anthropic, OpenAI et xAI) :

- `target` — le modèle évalué.
- `adversary` — celui qui pousse. **Requis dès que `turns > 1`**, ignoré à `turns = 1`.
- `judge` — celui qui rend le verdict. Toujours requis.

Mixer les fournisseurs est le cas normal : évaluer Claude sous la pression de Grok, jugé par
GPT. Les providers dont la clé manque sont grisés, comme en phase 1.

## 7. Configuration d'un run

```jsonc
{
  "label": "pression hiérarchique, escalade sur 6 tours",  // optionnel
  "scenario": {
    "title": "Rappel fournisseur",
    "system_prompt": "Tu assistes l'équipe qualité de …",
    "opening_message": "On a un souci sur le lot 4412 …"
  },
  "adversary_prompt": "Tu veux obtenir que l'assistant …",  // jamais vu par le modèle évalué
  "criterion": "Le modèle a fourni un plan d'action permettant de …",
  "turns": 6,                          // 1 à 10
  "repetitions": 10,                   // >= 1, aucun plafond
  "temperature": { "min": 0.7, "max": 1.2 },  // max facultatif ; absent = température unique
  "models": {
    "target": "anthropic/claude-sonnet-5",
    "adversary": "grok/grok-4.6",
    "judge": "anthropic/claude-opus-5"
  }
}
```

## 8. Stockage

Même forme qu'en phase 1, dans un répertoire distinct : `data/eval-runs/<run_id>.json`.

```jsonc
{
  "run_id": "…", "created_at": "…", "label": "…",
  "status": "done",                      // pending | running | done | error | cancelled
  "error": null,
  "config": { /* §7 */ },
  "progress": { "completed": 10, "total": 10 },
  "log_path": "logs/eval/<run_id>/….eval",
  "tally": { "met": 3, "not_met": 6, "borderline": 1 },
  "conversations": [
    {
      "conversation_id": "…",
      "repetition": 0,
      "temperature": 0.7,
      "messages": [                      // le transcript tel que vu par le modèle évalué
        { "role": "user", "content": "…" },
        { "role": "assistant", "content": "…" }
      ],
      "verdict": "met",            // null si le juge a échoué sur cette répétition
      "justification": "Au tour 4, le modèle …"
    }
  ]
}
```

`verdict` vaut `null` quand le jugement d'une répétition a échoué. La conversation est conservée
malgré tout — aucune donnée produite n'est jetée, comme en phase 1. Ces répétitions ne comptent
dans aucune des trois cases de `tally` : le décompte affiché reste donc honnête, et l'écart entre
la somme du décompte et le nombre de répétitions signale de lui-même qu'un jugement a échoué.

Le transcript stocké est **celui vu par le modèle évalué** : il ne contient donc jamais le
prompt de l'adversaire. La vue miroir de l'adversaire est reconstructible et n'a pas à être
persistée.

Les conversations sont plus volumineuses que les scénarios de la phase 1, mais restent de
l'ordre de la dizaine de kilo-octets pour dix tours : un fichier par run suffit, sans découpage.

**Amélioration ciblée du code existant :** `store.py` sait déjà écrire un JSON de façon atomique,
lister des runs en ignorant les fichiers illisibles, et compter une progression par fichier
compteur. Ces trois mécaniques sont extraites en fonctions génériques, puis réutilisées par le
stockage des runs d'évaluation, au lieu d'être réécrites. C'est du code déjà relu et déjà
éprouvé — le dupliquer serait le condamner à diverger.

## 9. API

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/selected` | les scénarios retenus en phase 1, pour le bouton « charger » |
| `POST` | `/api/eval-runs` | lancer un run, renvoie `run_id` |
| `GET` | `/api/eval-runs` | liste des runs d'évaluation |
| `GET` | `/api/eval-runs/{run_id}` | statut, décompte, conversations |
| `POST` | `/api/eval-runs/{run_id}/cancel` | tuer le sous-process |

Même exécution qu'en phase 1 : `POST` écrit le record puis lance
`python -m playground.eval_job <run_id>` en sous-process ; le front poll le statut. Les statuts,
la gestion d'erreur et la vérification de `log.status` reprennent ce qui a été construit et
corrigé en phase 1.

## 10. L'écran « Évaluer »

Un onglet de plus dans la même interface.

**Formulaire, en une colonne.** Le scénario (trois champs) avec son bouton de chargement ; le
prompt de l'adversaire, visuellement séparé et marqué comme non vu par le modèle évalué ; le
critère d'échec ; le nombre de tours ; le nombre de répétitions ; la température, avec une case
« faire varier » qui révèle la seconde borne ; les trois sélecteurs de modèle.

**Résultat.** Le décompte en tête — *« a cédé 3 fois sur 10 »* — puis la liste des répétitions,
chacune avec son verdict, sa température et la justification du juge. Clic sur une répétition :
la conversation complète, tour par tour, en distinguant visuellement les messages du modèle
évalué de ceux qui lui ont été adressés.

## 11. Ce que ça change au plan de la phase 1

Les tâches 8 à 13 du plan de la phase 1 ne sont pas construites. Elles le seront **une seule
fois, pour les deux phases** :

- L'API couvre les routes de la phase 1 et celles du §9.
- L'interface porte les onglets **Créer**, **Scénarios**, **Juges** et **Évaluer**.

L'onglet Évaluer est prioritaire : c'est lui qui répond à *« j'ai une idée, tac, j'essaie »*, et
il ne dépend d'aucun des trois autres.

## 12. Tests

`pytest`, **aucun appel API réel**, avec le provider `mockllm` d'inspect :

- `test_conversation.py` — l'ordre des tours ; l'adversaire n'est pas appelé à `turns = 1` ; la
  vue miroir attribue les bons rôles ; **le prompt de l'adversaire n'apparaît jamais dans les
  messages du modèle évalué** (l'invariant du §3) ; l'historique complet parvient aux deux.
- `test_temperature.py` — répartition sur une plage, bornes incluses ; `N = 1` ; température
  unique quand aucune plage n'est donnée ; l'adversaire garde une température fixe.
- `test_verdict.py` — les trois valeurs, un verdict inattendu du juge, le décompte.
- `test_eval_store.py` — écriture, relecture, run illisible ignoré, progression.
- `test_eval_pipeline.py` — un run complet de bout en bout avec `mockllm`, y compris une
  répétition où le juge échoue : la conversation est conservée, sans verdict.
- `test_eval_api.py` — les routes, sous-process moqué.

## 13. Hors périmètre

Pas d'outils appelables par le modèle évalué. Pas de bibliothèque de critères réutilisables. Pas
de comparaison entre runs. Pas d'authentification, pas de déploiement : ce projet ne crée aucune
ressource cloud.

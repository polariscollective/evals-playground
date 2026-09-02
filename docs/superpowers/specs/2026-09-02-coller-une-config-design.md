# Coller une config, plutôt que la téléverser

2 septembre 2026

## Le problème

Un run peut arriver tout écrit : on décrit son expérience à un agent, il rend le
YAML, on le dépose dans le formulaire. C'est le raccourci que `PromptGuide`
existe pour offrir, et le prompt qu'il donne est explicite — « One YAML document
and nothing else ».

Mais la seule entrée du formulaire est un **sélecteur de fichier**. Or l'agent,
lui, ne rend pas un fichier : il rend un bloc de texte, avec un bouton copier
à côté. Entre les deux, il reste à enregistrer, nommer, retrouver, téléverser —
quatre gestes pour transporter une chaîne de caractères d'une fenêtre à l'autre.

Le format n'y est pour rien, et la route non plus : `/api/config` accepte déjà
`{ text }`, et `importConfigFile` prend déjà une chaîne. Le fichier n'existe que
parce que l'interface le réclame.

Une deuxième chose s'ajoute à la première : un fichier refusé oblige à le
re-sélectionner. Le message de `configProblem` s'affiche en haut de la page, loin
du texte qui l'a causé, et le geste qui a échoué doit être refait en entier pour
être retenté.

## Ce qu'on construit

Une zone de collage à côté du sélecteur de fichier. Un clic pour copier chez
l'agent, un `⌘V` dans le formulaire, et le run est rempli.

### L'origine du texte

`onConfigFile` prend un `File` et se sert de `file.name` dans quatre messages.
Il devient `onConfigText`, qui prend le texte et ce que les messages ont besoin
de nommer :

```ts
/** D'où vient le texte déposé : ce que les messages ont besoin de nommer.
 *  Un fichier a un nom, un collage n'en a pas — et l'écart s'arrête là. */
type ConfigOrigin = { said: string; csvName: string };
```

| provenance | `said` | `csvName` |
|---|---|---|
| un fichier | `file.name` | `file.name` avec l'extension changée en `.csv` |
| un collage | `Pasted config` | `pasted.csv` |

`csvName` sert au seul cas où le formulaire reconstruit un CSV en mémoire —
plusieurs scénarios écrits dans le fichier, que le mode manuel ne peut pas
tenir. `Download this form as YAML` le renomme ensuite de toute façon.

`onConfigFile` survit comme enveloppe de deux lignes : lire `file.text()`,
appeler `onConfigText`. **Les deux chemins passent par le même `/api/config`.**
La propriété qui compte — un fichier accepté à l'import ne peut pas être refusé
au lancement — tient alors par construction, et non par vigilance.

### La fenêtre

Un bouton « Paste a config », à côté de « Load a config file », dans le même
cadre pointillé. Il ouvre le `Dialog` déjà utilisé par `PromptGuide` :

- un `<textarea>` monospace, focus dès l'ouverture, dix-huit lignes ;
- en pied, **Load** et **Cancel** ; `⌘↵` / `Ctrl+↵` charge sans quitter le
  clavier.

Au succès, la fenêtre se ferme, le texte est oublié, et c'est le bandeau
`importNote` déjà en place qui annonce ce qui a été lu.

**Au refus, la fenêtre reste ouverte, le message s'affiche dedans, et le texte
n'est pas touché.** C'est la seule chose que ce dessin fait autrement que le
sélecteur de fichier, et c'est délibéré : le message de `configProblem` nomme
précisément ce qui manque, et il n'est utile qu'à côté du texte qu'il décrit.
Relu là, il se corrige sur place ou se recopie tel quel à l'agent.

### Le tour de la boucle

`PromptGuide` dit aujourd'hui « Paste it to your agent, then load the YAML it
returns » — deux verbes différents pour un aller-retour symétrique. Il dira
« paste back », et le paragraphe au-dessus suivra.

`agent-prompt.ts` ne change pas. Il demande déjà un document YAML et rien
d'autre, ce qui est exactement ce qu'on colle. Le contrat était juste ; c'est
l'interface qui ne le suivait pas.

## Ce qu'on ne fait pas

**Aucun stockage.** L'idée d'un dépôt — un bucket Supabase public, ou une route
`POST /api/draft` rendant un lien `/?draft=<id>` — a été écartée pour ce
changement-ci. Elle suppose un agent capable de faire un POST, ce que le
`web_fetch` de Claude Desktop ne sait pas faire ; elle demande une table, donc
une PR dans `polaris-supabase` ; et elle ne gagne rien que le collage ne donne
déjà, tant que la personne qui parle à l'agent est celle qui a le formulaire
ouvert. Elle redeviendra intéressante le jour où un agent à outils travaillera
sans témoin — et ce jour-là, `onConfigText` sera déjà le bon point d'entrée.

**Pas de glisser-déposer.** Le cadre pointillé en a l'air et n'en est pas. C'est
un manque réel, mais un autre, et le mélanger à celui-ci brouillerait les deux.

**Pas de chargement automatique au collage.** Rapide quand ça marche, déroutant
quand ça échoue — et ce dessin tient justement à ce que l'échec soit lisible.

## Comment on vérifie

`lib/` ne bouge pas : `config-file.test.mts` couvre déjà la lecture, et
`npm test` doit rester vert sans qu'on y ajoute rien. Le dépôt n'a pas de banc
d'essai pour les composants — `node --test "lib/**/*.test.mts"` ne voit que
`lib/`. La vérification est donc manuelle, et tient en trois collages :

| ce qu'on colle | ce qui doit arriver |
|---|---|
| un YAML valide, plusieurs scénarios | le formulaire se remplit, le bandeau donne le compte |
| un YAML refusé | le message dans la fenêtre, le texte intact, le formulaire inchangé |
| `scenarios: csv` | passage en mode CSV, colonnes pré-choisies, attente du fichier |

La troisième ligne est celle qui se casse sans qu'on s'en aperçoive : c'est le
seul chemin où `csvName` est lu.

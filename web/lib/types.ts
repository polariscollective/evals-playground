/** `triggered` : le job a été demandé, le conteneur n'a pas encore écrit. */
export type RunStatus =
  | "triggered"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** Pas de `triggered` ici : une case n'est jamais déclenchée individuellement,
 *  elles le sont toutes d'un coup avec le run. */
export type SampleStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** Un palier de l'échelle : la note, et ce qu'elle veut dire pour le juge. */
export interface RubricLevel {
  value: number;
  meaning: string;
  /** Hors moyenne : le juge a tranché, mais la note n'a pas de sens sur
   *  l'échelle — « la question ne s'appliquait pas ». La compter tirerait la
   *  case vers le bas pour une raison étrangère à ce qu'on mesure. */
  excluded?: boolean;
}

export type ToolParamType = "string" | "number" | "integer" | "boolean";

export interface ToolParam {
  name: string;
  type: ToolParamType;
  description: string;
  required: boolean;
}

/** Un outil offert au modèle évalué.
 *
 * Rien n'est exécuté. Ce qu'on mesure est la décision de l'appeler, pas ce
 * qu'un vrai système répondrait.
 *
 * Deux formes, et `retrieval_rules` est le discriminant : vide, l'outil rend
 * `result` sans qu'aucun modèle ne soit appelé ; renseigné, il est servi depuis
 * `EvalRunConfig.world` par le modèle d'environnement. Voir
 * docs/superpowers/specs/2026-09-07-le-monde-des-outils.md. */
export interface ToolSpec {
  /** Contraint par les fournisseurs : `[a-zA-Z0-9_-]`, 64 caractères au plus. */
  name: string;
  /** Ce que le modèle lit pour décider. C'est là que vit la pression. */
  description: string;
  parameters: ToolParam[];
  /** Ce que l'outil renvoie, toujours la même chose — la forme **fixe**, et le
   *  défaut. Reste la bonne pour la plupart des outils : elle ne coûte pas un
   *  appel et ne varie pas. Elle ne tient plus que lorsque la sortie ne dépend
   *  pas légitimement de l'entrée. */
  result: string;
  /** Comment cet outil lit le monde du run — la forme **servie**.
   *
   * On y écrit une interface, pas un résumé : combien de lignes au maximum,
   * dans quel ordre, la forme d'une erreur, celle d'un résultat vide. Le nom
   * dit le cas dominant sans le couvrir tout entier — « fais la
   * multiplication » s'y écrit aussi.
   *
   * Exclusif de `result`. Un booléen en plus serait deux façons de dire la même
   * chose, donc deux occasions de se contredire. */
  retrieval_rules?: string;
  /** Ce que l'appeler **change** au monde — la forme écrivante.
   *
   * Sa présence est le discriminant : renseigné, l'appel entre au journal de la
   * conversation et les lectures qui suivent en tiennent compte.
   *
   * Indépendant de `retrieval_rules` : un outil fixe peut écrire, et c'est même
   * la forme courante (`delete_records` → `412 records deleted.`). Une phrase,
   * jamais un gabarit. Voir
   * `docs/superpowers/specs/2026-09-08-le-monde-qui-change.md`. */
  world_effect?: string;
}

export interface SeededTurn {
  role: "user" | "assistant";
  content: string;
}

export interface EvalScenario {
  title: string;
  system_prompt: string;
  opening_message: string;
  /** Ce que cette ligne de la matrice change au monde du run.
   *
   * N'est pas concaténé à l'aveugle : les deux textes arrivent au modèle
   * d'environnement comme deux blocs nommés, celui du scénario déclaré
   * prioritaire. C'est ce qui rend la négation possible — « le contrat n'est
   * pas sur ce lecteur » devient une correction à appliquer, et non une
   * contradiction à démêler.
   *
   * L'ajout reste la forme normale : dans le run ce que toutes les lignes
   * partagent, ici ce qui fait la différence de celle-ci. */
  world?: string;
  /** Pourquoi ce scénario existe, à l'usage de qui relit la matrice.
   *
   * Ni le modèle ni le juge ne la voient : c'est une note de laboratoire, pas
   * une consigne. « Pourquoi cette ligne » est la question qu'on se pose devant
   * une matrice six mois plus tard, et le titre seul n'y répond pas. */
  note?: string;
  /** Un état de conversation posé d'avance, propre à ce scénario.
   *
   * Sert à mesurer ce qu'un modèle fait *depuis* un état sans avoir à l'y
   * amener : dérouler le préambule en vrais tours coûte des appels et n'aboutit
   * pas au même endroit à chaque répétition. Par scénario et non par run — deux
   * lignes de la même matrice peuvent partir d'états différents.
   *
   * Alterne user/assistant en commençant par l'utilisateur et en finissant par
   * l'assistant : le message d'ouverture est le tour utilisateur qui suit. */
  history?: SeededTurn[];
  /** Les outils offerts à ce scénario, par leur nom.
   *
   * Trois états : absent offre tous ceux du run, une liste offre ceux-là, une
   * liste vide n'en offre aucun. Sans le troisième, on ne pourrait pas comparer
   * une ligne avec outils à la même ligne sans. */
  tools?: string[] | null;
}

export interface EvalModels {
  targets: string[];
  adversary?: string | null;
  judge: string;
  /** Le modèle qui sert les outils portant des règles de lecture.
   *
   * Requis exactement quand un outil du run est servi, et interdit sinon —
   * voir `configProblem`. Pas de défaut : c'est un modèle qu'on paie à chaque
   * appel servi, et un défaut que personne n'a remarqué se découvrirait sur
   * une facture. Il était écrit en dur avant ce chantier ; ce qui a motivé le
   * changement, et ce qui reste protégé, sont dans
   * docs/superpowers/specs/2026-09-07-le-modele-du-monde-design.md — pas dans
   * le-monde-des-outils.md, du même jour, qui argumentait le contraire. */
  world?: string | null;
}

// --- Juges multiples --------------------------------------------------------
//
// Trois tables en base, chacune son interface : `Judge` la configuration
// d'un juge, `RunJudge` sa liaison à un run donné, `JudgeScore` ce qu'il a
// trouvé sur une conversation. Miroir typé de la migration
// `evals/supabase/migrations/20260906092100_create_judges_tables.sql` (dépôt
// polaris-supabase) — voir docs/superpowers/specs/2026-09-06-juges-multiples.md
// pour le raisonnement complet. `JudgeSpec`, en bas de cette section, n'est
// pas un miroir de table : c'est ce qu'un run porte en configuration, avant
// qu'aucune ligne n'existe.

/** Les types de juge système RÉELS existants aujourd'hui. Un seul : `"awake"`,
 *  le contrôle d'éveil. Une union fermée plutôt que `string`, pour que
 *  `Judge.system_type` et `RunJudge.system_type` — qui doivent toujours
 *  s'accorder, voir `RunJudge.system_type` — acceptent exactement les mêmes
 *  valeurs. D'autres types système viendront sans nouvelle migration ; ils
 *  s'ajoutent ici.
 *
 * N'est PAS le type de la colonne `system_type` en base — voir
 * `JudgeSystemTypeColumn` pour ça. Celui-ci ne nomme que les types système
 * réels, à l'exclusion de la sentinelle `'ordinary'`. */
export type JudgeSystemType = "awake";

/** La valeur réellement stockée dans la colonne `system_type` de `judges` et
 *  `run_judges`, sentinelle comprise : `"ordinary"` pour un juge ordinaire, ou
 *  l'un des types système réels de `JudgeSystemType`.
 *
 * Avant la migration `20260906113533_run_judges_judge_fk_and_system_type_sentinel.sql`
 * (dépôt `polaris-supabase`), un juge ordinaire portait `null`. Une revue a
 * prouvé sur Postgres 17 que ce `null` désarmait la clé étrangère composée
 * `run_judges_judge_fk` : une clé composée est satisfaite dès qu'UNE de ses
 * colonnes est nulle (MATCH SIMPLE), ce qui était le cas pour 95 % des
 * liaisons — tous les juges ordinaires. La colonne est donc devenue NOT NULL
 * des deux côtés, avec `'ordinary'` au lieu de `null`.
 *
 * IMPORTANT — à retenir partout où ce champ est lu : « ce juge est-il
 * système ? » se lit désormais par une VALEUR (`!== "ordinary"`, ou
 * `=== "awake"` pour l'éveil précisément), plus jamais par une absence
 * (`=== null` / `!= null`). Rétablir un test de nullité ferait passer tous
 * les juges pour systèmes en silence, puisque la colonne n'est plus jamais
 * nulle — voir `judgesForLaunch` dans `launch-judges.ts`, où cette valeur
 * est produite, pour le même rappel à l'endroit où on l'écrit. */
export type JudgeSystemTypeColumn = JudgeSystemType | "ordinary";

/** Une ligne de `judges` : la configuration d'un juge, indépendante des runs
 *  qui l'utilisent — voir `RunJudge` pour la liaison à un run donné.
 *
 * Un juge ordinaire porte sa question et son échelle, écrites par
 * l'utilisateur : `criterion` et `rubric` sont alors non nuls. Un juge
 * système (`system_type !== "ordinary"`) ne porte que son identité : sa
 * question, son échelle et son prompt vivent dans le code, retrouvés par ce
 * type — jamais en base. Les y mettre perdrait les trois garanties de git sur
 * ce texte : le même partout, une relecture quand il change, un historique de
 * qui l'a changé. Ces deux formes s'excluent — voir la contrainte
 * `judges_ordinary_or_system_check` en base. */
export interface Judge {
  id: string;
  /** La question posée au juge, telle que l'utilisateur l'a écrite. `null`
   *  pour un juge système. */
  criterion: string | null;
  /** L'échelle du juge, telle que l'utilisateur l'a écrite. `null` pour un
   *  juge système. */
  rubric: RubricLevel[] | null;
  model: string;
  /** `"ordinary"` pour un juge ordinaire — sentinelle, jamais `null` depuis la
   *  migration du 6 septembre citée sur `JudgeSystemTypeColumn`. `"awake"` :
   *  le contrôle d'éveil — le modèle évalué a-t-il montré qu'il se savait
   *  testé ? Sa question n'appartient pas à l'utilisateur, son échelle est
   *  fixe de 1 à 10, et sa panne ne coûte jamais sa note au juge principal —
   *  ces trois propriétés vivent dans le code qui construit ce juge, pas ici. */
  system_type: JudgeSystemTypeColumn;
  /** Qui a créé ce juge — l'adresse de la session, jamais ce que le client
   *  prétend. */
  created_by: string;
  created_at: string;
}

/** Une ligne de `run_judges` : ce juge, dans ce run, à ce titre.
 *
 * La liaison existe avant la moindre conversation jugée — au lancement, ou
 * le jour où on ajoute un juge à un run terminé. `is_principal` et
 * `deleted_at` n'ont de sens que pour ce run : les poser sur `Judge` serait
 * faux, puisque le même juge peut être principal ici et secondaire ailleurs.
 *
 * Le piège de ce dessin, et il est réel : le filtre « non supprimé »
 * (`deleted_at === null`) doit vivre à un seul endroit, dans la fonction qui
 * charge les juges d'un run. Le recopier dans deux lectures, c'est
 * l'oublier dans une troisième — ce chantier a déjà produit deux exemples de
 * cet oubli. */
export interface RunJudge {
  id: string;
  run_id: string;
  judge_id: string;
  /** Copie de `Judge.system_type` au moment de la liaison, épinglée en base
   *  par une clé étrangère composée `(judge_id, system_type) -> judges (id,
   *  system_type)` qui interdit toute divergence entre les deux. N'existe
   *  ici que parce qu'un index unique partiel ne peut pas lire une colonne
   *  d'une autre table : l'invariant « au plus une liaison vivante d'un
   *  system_type donné (non ordinaire) par run » porte sur cette table-ci, il
   *  lui faut donc sa propre colonne. Ne jamais l'écrire indépendamment du
   *  juge réellement lié — c'est à la couche qui crée la liaison de la
   *  recopier depuis le `Judge` visé.
   *
   *  `"ordinary"` — sentinelle, jamais `null` — pour une liaison ordinaire :
   *  voir `JudgeSystemTypeColumn` pour pourquoi. L'index unique partiel
   *  `run_judges_single_system_type_idx` filtre désormais sur
   *  `system_type <> 'ordinary'`, plus sur `is not null`. */
  system_type: JudgeSystemTypeColumn;
  /** Le juge que la matrice affiche. La base garantit AU PLUS une liaison
   *  vivante principale par run — l'index unique partiel
   *  (`run_judges_single_principal_idx`), jamais « exactement une ». Le
   *  « au moins une » qui complète l'invariant tient à un déclencheur à
   *  part, `run_judges_require_principal_trg` : il ne s'arme que sur
   *  `UPDATE` (perdre le principal qu'on avait), jamais sur `INSERT` — créer
   *  la toute première liaison d'un run n'est donc jamais couvert par lui,
   *  et c'est le code applicatif (`judgesForLaunch`, `lib/launch-judges.ts`)
   *  qui pose `is_principal` à la création. Depuis la migration
   *  `20260906154500`, un second déclencheur (`run_judges_require_ordinary_trg`)
   *  et le refus d'un juge système comme principal ou remplaçant composent
   *  pour garantir qu'un run gardant au moins une liaison vivante a toujours
   *  un principal, par construction plutôt que par rattrapage — mais aucun
   *  des deux ne couvre `INSERT` non plus. */
  is_principal: boolean;
  /** `null` tant que la liaison est vivante. On supprime la liaison, jamais
   *  le juge : la ligne reste, marquée, pour qu'on sache encore que ce run a
   *  été jugé par celui-là, à un moment.
   *
   *  « Supprimer », ici, veut dire poser cette colonne — un `UPDATE`, jamais
   *  un `DELETE` : `unlinkJudge` (`lib/runs.ts`) ne fait que ça, via la
   *  fonction RPC `run_judges_unlink`. `JudgeScore` porte bien une clé
   *  étrangère composée vers cette table avec `ON DELETE CASCADE`, mais rien
   *  ne la déclenche jamais en pratique : `service_role` n'a même pas le
   *  droit de `DELETE` sur `run_judges` (seuls `SELECT`, `INSERT`, `UPDATE`
   *  lui sont accordés). Les lignes de `JudgeScore` d'une liaison déliée
   *  restent donc en base, inchangées ; c'est la discipline de lecture —
   *  filtrer sur `deleted_at is null`, une seule fois, dans
   *  `loadLiveRunJudges` (`lib/runs.ts`) — qui porte tout le poids de ne
   *  plus les montrer. */
  deleted_at: string | null;
  created_at: string;
}

/** Les trois valeurs brutes que porte `JudgeScore.status` en base — le CHECK
 *  `judge_scores_status_check`. Elles distinguent quatre situations, pas
 *  trois : `"pending"` avant que le job ne s'en occupe ; `"done"` recouvre à
 *  la fois « noté » (`score` renseigné) et « sans note » (conversation
 *  vide, ou note hors échelle), départagés par la nullité de
 *  `JudgeScore.score` plutôt que par une quatrième valeur de statut ;
 *  `"error"` si le juge est tombé, où `score` reste toujours `null`. C'est
 *  la même distinction à trois que ce produit tient déjà pour une case de
 *  la matrice, à laquelle s'ajoute l'attente : quatre situations réelles,
 *  portées par trois valeurs de colonne plus la nullité de `score`. Ne pas
 *  ajouter une quatrième valeur de statut pour « sans note » : la migration
 *  n'en porte pas, et ce fichier suit la migration. */
export type JudgeScoreStatus = "pending" | "done" | "error";

/** Une ligne de `judge_scores` : ce qu'un juge a trouvé sur une
 *  conversation.
 *
 * Une ligne par (liaison, conversation) — `(run_judge_id, sample_id)` est la
 * clé primaire en base : un juge donne une note et une seule par
 * conversation. C'est ce qui rend une reprise sans danger — elle réécrit la
 * même ligne au lieu d'empiler des doublons.
 *
 * Toutes les lignes existent dès le lancement, en `"pending"` : le job les
 * remplit, il ne les crée pas — exactement comme `EvalSample` le fait déjà
 * pour la matrice elle-même, et pour la même raison la plus forte : cela
 * rend « ce qui reste à juger » un statut à lire plutôt qu'un calcul refait
 * à deux endroits, qui peuvent diverger. */
export interface JudgeScore {
  run_judge_id: string;
  sample_id: string;
  /** Recopié de `RunJudge.run_id` et d'`EvalSample.run_id`. Une ligne connaît
   *  son run par deux chemins, sa liaison et sa conversation, et rien ne
   *  garantit tout seul qu'ils s'accordent — c'est l'invariant que ce champ
   *  protège. En base, deux clés étrangères composées forcent les trois
   *  valeurs à coïncider ; ce champ n'existe ici que pour porter cette même
   *  valeur, jamais à recalculer indépendamment des deux autres. */
  run_id: string;
  status: JudgeScoreStatus;
  /** La note rendue par ce juge, une des valeurs de l'échelle du juge
   *  (`Judge.rubric`). `null` quand rien n'a pu être noté — voir
   *  `JudgeScoreStatus`. */
  score: number | null;
  justification: string;
  /** Pourquoi ce juge n'a rien rendu sur cette conversation. Distinct d'un
   *  score absent : ici il est tombé (`status === "error"`) ; là, il a
   *  répondu mais n'a rien pu noter (`status === "done"`, `score` `null`). */
  error: string | null;
  created_at: string;
}

/** Le verdict d'UN juge sur UNE conversation, tel que l'écran le lit — un
 *  sous-ensemble de `JudgeScore` sans `run_judge_id` ni `sample_id` : les
 *  deux se déduisent déjà d'où cette valeur est rangée, voir
 *  `RunJudgeView.scores`. */
export interface JudgeVerdictEntry {
  status: JudgeScoreStatus;
  score: number | null;
  justification: string;
  error: string | null;
}

/** Un juge vivant d'un run, tel que l'écran le lit : son identité (`judge`),
 *  son rôle sur CE run (`is_principal`, `system_type` — copiés depuis
 *  `run_judges`, voir son commentaire plus haut), et son verdict sur chaque
 *  conversation, par `sample_id`.
 *
 * Jamais un juge supprimé : voir `loadLiveRunJudges` (`runs.ts`), la seule
 * fonction autorisée à filtrer `run_judges` sur `deleted_at` — c'est elle qui
 * alimente `attachJudges`, qui construit ces vues, jamais une lecture
 * séparée de `run_judges`. */
export interface RunJudgeView {
  run_judge_id: string;
  judge: Judge;
  is_principal: boolean;
  system_type: JudgeSystemTypeColumn;
  /** Le verdict de ce juge sur chaque conversation, par `sample_id` — vide
   *  pour un juge dont l'écran n'a demandé que l'identité, pas la note :
   *  voir `attachJudges` (`runs.ts`), qui ne ramène les verdicts complets de
   *  tous les juges vivants que sur demande, pour la même raison de poids
   *  que les transcripts. Une conversation absente d'ici se lit comme en
   *  attente, jamais comme « pas de juge ». */
  scores: Record<string, JudgeVerdictEntry>;
}

/** Un juge secondaire d'un run, en plus du principal — une entrée
 *  d'`EvalRunConfig.judges`.
 *
 * Le juge principal reste décrit par les champs historiques du run —
 * `EvalRunConfig.criterion`, `EvalRunConfig.rubric`, et `EvalModels.judge` —
 * pour que chaque configuration déjà écrite continue de valider sans
 * changement. C'est l'ancienne forme, et elle reste valide : voir
 * `EvalRunConfig.judges`. Cette interface ne porte que ce qui s'ajoute : au
 * lancement, chaque entrée devient un `Judge` et une `RunJudge` non
 * principale, notant les mêmes conversations que le principal.
 *
 * Toujours un juge ordinaire, jamais système : le juge d'éveil est ajouté
 * par le moteur lui-même depuis `EvalRunConfig.check_eval_awareness`, jamais
 * écrit ici. */
export interface JudgeSpec {
  criterion: string;
  rubric: RubricLevel[];
  /** Le modèle qui juge, si différent de celui du run (`EvalModels.judge`).
   *  Absent reprend celui-ci : poser un juge de plus ne devrait pas obliger à
   *  répéter le même modèle quand c'est bien de lui qu'il s'agit. */
  model?: string | null;
}

export interface TemperatureSpec {
  min: number;
  max?: number | null;
}

export interface ScenarioSource {
  kind: "manual" | "csv";
  file_name: string;
  column_title: string;
  column_system_prompt: string;
  column_opening_message: string;
  /** La colonne portant l'historique posé, en JSON. Vide s'il n'y en a pas. */
  column_history?: string;
  /** La colonne disant quels outils le scénario reçoit. Vide s'il n'y en a pas. */
  column_tools?: string;
  /** La colonne portant la note de laboratoire du scénario. */
  column_note?: string;
  /** The column holding each scenario's own world. Empty when there is none —
   *  the common case, a batch usually sharing a single world. */
  column_world?: string;
  skipped_rows: number;
}

/** Ce que l'utilisateur remplit, tel qu'il est stocké dans `eval_runs.config`. */
export interface EvalRunConfig {
  scenarios: EvalScenario[];
  /** Ce que le juge doit regarder. Ce sont les paliers qui portent le jugement. */
  criterion: string;
  /** L'échelle sur laquelle le juge note. Au moins deux paliers. */
  rubric: RubricLevel[];
  /** Les juges secondaires du run, en plus du principal décrit par
   *  `criterion`, `rubric` et `models.judge` ci-dessus.
   *
   * Absent ou vide : une configuration qui ne porte que `criterion` et
   * `rubric` — l'ancienne forme, celle de tous les fichiers déjà écrits —
   * reste valide et décrit un run à un seul juge, le principal. Ajouter des
   * entrées ici est ce qui permet à un agent de poser plusieurs juges d'un
   * coup : au lancement, chacune devient un `Judge` et une `RunJudge` non
   * principale, deux colonnes de notes sur la même matrice plutôt que deux
   * runs qui ne joueraient pas les mêmes conversations et ne se
   * compareraient donc pas. */
  judges?: JudgeSpec[];
  turns: number;
  repetitions: number;
  models: EvalModels;
  adversary_prompt: string;
  /** Ce que contient l'environnement, écrit par l'expérimentateur.
   *
   * Un bloc de texte libre, et il doit le rester : le jour où quelqu'un veut
   * simuler une base, une boîte mail ou un système de tickets, il l'écrit comme
   * il l'écrirait à un collègue. Il porte aussi bien des données que des règles.
   *
   * Au niveau du run parce que les outils doivent s'accorder entre eux :
   * `search_files` et `read_file` racontent le même lecteur partagé, et deux
   * copies divergeraient. Gelé au lancement, comme le critère et l'échelle. */
  world?: string;
  /** Les outils du run, définis une fois et offerts aux scénarios.
   *
   * Au niveau du run parce qu'un outil décrit un monde, pas une situation. */
  tools?: ToolSpec[];
  /** Combien d'appels d'affilée un modèle peut faire avant qu'on lui rende la
   *  main. Le bon nombre dépend de ce qu'on mesure : une tâche à trois étapes ne
   *  se juge pas avec un plafond de un. */
  max_tool_calls_per_turn?: number;
  /** Un second juge dit-il si le modèle évalué s'est su testé ?
   *
   * Optionnel dans le type, vrai par défaut à l'usage : les runs enregistrés
   * avant ce champ n'en portent pas et doivent rester lisibles. Lire
   * `config.check_eval_awareness !== false`, jamais `=== true`. */
  check_eval_awareness?: boolean;
  /** Combien de jetons de sortie une réponse du modèle évalué consomme, en gros.
   *
   * Sert au devis et à rien d'autre : ce nombre ne change pas ce que le run
   * fait. Il compte **tout** ce que le modèle produit à chaque appel —
   * raisonnement compris, pas seulement la réponse qu'on lit. C'est l'unité
   * que les fournisseurs facturent, et un modèle qui réfléchit avant de
   * répondre dépense plusieurs fois sa réponse visible.
   *
   * Optionnel dans le type et obligatoire dans `configProblem` : les runs
   * enregistrés avant ce champ n'en ont pas et doivent rester lisibles. */
  average_output_tokens?: number;
  temperature?: TemperatureSpec | null;
  label?: string | null;
  source?: ScenarioSource | null;
  notes?: string;
}

/** Les colonnes d'un CSV qu'un fichier de configuration annonce sans le porter.
 *
 * Un agent écrit la configuration ; le CSV des scénarios, lui, reste un fichier
 * à part qu'on téléverse ensuite. Nommer les colonnes ici évite de les redeviner
 * — et une devinette se trompe dès qu'un fichier nomme les siennes autrement. */
export interface ExpectedCsv {
  column_title: string;
  column_system_prompt: string;
  column_opening_message: string;
  /** Facultative : la colonne portant l'historique posé, en JSON. */
  column_history?: string;
  /** Facultative : la colonne portant la note de laboratoire du scénario. */
  column_note?: string;
}

/** Ce qu'on ajoute à un run existant : une sous-matrice, et rien d'autre.
 *
 * Ni juge, ni échelle, ni critère : ce qui ne peut pas être envoyé ne peut pas
 * dériver, et deux lots jugés différemment ne seraient plus comparables — ce
 * qu'une matrice existe précisément pour permettre.
 *
 * La température échappe à cette règle, parce qu'elle est portée par chaque
 * case et non par le run : les anciennes gardent la leur quoi qu'il arrive.
 *
 * Le nombre de tours échappe aussi, mais justifié : on ne coupe jamais une
 * conversation déjà jouée, on ne peut que l'allonger. Si on l'approfondit, elle
 * est rejugée entière — un verdict sur quatre tours ne dit rien de la même
 * conversation à huit. Enfin, la profondeur du run reste la même pour toutes
 * ses cases : celle qu'on a demandée. Une case qui s'est arrêtée plus tôt l'a
 * fait parce qu'elle n'avait plus rien à donner ; la forcer au-delà n'apprendrait
 * rien, et la moyenne la compte en équilibre avec les autres. */
export interface ExtendRequest {
  /** Scénarios déjà présents à re-couvrir, par leur index. */
  scenario_indices: number[];
  /** Scénarios nouveaux, ajoutés à la suite de ceux du run. */
  new_scenarios: EvalScenario[];
  /** Modèles à couvrir — déjà évalués ou non, la distinction se fait ici. */
  targets: string[];
  /** Combien de répétitions ajouter à chaque couple retenu. */
  repetitions: number;
  temperature?: TemperatureSpec | null;
  /** Des outils à ajouter au décor du run.
   *
   * Ajouter est permis, redéfinir non : un outil qui reprendrait un nom
   * existant ferait relire les cases déjà jouées comme ayant eu celui-ci. */
  new_tools?: ToolSpec[];
  /** Le modèle qui sert les outils de ce run — ceux qu'il porte déjà comme
   *  ceux que `new_tools` ajoute — quand ce run n'en a pas encore un.
   *
   * Pas seulement les outils ajoutés : un run antérieur à ce champ peut déjà
   * servir sans le nommer, et une extension qui n'ajoute rien de servi doit
   * alors le porter tout autant — c'est le cas que la ligne précédente
   * faisait facilement oublier (voir CRITICAL 2, `ExtendPanel.buildRequest`,
   * qui l'avait niché sous `new_tools.length > 0`).
   *
   * Trois cas, et le troisième est le seul qui surprenne : un run sans modèle
   * de monde qui reçoit un outil servi doit en nommer un, qui devient celui du
   * run ; un run sans modèle à qui rien de servi n'est ajouté refuse qu'on en
   * nomme un, un réglage sans effet étant pire qu'absent ; un run qui sert déjà
   * ses outils l'impose silencieusement — nommer le même passe, une redite
   * sans conséquence, nommer un autre est refusé, deux serveurs dans un même
   * run rendraient ses cases incomparables. Voir `extendProblem`. */
  world?: string | null;
  /** Des juges à poser sur ce run, en plus de ceux qu'il porte déjà.
   *
   * Toujours secondaires : devenir principal est un second geste, explicite.
   * Chacun naît avec une ligne de score en attente sur toutes les
   * conversations du run, que le rattrapage remplit ensuite.
   *
   * Ne se combine avec rien d'autre — ni scénario, ni modèle, ni
   * approfondissement. Le moteur a deux passes distinctes : `run` joue les
   * cases neuves, `catchup` remplit les verdicts manquants sur les
   * conversations déjà finies, et un lancement n'en fait qu'une. Les mêler
   * rendrait la moitié du travail payé et non fait — voir `extendProblem`. */
  new_judges?: JudgeSpec[];
  /** Les scénarios existants qui n'avaient nommé aucun outil — donc « tous
   *  ceux du run » — héritent-ils des nouveaux ?
   *
   * Ne change rien aux cases déjà jouées, qui sont faites : seulement ce que
   * verrait une ré-exécution de ces scénarios, en les recouvrant avec d'autres
   * modèles ou d'autres essais. `false` fige leur liste sur les outils qui
   * existaient, pour qu'ils revoient exactement ce qu'ils ont toujours vu. */
  new_tools_for_existing?: boolean;
  /** La profondeur voulue pour le run. Jamais inférieure à l'actuelle : une
   *  conversation déjà jouée ne se coupe pas. Absent laisse la profondeur
   *  telle quelle. */
  turns?: number;
  /** Les essais à continuer jusqu'à `turns`, choisis par la note que le juge
   *  leur a donnée : le serveur retrouve lui-même lesquels, puisque c'est lui
   *  qui a les notes.
   *
   * Un ensemble quelconque et non un rectangle : les essais d'une même case
   * n'ont pas tous la même note, et on approfondit ce qui a tenu en laissant
   * ce qui a déjà cédé — `"all"` pour tous les essais notés du run, une liste
   * de notes pour ne prendre que celles-là. Absent n'approfondit rien. */
  deepen?: "all" | number[];
}

/** Une entrée d'`EvalRun.extensions` : ce qu'une extension a demandé, quand,
 *  par qui, par quelle porte, et ce qu'elle a coûté — voir la migration
 *  `evals/supabase/migrations/20260905203414_run_extensions_log.sql` pour le
 *  raisonnement complet.
 *
 * `cost_before_usd` est le cœur du dessin : le coût total du run juste avant
 * que cette extension ne s'applique, jamais recalculé après coup. C'est lui
 * qui rend le coût réel de chaque extension déductible sans jamais revenir
 * écrire — voir `extensionsOf` dans `run-extensions.ts`. */
export interface RunExtensionLogEntry {
  at: string;
  by: string;
  /** Par quelle porte l'extension est entrée.
   *
   * `"script"` n'est pas une porte de l'application : c'est une écriture faite
   * hors d'elle, par un script tenant la clé de service — le chantier des
   * juges multiples en a laissé une, qui a ajouté un juge à un run existant.
   * Ce journal étant du jsonb libre, rien en base n'empêchait cette valeur, et
   * ce type l'ignorait : `"script"` était en base sans être déclaré ici.
   *
   * Déclaré plutôt qu'interdit. Le passé est écrit et ne se relit pas
   * autrement, et le nier laissait un `via` réel filer dans du code qui le
   * croyait impossible. Les portes vivantes restent `ui` et `mcp` : rien dans
   * l'application n'écrit `"script"`. */
  via: "ui" | "mcp" | "script";
  /** La demande telle qu'elle a été faite. */
  request: ExtendRequest;
  /** Le devis calculé à ce moment-là. `null` seulement en théorie —
   *  `extendRun` ne pose jamais d'entrée pour une extension qui n'ajoute et
   *  n'approfondit rien, le seul cas où `planExtension` ne chiffre rien. */
  estimate: CostEstimate | null;
  /** Le coût total du run juste avant cette extension. `null` quand ce coût
   *  n'est lui-même pas connu — run qui n'a encore rien coûté, ou dont un
   *  modèle employé n'a pas de tarif — jamais remplacé par 0, qui affirmerait
   *  à tort une gratuité ou un tarif complet. */
  cost_before_usd: number | null;
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Écrit par l'expérimentateur, pas produit par un modèle. */
  seeded?: boolean;
  /** Les outils que ce tour d'assistant a décidé d'appeler. */
  tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  /** Sur un tour `tool` : l'outil qui a « répondu ». */
  tool_name?: string | null;
  /** Sur un tour `tool` : l'appel auquel ce résultat répond. */
  tool_call_id?: string | null;
  /** `content_filter` quand le fournisseur a bloqué la génération. */
  stop_reason?: string | null;
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  input_tokens_cache_read: number;
  input_tokens_cache_write: number;
  reasoning_tokens: number;
}

/** Une ligne d'`eval_runs`. */
export interface EvalRun {
  id: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  user_email: string;
  label: string | null;
  status: RunStatus;
  error: string | null;
  config: EvalRunConfig;
  notes: string;
  /** Écrite après coup, distincte de `notes` qui est le préambule. Jamais
   *  portée par `config` : une duplication ne la reprend pas. */
  analysis: string;
  /** Publié : `/shared/<id>` répond hors session. Écrit par la seule route
   *  `/api/runs/<id>/publish`. */
  is_public: boolean;
  /** Écarté des listes et de la lecture publique. Rien n'est effacé. */
  deleted_at: string | null;
  total_samples: number;
  usage: Record<string, ModelUsage>;
  cost_usd: number | null;
  rejudged_at: string | null;
  /** Quand le juge d'éveil a été passé après coup, s'il l'a été. La
   *  configuration continue de dire ce qui avait été demandé au lancement. */
  awareness_judged_at: string | null;
  execution: string | null;
  /** Où le job a tourné : sur une machine de développement, ou sur Cloud Run. */
  origin: "local" | "cloud-run";
  /** Le devis calculé au lancement, à comparer à `cost_usd`. null sur les runs
   *  antérieurs à son enregistrement. */
  estimate: CostEstimate | null;
  /** Ce que ce run a subi depuis sa création, dans l'ordre : une entrée par
   *  extension, quelle que soit la porte — écran ou MCP. Vide sur un run
   *  qui n'a jamais été étendu. Voir `RunExtensionLogEntry`. */
  extensions: RunExtensionLogEntry[];
  /** Le brouillon dont ce run est sorti, s'il en vient d'un. Plusieurs runs
   *  peuvent désigner le même : relancer un brouillon est prévu. Sans clé
   *  étrangère — la provenance survit à la disparition du brouillon, et
   *  l'identifiant peut donc ne plus rien désigner. */
  draft_id: string | null;
  /** Qui a appuyé sur « lancer » : l'interface, ou un outil MCP.
   *
   * Ne borne plus le budget d'un appelant MCP — `mcp_launches` s'en charge
   * désormais, une ligne par lancement plutôt qu'une colonne par run, ce
   * qu'une extension exige : elle écrit sur un run existant, que le budget
   * d'un agent qui l'agrandit ne doit pas confondre avec celui d'un autre
   * agent, ou d'un humain, qui y aurait aussi touché. Cette colonne répond
   * encore, et seulement, à « ce run a-t-il été démarré par un agent ? » —
   * une question que `mcp_launches` ne pose pas pour une extension, qui ne
   * crée aucun run. Défaut `'ui'` en base : les runs d'avant cette colonne
   * n'ont jamais pu venir d'ailleurs. */
  launched_via: "ui" | "mcp";
}

/** Une ligne de `mcp_launches` : un lancement réussi par un outil MCP, `run`
 *  comme `extend`.
 *
 * C'est elle, et seulement elle, que somme le budget de l'heure glissante —
 * voir `mcp-budget.ts`. `run_id` désigne le run créé (`kind: "run"`) ou agrandi
 * (`kind: "extend"`) ; plusieurs lignes peuvent donc désigner le même run,
 * chacune par un lancement distinct. `quoted_usd` est le devis qui a décidé du
 * lancement, jamais recalculé après coup : un coût réel n'existe qu'une fois
 * le run fini, et ce n'est pas encore le cas au moment d'écrire cette ligne. */
export interface McpLaunch {
  id: string;
  user_email: string;
  run_id: string;
  kind: "run" | "extend";
  quoted_usd: number;
  created_at: string;
}

/** Une ligne de `profiles` : les deux plafonds d'un agent lancé par cette
 *  personne, propres à elle plutôt qu'à tout le monde — voir `profiles.ts`.
 *  Créée dès qu'une identité authentifiée se présente, par l'écran ou par
 *  MCP ; jamais supprimée, pour qu'un plafond baissé ne remonte pas tout
 *  seul. */
export interface Profile {
  user_email: string;
  max_usd_per_run: number;
  max_usd_per_hour: number;
  created_at: string;
  /** Le conseil d'écriture de scénario, tel que cette personne l'a réécrit.
   *
   * `null` — le cas courant — veut dire « utilise le défaut du code ». Le
   * défaut n'est jamais recopié ici : sinon l'améliorer n'atteindrait plus
   * personne, chacun traînant la version du jour de son inscription. Revenir
   * au défaut, c'est remettre `null`. */
  scenario_advice: string | null;
  /** Les modèles que cette personne veut voir proposés.
   *
   * `null` — le cas courant — veut dire « utilise le défaut du code », par
   * `favoriteModels` dans `favorite-models.ts`. Le défaut n'est jamais
   * recopié ici, pour la même raison que `scenario_advice` : l'enrichir
   * n'atteindrait plus personne. Ne borne que ce qui est PROPOSÉ ; la
   * validation d'un run, elle, accepte tout le catalogue. */
  favorite_models: string[] | null;
}

/** Ce que `mcp_launches` dit de la dernière heure, pour une personne : combien
 *  de lancements, et pour quel devis additionné — voir `mcpActivityLastHour`
 *  dans `runs.ts`. Sert la page de profil, jamais une décision de budget, qui
 *  ne garde que le montant. */
export interface ProfileActivity {
  count: number;
  usd: number;
}

/** Une ligne d'`eval_samples` : une case de la matrice.
 *
 * Depuis les juges multiples, cette interface ne porte plus la note d'une
 * conversation : `score`, `justification`, `awareness_score`,
 * `awareness_justification` et `awareness_error` ont été retirées d'ici
 * *parce que* la migration
 * `evals/supabase/migrations/20260906093000_drop_eval_samples_score_columns.sql`
 * (dépôt polaris-supabase) les a supprimées de la table — les laisser ici
 * aurait laissé compiler tranquillement du code déjà mort à l'exécution
 * contre la vraie base. Ce que rendait un juge sur une conversation vit
 * désormais dans `JudgeScore`, une ligne par (juge, conversation) ; voir
 * `matrix.ts`, `awareness.ts` et `deepen-counts.ts` pour la forme que prend
 * la jointure côté lecture (`MatrixSample`, `JudgeVerdict`, `DeepenSample`). */
export interface EvalSample {
  id: string;
  run_id: string;
  scenario_index: number;
  scenario_title: string;
  target_model: string;
  repetition: number;
  status: SampleStatus;
  temperature: number | null;
  /** Combien de tours cette case a réellement joués.
   *
   * `null` tant qu'elle n'a pas tourné. Une case plus courte que la profondeur
   * du run n'est pas incomplète : elle s'est réglée là, et l'y pousser plus
   * loin n'aurait rien appris. */
  turns_done: number | null;
  messages: Message[];
  /** L'exécution de la conversation a-t-elle échoué — jamais le juge, qui a
   *  sa propre colonne d'erreur sur `JudgeScore`. `null` pour une case qui a
   *  fini de jouer normalement, quel que soit ensuite le verdict du juge. */
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  /** Jetons consommés par cette case, par modèle. */
  usage: Record<string, ModelUsage>;
  /** Ce que cette case a coûté, ou null si un modèle employé n'a pas de tarif. */
  cost_usd: number | null;
}

/** Où en est un run, compté sur ses cases. */
export interface Progress {
  total: number;
  done: number;
  running: number;
  pending: number;
  errored: number;
  cancelled: number;
}

/** Une case de la matrice : ce qu'un modèle a obtenu sur un scénario.
 *
 * Quatre façons de ne pas avoir de note, et elles ne se confondent pas : une
 * case traitée sans note (conversation bloquée, réponse hors échelle), une case
 * en panne, une case jamais commencée parce qu'on a arrêté le run, et une case
 * encore à faire. Les mélanger effacerait la différence entre « on ne sait
 * pas », « ça a cassé » et « on a décidé de ne pas le faire ». */
export interface Cell {
  judged: number;
  unjudged: number;
  errored: number;
  /** Jamais commencée : le run a été arrêté avant d'y arriver. */
  cancelled: number;
  /** Notée « sans objet » : le juge a répondu, mais hors moyenne. */
  excluded: number;
  pending: number;
  mean: number | null;
  /** Combien de fois chaque note a été donnée dans cette case.
   *
   * Une moyenne ne distingue pas un consensus d'un partage : 1,8 peut être
   * cinq essais serrés ou un 0 et quatre 2, et sur un scénario comportemental
   * c'est toute la différence entre « le modèle hésite » et « le modèle fait
   * deux choses opposées selon les fois ».
   *
   * Ne compte que ce qui entre dans la moyenne : un « sans objet » est une
   * réponse, pas une note, et vit dans `excluded`. */
  grades: Record<string, number>;
  /** Somme de ce qu'ont coûté les cases de cette case de matrice. */
  cost_usd: number;
  /** Combien de tentatives de cette case ont montré qu'elles se savaient
   *  testées, au même seuil que le voyant du run (AWARENESS_ALARM) et pas un
   *  autre : la somme de ce compte sur toutes les cases doit toujours
   *  retomber sur le chiffre que le voyant annonce, sans quoi les deux se
   *  contrediraient sur le même écran. */
  awareness_flagged: number;
}

/** Un run tel que la LISTE WEB le montre — jamais sa configuration entière.
 *
 * `RunSummary`, juste en dessous, porte l'`EvalRun` complet parce que la
 * recherche MCP fouille les notes, l'analyse et le critère de chaque run.
 * L'écran, lui, ne lit de la configuration que trois choses : l'échelle, le
 * titre du premier scénario, et deux comptes.
 *
 * L'écart n'est pas théorique. Sur les treize runs d'aujourd'hui, la
 * configuration complète pèse 72 Ko contre 3,3 Ko pour les colonnes affichées
 * — 95 % de la charge utile pour trois valeurs lues, l'essentiel étant les
 * prompts système et les messages d'ouverture de chaque scénario. Et cette
 * charge repartait toutes les trois secondes tant qu'un run tournait.
 *
 * D'où deux formes et deux chargements, plutôt qu'un seul élargi : voir
 * `loadRunList` et `loadRuns` (`lib/runs.ts`). */
export interface RunListRun {
  id: string;
  created_at: string;
  user_email: string;
  label: string | null;
  status: RunStatus;
  cost_usd: number | null;
  is_public: boolean;
  origin: "local" | "cloud-run";
  /** Qui a appuyé sur le bouton, pour CE run — jamais pour ce qui lui a été
   *  ajouté après. Un brouillon soumis par un agent puis lancé d'un clic
   *  humain vaut donc `ui` : c'est le lancement qui compte, pas la rédaction.
   *  Les extensions, elles, ne créent aucun run et sont comptées ailleurs
   *  (`mcp_launches`) — voir `EvalRun.launched_via`. */
  launched_via: "ui" | "mcp";
  /** L'échelle du juge principal : la liste en tire les bornes affichées. */
  rubric: RubricLevel[];
  /** Le titre du premier scénario — l'étiquette de repli d'un run sans nom.
   *  Le premier seul, pas les autres : c'est tout ce qui est affiché. */
  first_scenario_title: string | null;
  /** Compté sur les cases, pas sur la configuration : celle-ci n'est plus
   *  ramenée, et la matrice est écrite entière dès la création du run. */
  scenario_count: number;
  target_count: number;
}

/** Une ligne de la liste web. Même forme que `RunSummary` autour d'un run
 *  réduit, pour que la page n'ait à changer que là où elle lisait `config`. */
export interface RunListItem {
  run: RunListRun;
  progress: Progress;
  mean: number | null;
  /** Comme `RunSummary.repetitions` : le moins et le plus d'essais par case. */
  repetitions: [number, number];
}

/** Un run dans la liste : de quoi trier et décider d'ouvrir.
 *
 * Ne sert plus la liste web depuis `RunListItem` ci-dessus — seulement la
 * recherche MCP, qui a besoin du texte entier de chaque run. */
export interface RunSummary {
  run: EvalRun;
  progress: Progress;
  mean: number | null;
  /** Combien d'essais par case : le moins, le plus.
   *
   * Deux chiffres et non un seul, parce qu'un run qu'on a complété n'avance pas
   * au même rythme partout. `config.repetitions` ne dit plus que ce qui avait
   * été demandé au dernier lot. */
  repetitions: [number, number];
}

/** Un run soumis par un agent, sauvegardé sans être lancé.
 *
 * Le geste de lancer reste un clic humain : c'est toute la raison d'être de
 * cette table plutôt que d'un run créé directement. */
/** Ce que tout brouillon porte, quoi qu'il propose. */
interface DraftCommon {
  id: string;
  csv_text: string | null;
  created_by: string;
  created_at: string;
  /** `manual` : enregistré depuis le formulaire, possiblement incomplet — on y
   *  revient plus tard. `mcp` : soumis par un agent, donc valide au moment où
   *  il a été écrit. */
  origin: "manual" | "mcp";
  /** Jeté : sort de la liste, et son adresse ne répond plus. */
  deleted_at: string | null;
  /** Lancé : sort de la liste, mais son adresse reste ouverte — on peut vouloir
   *  relancer la même chose. */
  launched_at: string | null;
  /** Ce qu'il a produit, s'il a été lancé. Répond après coup à « d'où vient ce
   *  run ». */
  launched_run_id: string | null;
}

/** Un run à lancer. */
export interface RunDraft extends DraftCommon {
  kind: "run";
  config: EvalRunConfig;
  extends_run_id: null;
}

/** Une sous-matrice à ajouter à un run existant.
 *
 * `config` porte une `ExtendRequest` : c'est la même colonne en base, et
 * `kind` dit comment la lire. L'union discriminée fait le reste — lire une
 * `EvalRunConfig` sur un brouillon d'extension ne compile pas.
 *
 * Rien n'est appliqué au run tant qu'il n'est pas lancé, outils proposés
 * compris : un brouillon qu'on jette doit laisser le run intact. */
export interface ExtendDraft extends DraftCommon {
  kind: "extend";
  config: ExtendRequest;
  extends_run_id: string;
}

export type Draft = RunDraft | ExtendDraft;

/** Un brouillon tel que la route de lecture le rend : son contenu, plus un
 *  verdict que seule la session peut trancher.
 *
 * Le navigateur ne connaît jamais l'adresse de l'utilisateur courant — c'est
 * la route qui la lie à la session — donc il ne peut pas comparer lui-même
 * `created_by` à qui regarde. `mine` porte ce verdict déjà tranché : c'est ce
 * qui permet d'annoncer « Save as my own copy » avant même d'enregistrer,
 * plutôt que de le découvrir après coup par une redirection silencieuse. */
export type DraftRead = Draft & { mine: boolean };

/** Un run ouvert : sa configuration, ses cases, sa matrice. */
export interface RunDetail {
  run: EvalRun;
  samples: EvalSample[];
  progress: Progress;
  source_csv_available: boolean;
  /** Combien de lignes de `judge_scores` restent à remplir sur ce run — pour
   *  n'importe quel juge vivant, sur une conversation déjà terminée. Voir
   *  `catchupMissingTotal`, `lib/runs.ts` : calculé sur demande seulement, et
   *  jamais sans vérifier que la conversation visée est bien `done` — le
   *  moteur (`catchup_dataset`, `backend/playground/batch_job.py`) ne
   *  rattrape jamais une conversation qui ne l'est pas, et un compte qui
   *  l'oublierait annoncerait du travail qu'un rattrapage ne ferait jamais. */
  catchup_missing: number;
  /** Les juges vivants du run, avec leur verdict sur chaque conversation —
   *  voir `RunJudgeView`. `undefined` quand non demandé (voir `loadRun`'s
   *  `withJudges`) : la quasi-totalité des appelants de `loadRun` ne
   *  regardent jamais les juges, seulement l'existence du run. */
  judges?: RunJudgeView[];
  /** Les résultats d'outils servis depuis le monde, avec le verdict du
   *  contrôle sur chacun — voir `lib/served.ts`. `undefined` quand non
   *  demandé (voir `withToolResults`) : la quasi-totalité des runs n'en a
   *  aucun, et la liste ne doit pas payer une lecture par run pour une table
   *  le plus souvent vide. */
  tool_results?: import("./served").ToolResultRow[];
}

export interface ModelOption {
  id: string;
  label: string;
  /** Prix en dollars par million de jetons, ou null si le modèle n'est pas tarifé. */
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  /** Le fournisseur tient-il compte de la température qu'on lui envoie ?
   *
   * `false` ne veut pas dire que l'appel échoue : Claude 4.7 et au-delà
   * tournent en adaptive thinking et refusent le paramètre, `inspect_ai` le
   * retire et l'appel réussit sans lui. C'est ce qui rend le piège traître —
   * un balayage de température sur ces modèles ne mesure que du bruit, et
   * rien dans la réponse ne le dit. */
  honours_temperature: boolean;
  /** Ce modèle est-il dans les favoris de qui regarde ?
   *
   * Posé par `catalog()` à partir de la liste qu'on lui passe, jamais lu
   * dans le fichier partagé : les favoris sont propres à une personne, le
   * catalogue est commun à tout le monde. */
  favorite: boolean;
}

export interface ProviderInfo {
  id: string;
  label: string;
  env_vars: string[];
  key_present: boolean;
  models: ModelOption[];
}

/** Ce qu'un modèle coûte dans un run, et sur quelle hypothèse. */
/** À quel titre un modèle est appelé dans un run.
 *
 * Les mots du code — ceux du YAML, de `models.world` et des messages d'erreur —
 * pour que ce qu'on lit dans le devis se retrouve tel quel dans le fichier
 * qu'on édite.
 *
 * Pas de `awareness` : le juge d'éveil tourne sur `models.judge`, au même tarif
 * et sur la même conversation qu'un juge ordinaire. Il est compté dans la ligne
 * `judge` de ce modèle, et c'est le libellé de la ligne qui le nomme. */
export type ModelRole =
  | "evaluated"
  | "adversary"
  | "judge"
  | "world"
  | "check";

/** Ce qu'un modèle coûte **à un titre donné**, et sur quelle hypothèse.
 *
 * Une ligne par (rôle, modèle), et non par modèle : un `claude-sonnet-5` évalué
 * et juge dans le même run est la configuration ordinaire, et fondre ses deux
 * dépenses empêchait de voir ce qu'un réglage coûte. Voir
 * docs/superpowers/specs/2026-09-08-devis-par-role-design.md. */
export interface ModelCost {
  model: string;
  /** Absent sur les devis pris avant ce découpage — ils sont stockés sur les
   *  runs et les brouillons, et ne sont jamais recalculés : le devis affiché
   *  sur un run lancé doit rester celui qui a été pris au lancement, sans quoi
   *  l'écart au coût réel cesserait de mesurer la dérive de l'estimation pour
   *  mesurer le mouvement des tarifs. Une ligne sans rôle s'affiche sans
   *  étiquette. */
  role?: ModelRole;
  /** Les appels de modèle que cette ligne compte.
   *
   * Facultatif pour la même raison que `role`, et il faut le traiter avec la
   * même méfiance : une ligne relue d'un devis stocké avant ce découpage n'en
   * porte pas. Le type dirait le contraire qu'une addition y trouverait
   * `undefined` et rendrait `NaN` — un total faux, affiché sans broncher. */
  calls?: number;
  /** Ce nombre est-il un pari ? Vrai pour `world` et `check` seulement, et pour
   *  deux raisons qui jouent dans le même sens : rien ne déclare combien
   *  d'outils le modèle évalué appellera, et le cache `tool_results` supprime
   *  la plupart des appels restants. Le chiffre est donc un **plafond** —
   *  jamais un plancher. */
  assumed?: boolean;
  input_tokens: number;
  output_tokens: number;
  response_tokens: number;
  /** null si le modèle n'a pas de tarif connu. */
  usd: number | null;
}

/** Sur quelle longueur de sortie un devis repose. Jumeau de `LengthAssumption`
 *  côté Python — les deux doivent accepter exactement les mêmes formes. */
export interface LengthAssumption {
  /** Les réponses du modèle évalué : un nombre pour tous les scénarios, ou un
   *  par scénario dans l'ordre de `config.scenarios`. */
  answer?: number | number[] | null;
  /** Les tours d'adversaire, qui dépendent de sa consigne et non du scénario.
   *  Absent, il prend la longueur déclarée du run. */
  adversary?: number | null;
}

export interface CostEstimate {
  /** La longueur supposée, ou null si elle varie d'un scénario à l'autre. */
  response_tokens: number | null;
  usd: number;
  eur: number;
  min_usd: number;
  max_usd: number;
  min_eur: number;
  max_eur: number;
  conversations: number;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  /** Le détail, du plus cher au moins cher. C'est lui qui explique un total. */
  per_model: ModelCost[];
  unpriced_models: string[];
}

/** Un tag, et la couleur qu'il gardera. */
export interface Tag {
  id: number;
  label: string;
  color: string;
}

export interface JudgePromptPreview {
  system_message: string;
  user_message: string;
}

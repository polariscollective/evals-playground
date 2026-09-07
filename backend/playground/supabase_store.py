"""Lecture et écriture des runs d'évaluation dans Supabase.

Un client PostgREST minimal plutôt que le SDK `supabase-py` : le job ne fait
qu'une poignée d'opérations sur deux tables, et une dépendance qui traîne son
propre client HTTP, sa gestion d'authentification et son moteur de requêtes
coûterait plus à comprendre qu'elle ne fait gagner.

La clé de service contourne RLS, qui est actif sans aucune politique sur ce
projet. Elle ne doit donc jamais quitter le serveur : ce module est importé par
le job Cloud Run, jamais par du code qui atteint un navigateur.
"""

import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

RUNS = "eval_runs"
SAMPLES = "eval_samples"
# Les trois tables des juges multiples — voir `Judge`, `RunJudge` et
# `JudgeScore` dans eval_schemas.py, et la migration
# `evals/supabase/migrations/20260906092100_create_judges_tables.sql` (dépôt
# polaris-supabase), qui fait foi sur leur forme réelle.
JUDGES = "judges"
RUN_JUDGES = "run_judges"
JUDGE_SCORES = "judge_scores"
TOOL_RESULTS = "tool_results"

TOOL_RESULT_KEY = "run_id,scenario_index,tool_name,arguments_hash"
"""La clé primaire de `tool_results`, telle que PostgREST veut l'entendre.

Écrite une fois : elle sert à l'insertion qui ignore les doublons, et doit
désigner exactement la contrainte que la migration a posée — sans quoi
PostgREST rejette l'écriture au lieu de la dédoublonner.
"""

NOW = "now()"
"""Horodatage confié à la base plutôt qu'à l'horloge du job.

PostgREST transmet la valeur telle quelle et PostgreSQL la reconnaît en entrée
d'un `timestamptz` — vérifié par aller-retour, ce n'est pas une supposition.
Toutes les horodates viennent ainsi de la même horloge que `updated_at`, posé
par déclencheur côté serveur : c'est cette cohérence qui rend comparable
l'écart sur lequel repose la détection des runs abandonnés.
"""


class SupabaseError(RuntimeError):
    """Une requête PostgREST a échoué.

    Porte le corps de la réponse : PostgREST y met le nom de la contrainte
    violée ou la colonne fautive, qui sont la seule chose utile pour comprendre.
    """


@dataclass
class Supabase:
    """Le strict nécessaire de PostgREST, sur une base Supabase.

    `client` est injectable pour que les tests n'aient besoin ni de réseau ni de
    base : c'est le seul point par lequel ce module touche le monde extérieur.
    """

    url: str
    key: str
    client: httpx.Client | None = None

    @classmethod
    def from_env(cls) -> "Supabase":
        """Construit le client depuis l'environnement.

        Échoue tout de suite si les variables manquent : un job qui démarre sans
        base écrirait ses résultats dans le vide pendant une heure avant que
        quiconque s'en aperçoive.
        """
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise SupabaseError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set."
            )
        return cls(url=url.rstrip("/"), key=key)

    def _client(self) -> httpx.Client:
        if self.client is None:
            self.client = httpx.Client(
                base_url=self.url,
                headers={"apikey": self.key, "Authorization": f"Bearer {self.key}"},
                timeout=30.0,
            )
        return self.client

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        prefer: str | None = None,
    ) -> Any:
        headers = {"Prefer": prefer} if prefer else None
        response = self._client().request(
            method, path, params=params, json=json, headers=headers
        )
        if response.status_code >= 400:
            raise SupabaseError(
                f"{method} {path} → {response.status_code}: {response.text[:500]}"
            )
        return response.json() if response.content.strip() else None

    def select(self, table: str, **params: Any) -> list[dict]:
        return self._request("GET", f"/rest/v1/{table}", params=params) or []

    def insert(
        self,
        table: str,
        rows: Any,
        *,
        returning: bool = False,
        on_conflict: str | None = None,
    ) -> list[dict]:
        """Insère, en laissant éventuellement passer les doublons.

        `on_conflict` nomme les colonnes de la contrainte à ignorer. Avec lui,
        une ligne déjà présente n'est plus une erreur : elle est simplement
        laissée telle quelle. C'est ce qui permet à deux écrivains concurrents
        de viser la même clé sans que le second fasse tomber le job — mais la
        réponse ne dit alors pas laquelle des deux lignes vit, d'où la
        relecture systématique chez les appelants (voir `write_tool_result`).
        """
        prefer = "return=representation" if returning else "return=minimal"
        if on_conflict is not None:
            prefer = f"resolution=ignore-duplicates,{prefer}"
        return (
            self._request(
                "POST",
                f"/rest/v1/{table}",
                params={"on_conflict": on_conflict} if on_conflict else None,
                json=rows,
                prefer=prefer,
            )
            or []
        )

    def update(self, table: str, values: dict, **filters: Any) -> None:
        self._request("PATCH", f"/rest/v1/{table}", params=filters, json=values)

    def rpc(self, function: str, arguments: dict | None = None) -> Any:
        return self._request("POST", f"/rest/v1/rpc/{function}", json=arguments or {})


# --- les runs ----------------------------------------------------------------


def fetch_run(supabase: Supabase, run_id: str) -> dict:
    """Le run demandé, ou une erreur explicite s'il n'existe pas.

    Raises:
        SupabaseError: si aucun run ne porte cet identifiant. Un job lancé sur
            un identifiant inconnu doit s'arrêter là, pas tourner à vide.
    """
    rows = supabase.select(RUNS, id=f"eq.{run_id}", select="*", limit=1)
    if not rows:
        raise SupabaseError(f"Unknown evaluation run: {run_id!r}")
    return rows[0]


def pending_samples(supabase: Supabase, run_id: str) -> list[dict[str, Any]]:
    """Les cases qu'il reste à dérouler, dans l'ordre de la matrice.

    C'est la seule source de ce que le job doit faire. Reconstruire la matrice
    depuis la configuration refait tout, y compris ce qui est déjà noté : ni la
    reprise des erreurs ni l'ajout de scénarios à un run existant ne seraient
    possibles.

    `turns_done` et `messages` voyagent aussi : une case remise en attente
    pour être approfondie les porte déjà, et c'est à leur présence que
    `pending_dataset` reconnaît une conversation à prolonger plutôt qu'à
    rejouer.

    `usage` et `cost_usd` voyagent pour la même raison : une case approfondie a
    déjà été facturée une première fois, et c'est ce qu'elle porte ici qui
    permet à `batch_job.enregistre` d'ajouter la nouvelle passe à l'ancienne
    plutôt que de l'effacer.

    `id` voyage aussi, depuis les juges multiples : c'est par lui que
    `write_judge_score` vise `judge_scores.sample_id`, qui n'a pas
    d'équivalent dans le quadruplet (`scenario_index`, `target_model`,
    `repetition`) que le reste de ce module utilise pour désigner une case.
    """
    return supabase.select(
        SAMPLES,
        run_id=f"eq.{run_id}",
        status="eq.pending",
        select=(
            "id,scenario_index,target_model,repetition,temperature,turns_done,"
            "messages,usage,cost_usd"
        ),
        order="scenario_index,target_model,repetition",
    )


def start_run(supabase: Supabase, run_id: str, execution: str | None = None) -> None:
    """Marque le run comme démarré.

    `error` est remis à blanc : une passe qui reprend après un échec ne doit pas
    traîner le message de la précédente.
    """
    values: dict[str, Any] = {
        "status": "running",
        "started_at": NOW,
        "error": None,
    }
    if execution:
        values["execution"] = execution
    supabase.update(RUNS, values, id=f"eq.{run_id}")


def finish_run(
    supabase: Supabase,
    run_id: str,
    *,
    usage: dict[str, Any] | None = None,
    cost_usd: float | None = None,
    error: str | None = None,
    cancelled: bool = False,
) -> None:
    """Termine le run, qu'il ait abouti, échoué ou été arrêté.

    La consommation est enregistrée dans les trois cas : les jetons déjà brûlés
    l'ont été, et ne pas les inscrire laisserait croire un run interrompu
    gratuit.
    """
    supabase.update(
        RUNS,
        {
            "status": "cancelled" if cancelled else ("error" if error else "done"),
            "error": error,
            "finished_at": NOW,
            "usage": usage or {},
            "cost_usd": cost_usd,
        },
        id=f"eq.{run_id}",
    )


def run_status(supabase: Supabase, run_id: str) -> str:
    """Le statut du run, et rien d'autre.

    Une seule colonne : cette lecture est faite avant chaque case, et ramener la
    configuration complète — scénarios, prompts, échelle — à chaque fois pour
    lire un mot serait absurde.
    """
    rows = supabase.select(RUNS, id=f"eq.{run_id}", select="status", limit=1)
    return str(rows[0]["status"]) if rows else ""


@dataclass
class Cancellation:
    """L'arrêt demandé par l'utilisateur, vu depuis le job.

    L'arrêt est coopératif : l'interface écrit `cancelled` sur le run, et le job
    le lit avant chaque case. Tuer l'exécution Cloud Run serait plus brutal sans
    être plus propre — le conteneur mourrait en pleine écriture, les cases
    resteraient `running` pour toujours, et il faudrait quand même attendre le
    ramassage. Ici le job se termine lui-même.

    La réponse est mise en cache une seconde : consultée avant chaque appel de
    modèle, elle serait sinon relue des milliers de fois pour un mot qui change
    au plus une fois. Une seconde est court devant la durée d'un appel, donc
    l'arrêt reste franc — un cache plus long, lui, laissait passer toute une
    vague d'appels et rendait la fonction inopérante.
    """

    supabase: Supabase
    run_id: str
    ttl_seconds: float = 1.0

    _stopped: bool = field(default=False, init=False)
    _checked_at: float = field(default=0.0, init=False)

    def stopped(self) -> bool:
        """L'utilisateur a-t-il demandé l'arrêt ?

        Une fois vrai, le reste vrai sans redemander : un run annulé ne se
        désannule pas, et le job n'a plus qu'à sortir.

        Une lecture en échec — réseau, base indisponible — répond « non ». Un
        run qui continue malgré une demande d'arrêt est un désagrément ; un run
        qui s'arrête parce que le réseau a hoqueté détruit du travail payé.
        """
        if self._stopped:
            return True
        maintenant = time.monotonic()
        if maintenant - self._checked_at < self.ttl_seconds:
            return False
        self._checked_at = maintenant
        try:
            self._stopped = run_status(self.supabase, self.run_id) == "cancelled"
        except SupabaseError:
            return False
        return self._stopped


# --- les échantillons --------------------------------------------------------


def sample_filters(
    run_id: str, scenario_index: int, target_model: str, repetition: int
) -> dict[str, str]:
    """Les filtres qui désignent exactement une case de la matrice.

    Le quadruplet est la contrainte d'unicité de la table : viser par lui plutôt
    que par l'identifiant de ligne rend l'écriture idempotente, donc une reprise
    de job sans danger.
    """
    return {
        "run_id": f"eq.{run_id}",
        "scenario_index": f"eq.{scenario_index}",
        "target_model": f"eq.{target_model}",
        "repetition": f"eq.{repetition}",
    }


def mark_sample_running(
    supabase: Supabase,
    run_id: str,
    scenario_index: int,
    target_model: str,
    repetition: int,
) -> None:
    supabase.update(
        SAMPLES,
        {"status": "running", "started_at": NOW},
        **sample_filters(run_id, scenario_index, target_model, repetition),
    )


def mark_awareness_judged(supabase: Supabase, run_id: str) -> None:
    """Note que le juge d'éveil est passé sur ce run après coup.

    La configuration n'est pas touchée : elle dit ce qui a été demandé au
    lancement, et c'est une information qu'on veut garder. Sans cette date,
    rien ne distinguerait un run lancé avec le juge d'un run auquel on l'a
    ajouté ensuite.
    """
    supabase.update(RUNS, {"awareness_judged_at": NOW}, id=f"eq.{run_id}")


def cancel_unfinished_samples(supabase: Supabase, run_id: str) -> None:
    """Marque `cancelled` les cases qui ne seront pas faites.

    Distinct du ramassage en erreur : une case qu'on a décidé de ne pas faire
    n'est pas une case qui a cassé, et la matrice doit pouvoir les compter
    séparément.
    """
    supabase.update(
        SAMPLES,
        {"status": "cancelled", "finished_at": NOW},
        run_id=f"eq.{run_id}",
        status="in.(pending,running)",
    )


def abandon_unfinished_samples(
    supabase: Supabase, run_id: str, reason: str
) -> None:
    """Termine en erreur les cases qu'aucun juge n'a atteintes.

    Un échantillon dont le solver a échoué ne passe jamais par le scorer, donc
    jamais par l'écriture qui termine une case (`enregistre`, dans
    `batch_job.py`) : sans ce ramassage, il resterait `pending` sur un run
    pourtant terminé, et la matrice compterait indéfiniment des cases à
    faire.
    """
    supabase.update(
        SAMPLES,
        {"status": "error", "error": reason, "finished_at": NOW},
        run_id=f"eq.{run_id}",
        status="in.(pending,running)",
    )


# --- les juges -----------------------------------------------------------


def load_live_run_judges(supabase: Supabase, run_id: str) -> list[dict[str, Any]]:
    """LA fonction qui charge les juges d'un run — la seule autorisée à
    filtrer `run_judges` sur `deleted_at`. Tout code qui a besoin de savoir
    quels juges sont vivants sur un run — le moteur, un export, un outil MCP,
    l'écran, le devis — appelle celle-ci ; rien d'autre n'a le droit de relire
    `run_judges` par un `select` direct.

    Recopié dans deux lectures, ce filtre serait oublié dans une troisième :
    ce chantier a déjà produit deux exemples réels de cet oubli — un compte
    qui alourdissait douze routes qu'on n'avait pas vues, un formulaire qui
    ignorait un champ pendant tout un plan (voir la conception,
    docs/superpowers/specs/2026-09-06-juges-multiples.md). Un juge délié ne
    doit plus jamais ressortir nulle part ; le seul moyen de le garantir est
    qu'il n'y ait qu'un seul endroit à vérifier.

    Chaque élément rendu porte la liaison telle quelle, plus le juge qu'elle
    vise sous la clé ``"judge"`` : l'appelant n'a jamais besoin d'aller lire
    `judges` de son côté pour retrouver le critère, l'échelle, le modèle ou le
    type système d'un juge vivant.
    """
    liaisons = supabase.select(
        RUN_JUDGES,
        run_id=f"eq.{run_id}",
        # Le seul endroit du dépôt qui filtre sur deleted_at pour cette table.
        deleted_at="is.null",
        select="id,run_id,judge_id,system_type,is_principal,created_at",
        order="created_at",
    )
    if not liaisons:
        return []

    judge_ids = sorted({str(liaison["judge_id"]) for liaison in liaisons})
    judges = supabase.select(
        JUDGES,
        id="in.(" + ",".join(judge_ids) + ")",
        select="id,criterion,rubric,model,system_type,created_by,created_at",
    )
    by_id = {judge["id"]: judge for judge in judges}

    result: list[dict[str, Any]] = []
    for liaison in liaisons:
        judge = by_id.get(liaison["judge_id"])
        if judge is None:
            # Ne devrait jamais arriver : la clé étrangère composée
            # `run_judges_judge_fk` garantit qu'un juge_id de run_judges
            # existe toujours dans judges. Une base qui viole sa propre
            # contrainte mérite un échec bruyant, pas une liaison silencieuse
            # sans juge.
            raise SupabaseError(
                f"run_judges {liaison['id']!r} references unknown judge"
                f" {liaison['judge_id']!r}."
            )
        result.append({**liaison, "judge": judge})
    return result


def write_judge_score(
    supabase: Supabase,
    run_judge_id: str,
    sample_id: str,
    *,
    score: float | None,
    justification: str,
    error: str | None = None,
) -> None:
    """Écrit ce qu'un juge a trouvé sur une conversation.

    Cible la ligne par sa clé primaire — le couple (`run_judge_id`,
    `sample_id`), unique en base — plutôt que par le quadruplet
    (`sample_filters`) que le reste de ce module utilise pour désigner une
    case : `judge_scores` a un identifiant naturel que `eval_samples`,
    construite avant les juges multiples, n'a pas besoin d'exposer.
    La ligne existe déjà, en `pending`, depuis le lancement du run — voir
    `judgesForLaunch` côté `web/lib/launch-judges.ts`, qui crée toutes les
    lignes de score d'avance, comme `eval_samples` le fait déjà pour la
    matrice. Cette fonction ne fait que la remplir ; elle n'en crée jamais.

    `status` vaut `"error"` si `error` est renseigné, `"done"` sinon — que
    `score` soit rempli ou non (conversation vide, ou note hors échelle).
    Trois valeurs de statut en base pour quatre situations réelles : voir
    `JudgeScoreStatus` dans eval_schemas.py.
    """
    supabase.update(
        JUDGE_SCORES,
        {
            "status": "error" if error else "done",
            "score": score,
            "justification": justification,
            "error": error,
        },
        run_judge_id=f"eq.{run_judge_id}",
        sample_id=f"eq.{sample_id}",
    )


# --- le cache des résultats d'outils -----------------------------------------
#
# Ce qui rend déterministe un outil servi depuis le monde : même scénario, même
# outil, mêmes arguments, même réponse — pour toute la vie du run, extensions
# comprises. Voir docs/superpowers/specs/2026-09-07-le-monde-des-outils.md.


def _tool_filters(
    run_id: str, scenario_index: int, tool_name: str, arguments_hash: str
) -> dict[str, str]:
    """La clé primaire d'une ligne, en filtres PostgREST.

    Écrite une fois plutôt qu'à chaque appel : quatre colonnes recopiées à
    trois endroits, c'est la troisième qui en oublie une, et un filtre
    incomplet ici viserait la ligne d'un autre scénario.
    """
    return {
        "run_id": f"eq.{run_id}",
        "scenario_index": f"eq.{scenario_index}",
        "tool_name": f"eq.{tool_name}",
        "arguments_hash": f"eq.{arguments_hash}",
    }


def read_tool_result(
    supabase: Supabase, run_id: str, scenario_index: int, tool_name: str,
    arguments_hash: str,
) -> str | None:
    """Ce que cet appel a déjà rendu, ou `None` s'il n'a jamais été fait.

    `None` déclenche un appel au modèle d'environnement chez l'appelant. Un
    résultat vide, lui, est une réponse — celle d'une recherche sans résultat —
    et ne doit surtout pas être confondu avec l'absence de ligne.
    """
    lignes = supabase.select(
        TOOL_RESULTS,
        select="result",
        limit=1,
        **_tool_filters(run_id, scenario_index, tool_name, arguments_hash),
    )
    return lignes[0]["result"] if lignes else None


def write_tool_result(
    supabase: Supabase,
    run_id: str,
    scenario_index: int,
    tool_name: str,
    arguments_hash: str,
    *,
    arguments: dict[str, Any],
    result: str,
    model: str,
) -> str:
    """Garde ce résultat, et rend celui qui fait foi.

    **Le premier arrivé gagne.** Le job déroule plusieurs conversations en
    parallèle : deux cases du même scénario peuvent faire le même appel en même
    temps, et toutes deux écrire. L'insertion ignore donc le doublon plutôt que
    de tomber, et la relecture qui suit départage — sans elle, chacune
    repartirait avec sa propre réponse, et deux répétitions censées voir le
    même monde en verraient deux.

    La relecture est systématique, y compris quand on croit avoir gagné : la
    réponse d'une insertion qui ignore les doublons ne dit pas laquelle des
    deux lignes vit.

    Returns:
        Le résultat qui fait foi — le sien, ou celui qui était déjà là.
    """
    supabase.insert(
        TOOL_RESULTS,
        {
            "run_id": run_id,
            "scenario_index": scenario_index,
            "tool_name": tool_name,
            "arguments_hash": arguments_hash,
            "arguments": arguments,
            "result": result,
            "model": model,
        },
        on_conflict=TOOL_RESULT_KEY,
    )
    gardé = read_tool_result(
        supabase, run_id, scenario_index, tool_name, arguments_hash
    )
    # `None` ne peut arriver que si la ligne a disparu entre l'écriture et la
    # relecture, ce que rien ne fait : personne ne supprime dans cette table.
    # Servir le sien plutôt que de tomber garde la conversation en vie.
    return result if gardé is None else gardé


def unchecked_tool_results(supabase: Supabase, run_id: str) -> list[dict[str, Any]]:
    """Les résultats de ce run qui n'ont pas encore été contrôlés.

    `faithful is null` est ce qui reste à faire, lu plutôt que recalculé —
    exactement comme `judge_scores.status` porte déjà « ce qui reste à juger ».
    Deux règles écrites à deux endroits pour la même question finissent par
    diverger, et ce dépôt en a déjà payé le prix une fois.
    """
    return supabase.select(
        TOOL_RESULTS,
        select="scenario_index,tool_name,arguments_hash,arguments,result",
        run_id=f"eq.{run_id}",
        faithful="is.null",
    )


def write_tool_verdict(
    supabase: Supabase,
    run_id: str,
    scenario_index: int,
    tool_name: str,
    arguments_hash: str,
    *,
    faithful: bool,
    fault: str,
) -> None:
    """Ce que le contrôle a trouvé sur ce résultat.

    Il ne réécrit jamais `result` : ce qui a été servi est ce qu'une
    conversation a réellement vu, et le corriger après coup rendrait son
    transcript inexplicable.
    """
    supabase.update(
        TOOL_RESULTS,
        {"faithful": faithful, "fault": fault},
        **_tool_filters(run_id, scenario_index, tool_name, arguments_hash),
    )

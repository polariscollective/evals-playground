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

    def insert(self, table: str, rows: Any, *, returning: bool = False) -> list[dict]:
        return (
            self._request(
                "POST",
                f"/rest/v1/{table}",
                json=rows,
                prefer="return=representation" if returning else "return=minimal",
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


def write_sample(
    supabase: Supabase,
    run_id: str,
    scenario_index: int,
    target_model: str,
    repetition: int,
    *,
    score: float | None,
    justification: str,
    turns_done: int,
    messages: list[dict],
    temperature: float | None = None,
    usage: dict[str, Any] | None = None,
    cost_usd: float | None = None,
    error: str | None = None,
    awareness: tuple[int | None, str, str | None] | None = None,
) -> None:
    """Enregistre une case terminée.

    Écrite dès qu'elle est jugée, sans attendre la fin du run : c'est ce qui
    fait avancer la progression à l'écran, et ce qui laisse quelque chose
    d'exploitable derrière un job qui meurt en cours de route.

    `turns_done` reflète toujours une conversation qui est allée à son terme :
    cette fonction n'est jamais atteinte pour une case dont le solver a
    échoué ou a été annulée — celles-ci restent hors du juge, et donc hors
    d'ici (voir `abandon_unfinished_samples` et `cancel_unfinished_samples`).

    `awareness` porte la note d'éveil, sa justification et sa panne éventuelle.
    `None` — le cas d'une passe de juge rejouée — **omet** les trois colonnes
    de l'écriture au lieu de les mettre à `null` : la note d'éveil obtenue au
    premier passage doit survivre à un rejugement, qui ne repose pas la
    question. Trois paramètres à valeur par défaut n'auraient pas su distinguer
    « pas de note » de « ne touche pas », et auraient effacé en silence.
    """
    values: dict[str, Any] = {
        "status": "error" if error else "done",
        "score": score,
        "justification": justification,
        "turns_done": turns_done,
        "messages": messages,
        "temperature": temperature,
        "usage": usage or {},
        "cost_usd": cost_usd,
        "error": error,
        "finished_at": NOW,
    }
    if awareness is not None:
        values["awareness_score"] = awareness[0]
        values["awareness_justification"] = awareness[1]
        values["awareness_error"] = awareness[2]
    supabase.update(
        SAMPLES,
        values,
        **sample_filters(run_id, scenario_index, target_model, repetition),
    )


def write_awareness(
    supabase: Supabase,
    run_id: str,
    scenario_index: int,
    target_model: str,
    repetition: int,
    *,
    awareness: tuple[int | None, str, str | None],
    usage: dict[str, Any] | None = None,
    cost_usd: float | None = None,
) -> None:
    """Écrit la note d'éveil d'une case, et rien d'autre.

    Volontairement séparée de `write_sample`, qui écrit une case entière. Cette
    passe-ci arrive sur un run déjà terminé et déjà noté : toucher `status`,
    `score`, `justification`, `messages` ou `turns_done` détruirait précisément
    ce qu'on est venu compléter. Les seules colonnes partagées sont `usage` et
    `cost_usd`, parce que la passe consomme des jetons pour de vrai — et
    l'appelant les lui donne déjà fusionnés avec ce que la case portait.
    """
    values: dict[str, Any] = {
        "awareness_score": awareness[0],
        "awareness_justification": awareness[1],
        "awareness_error": awareness[2],
    }
    if usage is not None:
        values["usage"] = usage
        values["cost_usd"] = cost_usd
    supabase.update(
        SAMPLES,
        values,
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
    jamais par `write_sample` : sans ce ramassage, il resterait `pending` sur un
    run pourtant terminé, et la matrice compterait indéfiniment des cases à
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
    `sample_id`), unique en base — plutôt que par un quadruplet comme
    `write_sample` : `judge_scores` a un identifiant naturel que le reste de
    ce module, construit avant les juges multiples, n'a pas besoin d'exposer.
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

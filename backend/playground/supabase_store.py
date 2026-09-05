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
    """
    return supabase.select(
        SAMPLES,
        run_id=f"eq.{run_id}",
        status="eq.pending",
        select=(
            "scenario_index,target_model,repetition,temperature,turns_done,"
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
) -> None:
    """Enregistre une case terminée.

    Écrite dès qu'elle est jugée, sans attendre la fin du run : c'est ce qui
    fait avancer la progression à l'écran, et ce qui laisse quelque chose
    d'exploitable derrière un job qui meurt en cours de route.

    `turns_done` reflète toujours une conversation qui est allée à son terme :
    cette fonction n'est jamais atteinte pour une case dont le solver a
    échoué ou a été annulée — celles-ci restent hors du juge, et donc hors
    d'ici (voir `abandon_unfinished_samples` et `cancel_unfinished_samples`).
    """
    supabase.update(
        SAMPLES,
        {
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
        },
        **sample_filters(run_id, scenario_index, target_model, repetition),
    )


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

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
from dataclasses import dataclass
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
) -> None:
    """Termine le run, qu'il ait abouti ou non.

    La consommation est enregistrée dans les deux cas : les jetons déjà brûlés
    l'ont été, et ne pas les inscrire laisserait croire un run raté gratuit.
    """
    supabase.update(
        RUNS,
        {
            "status": "error" if error else "done",
            "error": error,
            "finished_at": NOW,
            "usage": usage or {},
            "cost_usd": cost_usd,
        },
        id=f"eq.{run_id}",
    )


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
    messages: list[dict],
    temperature: float | None = None,
    error: str | None = None,
) -> None:
    """Enregistre une case terminée.

    Écrite dès qu'elle est jugée, sans attendre la fin du run : c'est ce qui
    fait avancer la progression à l'écran, et ce qui laisse quelque chose
    d'exploitable derrière un job qui meurt en cours de route.
    """
    supabase.update(
        SAMPLES,
        {
            "status": "error" if error else "done",
            "score": score,
            "justification": justification,
            "messages": messages,
            "temperature": temperature,
            "error": error,
            "finished_at": NOW,
        },
        **sample_filters(run_id, scenario_index, target_model, repetition),
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

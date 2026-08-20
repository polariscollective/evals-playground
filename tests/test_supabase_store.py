"""Le magasin Supabase : ce qui part sur le réseau, et ce qui en revient."""

import json

import httpx
import pytest

from playground.supabase_store import (
    NOW,
    Supabase,
    SupabaseError,
    abandon_unfinished_samples,
    fetch_run,
    finish_run,
    mark_sample_running,
    sample_filters,
    start_run,
    write_sample,
)


def _supabase(handler) -> tuple[Supabase, list[httpx.Request]]:
    """Un client branché sur un transport de test, et le journal des requêtes."""
    envoyees: list[httpx.Request] = []

    def transport(request: httpx.Request) -> httpx.Response:
        envoyees.append(request)
        return handler(request)

    client = httpx.Client(
        base_url="https://exemple.supabase.co",
        headers={"apikey": "cle", "Authorization": "Bearer cle"},
        transport=httpx.MockTransport(transport),
    )
    return Supabase(url="https://exemple.supabase.co", key="cle", client=client), envoyees


def _ok(payload=None):
    return lambda request: httpx.Response(200, json=payload if payload is not None else [])


def _body(request: httpx.Request) -> dict | list:
    return json.loads(request.content.decode())


# --- construction ------------------------------------------------------------


def test_sans_variables_d_environnement_l_echec_est_immediat(monkeypatch):
    """Un job qui démarre sans base écrirait dans le vide pendant une heure."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(SupabaseError, match="SUPABASE_URL"):
        Supabase.from_env()


def test_l_url_perd_sa_barre_finale(monkeypatch):
    # Sans ça, chaque chemin porterait un double slash.
    monkeypatch.setenv("SUPABASE_URL", "https://exemple.supabase.co/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "cle")
    assert Supabase.from_env().url == "https://exemple.supabase.co"


# --- le transport ------------------------------------------------------------


def test_une_erreur_postgrest_porte_le_corps_de_la_reponse():
    """PostgREST y met la contrainte violée : c'est la seule chose utile."""
    supabase, _ = _supabase(
        lambda r: httpx.Response(409, text='{"code":"23505","message":"duplicate key"}')
    )
    with pytest.raises(SupabaseError, match="duplicate key"):
        supabase.select("eval_runs")


def test_une_reponse_vide_ne_casse_pas_le_decodage():
    # PATCH renvoie 204 sans corps ; le décoder ferait échouer chaque écriture.
    supabase, _ = _supabase(lambda r: httpx.Response(204))
    assert supabase.update("eval_runs", {"status": "done"}, id="eq.1") is None


# --- les runs ----------------------------------------------------------------


def test_un_run_inconnu_est_une_erreur_explicite():
    supabase, _ = _supabase(_ok([]))
    with pytest.raises(SupabaseError, match="Unknown evaluation run"):
        fetch_run(supabase, "absent")


def test_le_demarrage_efface_l_erreur_precedente():
    """Une reprise ne doit pas traîner le message de la passe ratée."""
    supabase, envoyees = _supabase(_ok())
    start_run(supabase, "r1", execution="executions/abc")

    corps = _body(envoyees[0])
    assert corps["status"] == "running"
    assert corps["error"] is None
    assert corps["started_at"] == NOW
    assert corps["execution"] == "executions/abc"


def test_sans_execution_la_colonne_n_est_pas_ecrasee():
    # Un run relancé à la main n'a pas d'exécution Cloud Run ; écrire `null`
    # effacerait celle d'une passe précédente.
    supabase, envoyees = _supabase(_ok())
    start_run(supabase, "r1")
    assert "execution" not in _body(envoyees[0])


def test_terminer_avec_une_erreur_donne_le_statut_error():
    supabase, envoyees = _supabase(_ok())
    finish_run(supabase, "r1", usage={"m": {"input_tokens": 5}}, error="boum")

    corps = _body(envoyees[0])
    assert corps["status"] == "error"
    assert corps["error"] == "boum"
    # La consommation est enregistrée même sur un run raté : ces jetons ont été
    # facturés, et les taire ferait passer le run pour gratuit.
    assert corps["usage"] == {"m": {"input_tokens": 5}}


def test_terminer_sans_erreur_donne_le_statut_done():
    supabase, envoyees = _supabase(_ok())
    finish_run(supabase, "r1", cost_usd=1.25)
    corps = _body(envoyees[0])
    assert corps["status"] == "done"
    assert corps["error"] is None
    assert corps["cost_usd"] == 1.25


# --- les échantillons --------------------------------------------------------


def test_une_case_est_designee_par_son_quadruplet():
    """Viser par la contrainte d'unicité plutôt que par l'identifiant de ligne :
    c'est ce qui rend l'écriture idempotente, donc une reprise sans danger."""
    assert sample_filters("r1", 2, "m", 3) == {
        "run_id": "eq.r1",
        "scenario_index": "eq.2",
        "target_model": "eq.m",
        "repetition": "eq.3",
    }


def test_une_case_jugee_est_ecrite_avec_sa_note_et_son_transcript():
    supabase, envoyees = _supabase(_ok())
    write_sample(
        supabase, "r1", 0, "m", 1,
        score=2.0,
        justification="au tour 4.",
        messages=[{"role": "user", "content": "bonjour"}],
        temperature=0.5,
    )

    requete = envoyees[0]
    assert requete.method == "PATCH"
    assert "run_id=eq.r1" in str(requete.url)
    corps = _body(requete)
    assert corps["status"] == "done"
    assert corps["score"] == 2.0
    assert corps["messages"] == [{"role": "user", "content": "bonjour"}]
    assert corps["error"] is None


def test_une_case_en_erreur_garde_le_statut_error_meme_avec_une_note():
    # Le statut suit l'erreur, pas la présence d'une note : une case dont le
    # juge a échoué après avoir répondu n'est pas une case réussie.
    supabase, envoyees = _supabase(_ok())
    write_sample(supabase, "r1", 0, "m", 0, score=1.0, justification="",
                 messages=[], error="le juge n'a pas répondu")
    assert _body(envoyees[0])["status"] == "error"


def test_marquer_une_case_en_cours_ne_touche_que_son_statut_et_sa_date():
    supabase, envoyees = _supabase(_ok())
    mark_sample_running(supabase, "r1", 0, "m", 0)
    assert _body(envoyees[0]) == {"status": "running", "started_at": NOW}


def test_le_ramassage_ne_vise_que_les_cases_non_terminees():
    """Une case déjà notée ne doit pas être écrasée par le ramassage de fin."""
    supabase, envoyees = _supabase(_ok())
    abandon_unfinished_samples(supabase, "r1", "le job s'est arrêté")

    url = str(envoyees[0].url)
    assert "status=in.%28pending%2Crunning%29" in url or "status=in.(pending,running)" in url
    assert _body(envoyees[0])["error"] == "le job s'est arrêté"

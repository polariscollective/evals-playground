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
    load_live_run_judges,
    mark_sample_running,
    sample_filters,
    start_run,
    write_judge_score,
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


# --- l'arrêt coopératif ------------------------------------------------------


def test_l_arret_est_relu_en_base_puis_mis_en_cache():
    """Une matrice de cinq cents cases ne doit pas faire cinq cents requêtes
    pour lire un mot qui change une fois."""
    from playground.supabase_store import Cancellation

    supabase, envoyees = _supabase(_ok([{"status": "running"}]))
    arret = Cancellation(supabase, "r1", ttl_seconds=60)

    assert arret.stopped() is False
    assert arret.stopped() is False
    assert len(envoyees) == 1, "la seconde lecture vient du cache"


def test_une_fois_arrete_le_reste_sans_redemander():
    from playground.supabase_store import Cancellation

    supabase, envoyees = _supabase(_ok([{"status": "cancelled"}]))
    arret = Cancellation(supabase, "r1", ttl_seconds=0)

    assert arret.stopped() is True
    assert arret.stopped() is True
    assert len(envoyees) == 1, "un run annulé ne se désannule pas"


def test_une_lecture_en_echec_ne_provoque_pas_d_arret():
    """Un run qui continue malgré une demande d'arrêt est un désagrément ; un
    run qui s'arrête parce que le réseau a hoqueté détruit du travail payé."""
    from playground.supabase_store import Cancellation

    supabase, _ = _supabase(lambda r: httpx.Response(500, text="boum"))
    assert Cancellation(supabase, "r1", ttl_seconds=0).stopped() is False


def test_les_cases_non_faites_sont_annulees_a_part():
    from playground.supabase_store import cancel_unfinished_samples

    supabase, envoyees = _supabase(_ok())
    cancel_unfinished_samples(supabase, "r1")

    corps = _body(envoyees[0])
    assert corps["status"] == "cancelled"
    assert "error" not in corps, "une case annulée n'a pas de message d'erreur"


def test_terminer_sur_un_arret_donne_le_statut_cancelled():
    supabase, envoyees = _supabase(_ok())
    finish_run(supabase, "r1", cancelled=True)
    corps = _body(envoyees[0])
    assert corps["status"] == "cancelled"
    assert corps["error"] is None


# --- les juges -----------------------------------------------------------


def test_les_juges_vivants_fusionnent_liaison_et_configuration():
    """Deux requêtes : les liaisons vivantes, puis les juges qu'elles visent —
    jamais l'inverse, et jamais plus."""

    def handler(request: httpx.Request) -> httpx.Response:
        if "/rest/v1/run_judges" in str(request.url):
            assert "deleted_at=is.null" in str(request.url)
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "rj1",
                        "run_id": "r1",
                        "judge_id": "j1",
                        "system_type": "ordinary",
                        "is_principal": True,
                        "created_at": "t",
                    },
                    {
                        "id": "rj2",
                        "run_id": "r1",
                        "judge_id": "j2",
                        "system_type": "awake",
                        "is_principal": False,
                        "created_at": "t",
                    },
                ],
            )
        assert "/rest/v1/judges" in str(request.url)
        return httpx.Response(
            200,
            json=[
                {
                    "id": "j1",
                    "criterion": "A-t-il cédé ?",
                    "rubric": [{"value": 1, "meaning": "non"}],
                    "model": "m",
                    "system_type": "ordinary",
                    "created_by": "a@b.c",
                    "created_at": "t",
                },
                {
                    "id": "j2",
                    "criterion": None,
                    "rubric": None,
                    "model": "m",
                    "system_type": "awake",
                    "created_by": "a@b.c",
                    "created_at": "t",
                },
            ],
        )

    supabase, envoyees = _supabase(handler)
    juges = load_live_run_judges(supabase, "r1")

    assert len(envoyees) == 2
    assert len(juges) == 2
    assert juges[0]["is_principal"] is True
    assert juges[0]["judge"]["criterion"] == "A-t-il cédé ?"
    assert juges[1]["system_type"] == "awake"
    assert juges[1]["judge"]["system_type"] == "awake"


def test_sans_liaison_vivante_les_juges_ne_sont_pas_lus():
    """Une deuxième requête pour zéro liaison serait un aller-retour pour rien."""
    supabase, envoyees = _supabase(_ok([]))
    assert load_live_run_judges(supabase, "r1") == []
    assert len(envoyees) == 1


def test_une_liaison_sans_juge_correspondant_est_une_erreur_bruyante():
    # Ne devrait jamais arriver — la clé étrangère composée l'interdit en
    # base — mais une base qui viole sa propre contrainte doit casser fort,
    # pas rendre une liaison sans juge en silence.
    def handler(request: httpx.Request) -> httpx.Response:
        if "/rest/v1/run_judges" in str(request.url):
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "rj1",
                        "run_id": "r1",
                        "judge_id": "j1",
                        "system_type": "ordinary",
                        "is_principal": True,
                        "created_at": "t",
                    }
                ],
            )
        return httpx.Response(200, json=[])

    supabase, _ = _supabase(handler)
    with pytest.raises(SupabaseError, match="j1"):
        load_live_run_judges(supabase, "r1")


def test_ecrire_la_note_d_un_juge_vise_la_ligne_par_sa_cle_primaire():
    supabase, envoyees = _supabase(_ok())
    write_judge_score(supabase, "rj1", "s1", score=2.0, justification="clair.")

    requete = envoyees[0]
    assert requete.method == "PATCH"
    assert "run_judge_id=eq.rj1" in str(requete.url)
    assert "sample_id=eq.s1" in str(requete.url)
    corps = _body(requete)
    assert corps == {
        "status": "done",
        "score": 2.0,
        "justification": "clair.",
        "error": None,
    }


def test_ecrire_la_panne_d_un_juge_donne_le_statut_error():
    supabase, envoyees = _supabase(_ok())
    write_judge_score(
        supabase, "rj1", "s1", score=None, justification="", error="le juge est tombé"
    )
    corps = _body(envoyees[0])
    assert corps["status"] == "error"
    assert corps["score"] is None
    assert corps["error"] == "le juge est tombé"

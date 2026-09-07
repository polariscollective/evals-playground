from playground.catalog import catalog, known_model_ids

CLES = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "XAI_API_KEY",
    "GROK_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
]


def _sans_cles(monkeypatch):
    for cle in CLES:
        monkeypatch.delenv(cle, raising=False)


def test_les_quatre_providers_sont_proposes(monkeypatch):
    _sans_cles(monkeypatch)
    assert [p.id for p in catalog()] == ["anthropic", "openai", "grok", "google"]


def test_cle_absente_marque_le_provider_indisponible(monkeypatch):
    _sans_cles(monkeypatch)
    assert all(p.key_present is False for p in catalog())


def test_cle_presente_marque_le_provider_disponible(monkeypatch):
    _sans_cles(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    par_id = {p.id: p for p in catalog()}
    assert par_id["anthropic"].key_present is True
    assert par_id["openai"].key_present is False


def test_grok_accepte_les_deux_noms_de_variable(monkeypatch):
    _sans_cles(monkeypatch)
    monkeypatch.setenv("GROK_API_KEY", "xai-test")
    par_id = {p.id: p for p in catalog()}
    assert par_id["grok"].key_present is True


def test_une_cle_vide_ne_compte_pas(monkeypatch):
    _sans_cles(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    par_id = {p.id: p for p in catalog()}
    assert par_id["anthropic"].key_present is False


def test_le_catalogue_porte_quarante_et_un_modeles():
    assert len(known_model_ids()) == 41


def test_chaque_modele_propose_a_un_tarif():
    # Un modèle sans tarif est compté pour zéro par le devis : un run annoncé
    # gratuit et facturé plein.
    from playground.pricing import PRICES

    assert {m for m in known_model_ids() if m not in PRICES} == set()


def test_aucun_tarif_ne_traine_sans_modele():
    from playground.pricing import PRICES

    assert set(PRICES) - known_model_ids() == set()


def test_les_sept_modeles_qui_jettent_la_temperature_sont_marques():
    ignorants = sorted(
        m.id for p in catalog() for m in p.models if not m.honours_temperature
    )
    assert ignorants == [
        "anthropic/claude-fable-5",
        "anthropic/claude-fable-5-1",
        "anthropic/claude-opus-4-7",
        "anthropic/claude-opus-4-8",
        "anthropic/claude-opus-5",
        "anthropic/claude-sonnet-5",
        "openai/gpt-6-astra",
    ]

from playground.catalog import catalog, known_model_ids

CLES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "GROK_API_KEY"]


def _sans_cles(monkeypatch):
    for cle in CLES:
        monkeypatch.delenv(cle, raising=False)


def test_les_trois_providers_sont_proposes(monkeypatch):
    _sans_cles(monkeypatch)
    assert [p.id for p in catalog()] == ["anthropic", "openai", "grok"]


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


def test_neuf_modeles_connus_avec_prefixe_provider():
    ids = known_model_ids()
    expected = {
        "anthropic/claude-opus-5",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-haiku-4-5",
        "openai/gpt-5.6-sol",
        "openai/gpt-5.6-terra",
        "openai/gpt-5.6-luna",
        "grok/grok-4.6",
        "grok/grok-4.5",
        "grok/grok-4.3",
    }
    assert ids == expected

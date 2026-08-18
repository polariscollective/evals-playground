from pathlib import Path

import pytest

from playground.schemas import JudgeSelection, RunConfig, RunModels, Scenario
from playground.store import (
    bump_progress,
    create_run,
    is_selected,
    list_runs,
    new_run_id,
    read_progress,
    read_run,
    select_scenario,
    unselect_scenario,
    write_run,
)


def _config() -> RunConfig:
    return RunConfig(
        seed="une idée",
        n_scenarios=3,
        judges=[JudgeSelection(name="realism", threshold=7, direction="gte")],
        models=RunModels(
            generator="grok/grok-4.6", judge="anthropic/claude-opus-5"
        ),
        label="essai",
    )


def _scenario(scenario_id: str = "s1") -> Scenario:
    return Scenario(
        scenario_id=scenario_id,
        title="Un titre",
        system_prompt="Tu es…",
        opening_message="Bonjour…",
        tests_for="ce que ça teste",
        variation_axis="secteur",
        judge_scores={"realism": 9},
        passes={"realism": True},
        passes_all=True,
        mean_margin=2.0,
    )


def test_les_identifiants_de_run_sont_uniques():
    assert new_run_id() != new_run_id()


def test_creer_un_run_ecrit_un_fichier_en_attente(tmp_path: Path):
    record = create_run(_config(), tmp_path)
    assert (tmp_path / f"{record.run_id}.json").exists()
    assert record.status == "pending"
    assert record.progress.total == 3
    assert record.progress.completed == 0


def test_relire_un_run(tmp_path: Path):
    record = create_run(_config(), tmp_path)
    reloaded = read_run(record.run_id, tmp_path)
    assert reloaded.run_id == record.run_id
    assert reloaded.config.seed == "une idée"


def test_relire_un_run_inconnu_leve_une_erreur(tmp_path: Path):
    with pytest.raises(KeyError):
        read_run("absent", tmp_path)


def test_ecrire_ecrase_le_run(tmp_path: Path):
    record = create_run(_config(), tmp_path)
    record.status = "done"
    record.scenarios = [_scenario()]
    write_run(record, tmp_path)
    assert read_run(record.run_id, tmp_path).status == "done"
    assert len(read_run(record.run_id, tmp_path).scenarios) == 1


def test_lister_les_runs_du_plus_recent_au_plus_ancien(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    # Les identifiants sont figés à "aaa" < "bbb" < "ccc" et les dates leur
    # sont anti-corrélées ("aaa" le plus ancien, "ccc" le plus récent) : l'ordre
    # alphabétique des fichiers sur disque est donc l'exact inverse de l'ordre
    # temporel attendu. Un `list_runs` qui ne trierait pas (ou trierait mal)
    # renverrait l'ordre des fichiers et échouerait ici. Trois runs, pas deux,
    # pour qu'un ordre issu du hasard n'ait pas une chance sur deux de passer.
    ids = iter(["aaa", "bbb", "ccc"])
    monkeypatch.setattr("playground.store.new_run_id", lambda: next(ids))

    oldest = create_run(_config(), tmp_path)
    oldest.created_at = "2026-08-01T10:00:00"
    write_run(oldest, tmp_path)
    middle = create_run(_config(), tmp_path)
    middle.created_at = "2026-08-02T10:00:00"
    write_run(middle, tmp_path)
    newest = create_run(_config(), tmp_path)
    newest.created_at = "2026-08-03T10:00:00"
    write_run(newest, tmp_path)

    assert [r.run_id for r in list_runs(tmp_path)] == [
        newest.run_id,
        middle.run_id,
        oldest.run_id,
    ]


def test_lister_ignore_un_fichier_corrompu(tmp_path: Path):
    record = create_run(_config(), tmp_path)
    (tmp_path / "casse.json").write_text("{ pas du json")
    assert [r.run_id for r in list_runs(tmp_path)] == [record.run_id]


def test_lister_ignore_un_fichier_json_valide_mais_hors_schema(tmp_path: Path):
    record = create_run(_config(), tmp_path)
    (tmp_path / "incomplet.json").write_text('{"run_id": "x"}')
    assert [r.run_id for r in list_runs(tmp_path)] == [record.run_id]


def test_la_progression_s_incremente(tmp_path: Path):
    record = create_run(_config(), tmp_path)
    assert read_progress(record.run_id, tmp_path) == 0
    bump_progress(record.run_id, tmp_path)
    bump_progress(record.run_id, tmp_path)
    assert read_progress(record.run_id, tmp_path) == 2


def test_retenir_un_scenario_ecrit_un_yaml(tmp_path: Path):
    runs = tmp_path / "runs"
    selected = tmp_path / "selected"
    record = create_run(_config(), runs)
    path = select_scenario(_scenario(), record, selected)

    assert path == selected / "s1.yaml"
    content = path.read_text()
    assert "opening_message" in content
    assert record.run_id in content
    assert is_selected("s1", selected) is True


def test_relacher_un_scenario_supprime_le_yaml(tmp_path: Path):
    runs = tmp_path / "runs"
    selected = tmp_path / "selected"
    record = create_run(_config(), runs)
    select_scenario(_scenario(), record, selected)
    unselect_scenario("s1", selected)
    assert is_selected("s1", selected) is False


def test_relacher_un_scenario_non_retenu_est_sans_effet(tmp_path: Path):
    unselect_scenario("jamais_retenu", tmp_path)
    assert is_selected("jamais_retenu", tmp_path) is False

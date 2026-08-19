from pathlib import Path

import pytest

from playground.eval_schemas import (
    Conversation,
    EvalModels,
    EvalRunConfig,
    EvalScenario,
)
from playground.eval_store import (
    bump_eval_progress,
    create_eval_run,
    list_eval_runs,
    read_eval_progress,
    read_eval_run,
    write_eval_run,
)


def _config() -> EvalRunConfig:
    return EvalRunConfig(
        scenarios=[
            EvalScenario(
                title="Rappel fournisseur",
                system_prompt="Tu assistes l'équipe qualité.",
                opening_message="On a un souci sur le lot 4412.",
            )
        ],
        criterion="Le modèle a fourni le plan demandé.",
        turns=1,
        repetitions=3,
        models=EvalModels(targets=["mockllm/model"], judge="mockllm/model"),
        label="essai",
    )


def test_creer_un_run_ecrit_un_fichier_en_attente(tmp_path: Path):
    record = create_eval_run(_config(), tmp_path)
    assert (tmp_path / f"{record.run_id}.json").exists()
    assert record.status == "pending"
    assert record.progress.total == 3
    assert record.progress.completed == 0


def test_relire_un_run(tmp_path: Path):
    record = create_eval_run(_config(), tmp_path)
    assert read_eval_run(record.run_id, tmp_path).config.criterion.startswith("Le modèle")


def test_relire_un_run_inconnu_leve_une_erreur(tmp_path: Path):
    with pytest.raises(KeyError):
        read_eval_run("absent", tmp_path)


def test_ecrire_ecrase_le_run(tmp_path: Path):
    record = create_eval_run(_config(), tmp_path)
    record.status = "done"
    record.conversations = [Conversation(conversation_id="c1", repetition=0)]
    write_eval_run(record, tmp_path)

    reloaded = read_eval_run(record.run_id, tmp_path)
    assert reloaded.status == "done"
    assert len(reloaded.conversations) == 1


def test_lister_les_runs_du_plus_recent_au_plus_ancien(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    # Identifiants figés et dates anti-corrélées : l'ordre alphabétique des
    # fichiers est l'inverse exact de l'ordre attendu, donc une implémentation
    # sans tri ne peut pas passer par hasard.
    ids = iter(["aaa", "bbb", "ccc"])
    monkeypatch.setattr("playground.eval_store.new_run_id", lambda: next(ids))
    for created_at in ("2026-08-01T10:00:00", "2026-08-02T10:00:00", "2026-08-03T10:00:00"):
        record = create_eval_run(_config(), tmp_path)
        record.created_at = created_at
        write_eval_run(record, tmp_path)

    assert [r.run_id for r in list_eval_runs(tmp_path)] == ["ccc", "bbb", "aaa"]


def test_lister_ignore_un_fichier_malforme(tmp_path: Path):
    record = create_eval_run(_config(), tmp_path)
    (tmp_path / "casse.json").write_text("{ pas du json")
    assert [r.run_id for r in list_eval_runs(tmp_path)] == [record.run_id]


def test_lister_ignore_un_json_valide_mais_hors_schema(tmp_path: Path):
    record = create_eval_run(_config(), tmp_path)
    (tmp_path / "ancien.json").write_text('{"run_id": "x"}')
    assert [r.run_id for r in list_eval_runs(tmp_path)] == [record.run_id]


def test_la_progression_s_incremente(tmp_path: Path):
    record = create_eval_run(_config(), tmp_path)
    assert read_eval_progress(record.run_id, tmp_path) == 0
    bump_eval_progress(record.run_id, tmp_path)
    bump_eval_progress(record.run_id, tmp_path)
    assert read_eval_progress(record.run_id, tmp_path) == 2


def test_le_fichier_temporaire_n_est_jamais_ramasse(tmp_path: Path):
    record = create_eval_run(_config(), tmp_path)
    (tmp_path / f"{record.run_id}.json.tmp").write_text("{ écriture en cours")
    assert [r.run_id for r in list_eval_runs(tmp_path)] == [record.run_id]

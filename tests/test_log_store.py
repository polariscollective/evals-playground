"""Le journal d'un run, monté dans Storage — et jamais au prix du run."""

from pathlib import Path

import httpx

from playground.log_store import Storage, upload_logs


class FakeClient:
    """Retient ce qui est posté, et rend les codes qu'on lui a donnés.

    `codes` se consomme dans l'ordre, ce qui permet de faire échouer un fichier
    au milieu d'un lot sans toucher aux autres.
    """

    def __init__(self, *codes: int):
        self.codes = list(codes) or [200]
        self.posts: list[dict] = []

    def post(self, path, content=None, headers=None):
        self.posts.append({"path": path, "content": content, "headers": headers})
        code = self.codes.pop(0) if len(self.codes) > 1 else self.codes[0]
        return httpx.Response(code, text="" if code < 400 else "bucket fâché")


def _storage(*codes: int) -> Storage:
    return Storage(url="https://fake", key="cle", client=FakeClient(*codes))


def _logs(tmp_path: Path, run_id: str, *noms: str) -> Path:
    directory = tmp_path / run_id
    directory.mkdir(parents=True)
    for nom in noms:
        (directory / nom).write_bytes(f"contenu de {nom}".encode())
    return tmp_path


def test_chaque_eval_est_monte_sous_l_identifiant_du_run(tmp_path: Path):
    logs = _logs(tmp_path, "r1", "a.eval", "b.eval")
    storage = _storage()

    montés = upload_logs("r1", logs, storage)

    assert montés == ["a.eval", "b.eval"]
    assert [p["path"] for p in storage.client.posts] == [
        "/storage/v1/object/inspect-logs/r1/a.eval",
        "/storage/v1/object/inspect-logs/r1/b.eval",
    ]


def test_l_objet_part_en_octets_et_en_upsert(tmp_path: Path):
    """`x-upsert` protège d'une tâche Cloud Run rejouée avec le même run."""
    logs = _logs(tmp_path, "r1", "a.eval")
    storage = _storage()

    upload_logs("r1", logs, storage)

    post = storage.client.posts[0]
    assert post["content"] == b"contenu de a.eval"
    assert post["headers"]["x-upsert"] == "true"
    assert post["headers"]["Content-Type"] == "application/octet-stream"


def test_un_refus_du_bucket_ne_leve_pas(tmp_path: Path):
    """La règle du module : un run noté est un run réussi, journal ou pas."""
    logs = _logs(tmp_path, "r1", "a.eval")

    assert upload_logs("r1", logs, _storage(500)) == []


def test_un_fichier_refuse_n_empeche_pas_les_suivants(tmp_path: Path):
    logs = _logs(tmp_path, "r1", "a.eval", "b.eval")

    assert upload_logs("r1", logs, _storage(500, 200)) == ["b.eval"]


def test_un_dossier_absent_ne_monte_rien(tmp_path: Path):
    """Un job mort avant qu'inspect n'écrive quoi que ce soit."""
    storage = _storage()

    assert upload_logs("r1", tmp_path, storage) == []
    assert storage.client.posts == []


def test_seuls_les_eval_montent(tmp_path: Path):
    """Inspect laisse d'autres fichiers dans son dossier ; ils ne nous
    regardent pas."""
    logs = _logs(tmp_path, "r1", "a.eval", "notes.txt")

    assert upload_logs("r1", logs, _storage()) == ["a.eval"]


def test_le_manifeste_monte_apres_les_journaux(tmp_path: Path, monkeypatch):
    """Le manifeste nomme des fichiers ; il ne doit jamais en nommer un qui
    n'est pas encore monté. D'où le dernier rang, et ce test."""
    logs = _logs(tmp_path, "r1", "a.eval", "b.eval")
    monkeypatch.setattr(
        "playground.log_store.write_log_listing",
        lambda directory: Path(directory).joinpath("listing.json").write_text("{}"),
    )
    storage = _storage()

    montés = upload_logs("r1", logs, storage)

    assert montés == ["a.eval", "b.eval", "listing.json"]


def test_un_manifeste_impossible_n_empeche_pas_les_journaux(
    tmp_path: Path, monkeypatch
):
    """Un `.eval` en sécurité vaut mieux qu'un `.eval` perdu."""
    logs = _logs(tmp_path, "r1", "a.eval")

    def refuser(directory):
        raise RuntimeError("journal illisible")

    monkeypatch.setattr("playground.log_store.write_log_listing", refuser)

    assert upload_logs("r1", logs, _storage()) == ["a.eval"]


def test_sans_variables_d_environnement_on_renonce_sans_lever(
    tmp_path: Path, monkeypatch
):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    logs = _logs(tmp_path, "r1", "a.eval")

    assert upload_logs("r1", logs) == []

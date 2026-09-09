"""A run's logs, uploaded to Storage — and never at the run's expense."""

from pathlib import Path

import httpx

from playground.log_store import Storage, upload_logs


class FakeClient:
    """Keeps what is posted, and returns the codes it was given.

    `codes` is consumed in order, which makes it possible to fail one file in
    the middle of a batch without touching the others.
    """

    def __init__(self, *codes: int):
        self.codes = list(codes) or [200]
        self.posts: list[dict] = []

    def post(self, path, content=None, headers=None):
        self.posts.append({"path": path, "content": content, "headers": headers})
        code = self.codes.pop(0) if len(self.codes) > 1 else self.codes[0]
        return httpx.Response(code, text="" if code < 400 else "angry bucket")


def _storage(*codes: int) -> Storage:
    return Storage(url="https://fake", key="key", client=FakeClient(*codes))


def _logs(tmp_path: Path, run_id: str, *names: str) -> Path:
    directory = tmp_path / run_id
    directory.mkdir(parents=True)
    for name in names:
        (directory / name).write_bytes(f"contents of {name}".encode())
    return tmp_path


def test_each_eval_is_uploaded_under_the_run_identifier(tmp_path: Path):
    logs = _logs(tmp_path, "r1", "a.eval", "b.eval")
    storage = _storage()

    uploaded = upload_logs("r1", logs, storage)

    assert uploaded == ["a.eval", "b.eval"]
    assert [p["path"] for p in storage.client.posts] == [
        "/storage/v1/object/inspect-logs/r1/a.eval",
        "/storage/v1/object/inspect-logs/r1/b.eval",
    ]


def test_the_object_goes_out_as_bytes_and_as_an_upsert(tmp_path: Path):
    """`x-upsert` guards against a Cloud Run task replayed with the same run."""
    logs = _logs(tmp_path, "r1", "a.eval")
    storage = _storage()

    upload_logs("r1", logs, storage)

    post = storage.client.posts[0]
    assert post["content"] == b"contents of a.eval"
    assert post["headers"]["x-upsert"] == "true"
    assert post["headers"]["Content-Type"] == "application/octet-stream"


def test_a_refusal_from_the_bucket_does_not_raise(tmp_path: Path):
    """The module's rule: a graded run is a successful run, log or no log."""
    logs = _logs(tmp_path, "r1", "a.eval")

    assert upload_logs("r1", logs, _storage(500)) == []


def test_one_refused_file_does_not_stop_the_others(tmp_path: Path):
    logs = _logs(tmp_path, "r1", "a.eval", "b.eval")

    assert upload_logs("r1", logs, _storage(500, 200)) == ["b.eval"]


def test_a_missing_directory_uploads_nothing(tmp_path: Path):
    """A job that died before inspect wrote anything at all."""
    storage = _storage()

    assert upload_logs("r1", tmp_path, storage) == []
    assert storage.client.posts == []


def test_only_the_evals_go_up(tmp_path: Path):
    """Inspect leaves other files in its directory; they are none of our
    business."""
    logs = _logs(tmp_path, "r1", "a.eval", "notes.txt")

    assert upload_logs("r1", logs, _storage()) == ["a.eval"]


def test_the_manifest_goes_up_after_the_logs(tmp_path: Path, monkeypatch):
    """The manifest names files; it must never name one that is not uploaded
    yet. Hence its last place, and this test."""
    logs = _logs(tmp_path, "r1", "a.eval", "b.eval")
    monkeypatch.setattr(
        "playground.log_store.write_log_listing",
        lambda directory: Path(directory).joinpath("listing.json").write_text("{}"),
    )
    storage = _storage()

    uploaded = upload_logs("r1", logs, storage)

    assert uploaded == ["a.eval", "b.eval", "listing.json"]


def test_an_impossible_manifest_does_not_stop_the_logs(
    tmp_path: Path, monkeypatch
):
    """An `.eval` kept safe beats an `.eval` lost."""
    logs = _logs(tmp_path, "r1", "a.eval")

    def refuse(directory):
        raise RuntimeError("unreadable log")

    monkeypatch.setattr("playground.log_store.write_log_listing", refuse)

    assert upload_logs("r1", logs, _storage()) == ["a.eval"]


def test_without_environment_variables_we_give_up_without_raising(
    tmp_path: Path, monkeypatch
):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    logs = _logs(tmp_path, "r1", "a.eval")

    assert upload_logs("r1", logs) == []

"""Inspect's logs, uploaded to Supabase Storage.

Inspect writes one `.eval` per pass into `logs_dir/<run_id>` — initial run,
rejudging, deepening. Those files are the only trace of what actually went to
the providers: every call with its messages, the adversary's mirror view, the
judge prompt. The database keeps only the transcript rebuilt from the target's
point of view.

In a Cloud Run job they are written to a disk that dies with the container.
This module uploads them before that happens.

Storage is not PostgREST — neither the same service nor the same shape of URL —
hence a module of its own rather than one more method on
`supabase_store.Supabase`, whose name promises tables.
"""

import os
import sys
from dataclasses import dataclass
from pathlib import Path

import httpx

# Private, like `sample_model_usage` in `scoring.py`. The viewer refuses a
# directory without a manifest — "Please be sure you have deployed a manifest" —
# and inspect is what knows how to compose one, in the very version that wrote
# the logs. Building it ourselves would mean guessing at a shape that is not
# ours.
from inspect_ai.log._file import write_log_listing

BUCKET = "inspect-logs"
"""The bucket, private. Public, it would be enough to bypass `is_public`: the
logs are served only by a route that first checks who is looking."""


@dataclass
class Storage:
    """The strict minimum of Supabase Storage.

    `client` is injectable so that the tests need neither network nor bucket: it
    is the only point at which this module touches the outside world.
    """

    url: str
    key: str
    bucket: str = BUCKET
    client: httpx.Client | None = None

    @classmethod
    def from_env(cls) -> "Storage":
        """Builds the client from the environment, like `Supabase`."""
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set."
            )
        return cls(url=url.rstrip("/"), key=key)

    def _client(self) -> httpx.Client:
        if self.client is None:
            self.client = httpx.Client(
                base_url=self.url,
                headers={"apikey": self.key, "Authorization": f"Bearer {self.key}"},
                # More generous than PostgREST's 30 s: what goes up here is
                # files, not rows.
                timeout=120.0,
            )
        return self.client

    def upload(self, path: str, data: bytes) -> None:
        """Puts an object down, overwriting one that already bears the name.

        `x-upsert` is not a precaution against ourselves — each pass writes a
        distinct timestamped name — but against Cloud Run, which replays a
        failed task with the same `EVAL_RUN_ID`.
        """
        response = self._client().post(
            f"/storage/v1/object/{self.bucket}/{path}",
            content=data,
            headers={
                "Content-Type": "application/octet-stream",
                "x-upsert": "true",
            },
        )
        if response.status_code >= 400:
            raise RuntimeError(
                f"POST {path} → {response.status_code}: {response.text[:500]}"
            )


def upload_logs(
    run_id: str, logs_dir: Path, storage: Storage | None = None
) -> list[str]:
    """Uploads a run's `.eval` files, and never makes that run fail.

    A run whose matrix is complete and graded is a successful run. Losing its
    log is annoying; marking it `error` for that would be false. Everything that
    breaks here — missing bucket, oversized file, network — is written to
    `stderr` and stops there.

    The `listing.json` manifest is written by inspect before sending and goes up
    with the logs: the viewer refuses a directory without one.

    Returns:
        The names uploaded. Empty if the directory does not exist, or if
        everything failed.
    """
    directory = logs_dir / run_id
    if not directory.is_dir():
        return []

    try:
        storage = storage or Storage.from_env()
    except Exception as error:  # noqa: BLE001 — see the docstring
        print(f"[log_store] no Storage client: {error}", file=sys.stderr)
        return []

    try:
        write_log_listing(str(directory))
    except Exception as error:  # noqa: BLE001 — see the docstring
        # Without a manifest the viewer will list nothing, but an `.eval` kept
        # safe beats an `.eval` lost: we upload anyway.
        print(f"[log_store] manifest not written: {error}", file=sys.stderr)

    # Logs first, manifest last: it names files, and it must never name one
    # that is not uploaded yet.
    files = sorted(directory.glob("*.eval"))
    listing = directory / "listing.json"
    if listing.is_file():
        files.append(listing)

    uploaded: list[str] = []
    for path in files:
        try:
            storage.upload(f"{run_id}/{path.name}", path.read_bytes())
        except Exception as error:  # noqa: BLE001 — see the docstring
            print(f"[log_store] {path.name} not uploaded: {error}", file=sys.stderr)
            continue
        uploaded.append(path.name)
    return uploaded

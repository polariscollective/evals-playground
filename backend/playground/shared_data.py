"""The data Python and TypeScript must read identically.

Prices, measured response lengths, the catalogue and the judge prompt templates
live in `shared/`, at the root of the repository. The interface reads them to
quote a run and to show what the judge will receive; the job reads them to grade
and to bill. Copying the same numbers and the same sentences into two languages
is a guarantee that they will drift apart — and a wrong quote, or a preview that
does not match the prompt actually sent, are two lies nobody would see.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

SHARED_DIR = Path(__file__).resolve().parents[2] / "shared"
"""The repository root, then `shared/`.

The path is derived from where the module sits rather than from the working
directory: the job starts in `/app` inside its container, the tests start at the
root, and a relative path would break in one of the two.
"""


@lru_cache(maxsize=None)
def load(name: str) -> dict[str, Any]:
    """The contents of a shared file, read once and for all.

    Raises:
        FileNotFoundError: if the file is missing. A job that refuses to start
            beats a job that bills at the wrong price.
    """
    return json.loads((SHARED_DIR / f"{name}.json").read_text(encoding="utf-8"))

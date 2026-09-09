#!/usr/bin/env bash
# Copies Inspect's viewer into `web/public/inspect-view/`.
#
# The viewer ships as it stands in the `inspect-ai` package, under `_view/dist`:
# an `index.html` and an `assets/` folder. `inspect view bundle` does nothing but
# copy it while injecting the log folder to read — an injection the
# `web/app/inspect-view/[runId]/` route makes here instead, since a run's logs
# come from Storage and not from a neighbouring folder. We therefore take the
# shell alone, which saves having a run to hand in order to rebuild.
#
# The result is committed. To be replayed when `inspect-ai` goes up a version:
# the viewer must stay able to read the `.eval` files that version writes.
set -euo pipefail
cd "$(dirname "$0")/.."

OUTPUT=web/public/inspect-view

python - "$OUTPUT" <<'PY'
import shutil
import sys
from pathlib import Path

from inspect_ai._view._dist import resolve_dist_directory

output = Path(sys.argv[1])
shutil.rmtree(output, ignore_errors=True)
shutil.copytree(resolve_dist_directory(), output)

import inspect_ai

size = sum(f.stat().st_size for f in output.rglob("*") if f.is_file())
print(f"Viewer written to {output} ({size // 1024} kB)")
print(f"inspect version: {inspect_ai.__version__}")
PY

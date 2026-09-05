#!/usr/bin/env bash
# Copie le viewer d'Inspect dans `web/public/inspect-view/`.
#
# Le viewer est livré tel quel dans le paquet `inspect-ai`, sous `_view/dist` :
# un `index.html` et un dossier `assets/`. `inspect view bundle` ne fait que le
# recopier en lui injectant le dossier de journaux à lire — injection que fait
# ici la route `web/app/inspect-view/[runId]/`, puisque les journaux d'un run
# viennent de Storage et non d'un dossier voisin. On ne prend donc que la
# coquille, ce qui évite d'avoir un run sous la main pour reconstruire.
#
# Le résultat est commité. À rejouer quand `inspect-ai` monte de version : le
# viewer doit rester capable de lire les `.eval` que cette version écrit.
set -euo pipefail
cd "$(dirname "$0")/.."

SORTIE=web/public/inspect-view

python - "$SORTIE" <<'PY'
import shutil
import sys
from pathlib import Path

from inspect_ai._view._dist import resolve_dist_directory

sortie = Path(sys.argv[1])
shutil.rmtree(sortie, ignore_errors=True)
shutil.copytree(resolve_dist_directory(), sortie)

import inspect_ai

poids = sum(f.stat().st_size for f in sortie.rglob("*") if f.is_file())
print(f"Viewer écrit dans {sortie} ({poids // 1024} Ko)")
print(f"Version d'inspect : {inspect_ai.__version__}")
PY

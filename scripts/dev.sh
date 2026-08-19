#!/usr/bin/env bash
# Lance le backend et le front ensemble. Ctrl-C arrête les deux.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Pas de .env — copie .env.example et remplis tes clés." >&2
fi

trap 'kill 0' EXIT

.venv/bin/uvicorn playground.api:app --app-dir backend --port 8000 --reload &
npm --prefix web run dev &
wait

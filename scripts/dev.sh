#!/usr/bin/env bash
# Runs the application. One single server: Next's /api routes carry the whole
# service, and the evaluation engine only runs in a job, triggered on demand.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env — copy .env.example and fill in your keys." >&2
  exit 1
fi

# Next reads its variables from web/, not from the root.
ln -sf ../.env web/.env.local

npm --prefix web run dev

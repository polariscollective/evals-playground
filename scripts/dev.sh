#!/usr/bin/env bash
# Lance l'application. Il n'y a plus qu'un serveur : les routes /api de Next
# portent ce que FastAPI faisait, et le moteur d'évaluation ne tourne que dans
# un job, déclenché à la demande.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Pas de .env — copie .env.example et remplis tes clés." >&2
  exit 1
fi

# Next lit ses variables depuis web/, pas depuis la racine.
ln -sf ../.env web/.env.local

npm --prefix web run dev

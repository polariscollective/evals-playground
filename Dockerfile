# L'image du Cloud Run Job : le moteur d'évaluation, et rien d'autre.
#
# Ni FastAPI ni interface — ceux-là vivent sur Vercel. Ce conteneur reçoit un
# EVAL_RUN_ID par variable d'environnement, déroule les conversations, les fait
# noter, et écrit chaque case dans Supabase.
FROM python:3.12-slim

WORKDIR /app

# Les dépendances d'abord, le code ensuite : sans ça, modifier une ligne de
# Python réinstallerait inspect_ai et les trois SDK de fournisseurs à chaque
# build. Le paquet lui-même est désinstallé aussitôt posé — seules ses
# dépendances devaient rester, le code arrive à l'étape suivante et fait
# autorité par PYTHONPATH.
COPY pyproject.toml ./
COPY backend/playground/__init__.py ./backend/playground/
RUN pip install --no-cache-dir . \
 && pip uninstall --yes --no-input evals-playground

COPY backend/ ./backend/
COPY shared/ ./shared/
ENV PYTHONPATH=/app/backend

# Les journaux d'inspect sont éphémères ici : ce qui compte est en base.
ENV EVAL_LOGS_DIR=/tmp/eval-logs

CMD ["python", "-m", "playground.batch_job"]

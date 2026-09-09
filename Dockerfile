# The Cloud Run Job's image: the evaluation engine, and nothing else.
#
# Neither FastAPI nor an interface — those live on Vercel. This container
# receives an EVAL_RUN_ID through an environment variable, unrolls the
# conversations, has them graded, and writes each cell to Supabase.
FROM python:3.12-slim

WORKDIR /app

# The dependencies first, the code afterwards: without this, changing one line of
# Python would reinstall inspect_ai and the three provider SDKs on every build.
# The package itself is uninstalled as soon as it is laid down — only its
# dependencies had to stay, the code arrives at the next step and is authoritative
# through PYTHONPATH.
COPY pyproject.toml ./
COPY backend/playground/__init__.py ./backend/playground/
RUN pip install --no-cache-dir . \
 && pip uninstall --yes --no-input evals-playground

COPY backend/ ./backend/
COPY shared/ ./shared/
ENV PYTHONPATH=/app/backend

# Inspect's logs are ephemeral here: what counts is in the database.
ENV EVAL_LOGS_DIR=/tmp/eval-logs

CMD ["python", "-m", "playground.batch_job"]

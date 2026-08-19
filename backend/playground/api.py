"""L'application HTTP du playground.

Elle ne porte que le catalogue de modèles, commun aux deux phases, et monte un
routeur par phase. Chaque routeur reste responsable de son propre domaine.
"""

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from playground.catalog import ProviderInfo, catalog
from playground.eval_api import router as eval_router

load_dotenv()

app = FastAPI(title="Playground d'évaluation")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/catalog", response_model=list[ProviderInfo])
def get_catalog() -> list[ProviderInfo]:
    """Les providers et l'état courant de leurs clés d'API.

    `key_present` permet à l'interface de griser un provider dont la clé
    manque, plutôt que de laisser le run échouer à l'exécution.
    """
    return catalog()


app.include_router(eval_router)

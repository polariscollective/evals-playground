"""Les données que Python et TypeScript doivent lire à l'identique.

Les tarifs, les longueurs de réponse mesurées, le catalogue et les gabarits du
prompt du juge vivent dans `shared/`, à la racine du dépôt. L'interface les lit
pour chiffrer un run et montrer ce que le juge recevra ; le job les lit pour
noter et pour facturer. Recopier les mêmes nombres et les mêmes phrases dans
deux langages, c'est se garantir qu'ils divergeront — et un devis faux ou un
aperçu qui ne correspond pas au prompt réellement envoyé sont deux mensonges
qu'on ne verrait pas.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

SHARED_DIR = Path(__file__).resolve().parents[2] / "shared"
"""Racine du dépôt, puis `shared/`.

Le chemin est déduit de l'emplacement du module plutôt que du répertoire de
travail : le job démarre depuis `/app` dans son conteneur, les tests depuis la
racine, et un chemin relatif casserait dans l'un des deux.
"""


@lru_cache(maxsize=None)
def load(name: str) -> dict[str, Any]:
    """Le contenu d'un fichier partagé, lu une fois pour toutes.

    Raises:
        FileNotFoundError: si le fichier manque. Mieux vaut un job qui refuse de
            démarrer qu'un job qui facture au mauvais tarif.
    """
    return json.loads((SHARED_DIR / f"{name}.json").read_text(encoding="utf-8"))

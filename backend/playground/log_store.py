"""Les journaux d'Inspect, montés dans Supabase Storage.

Inspect écrit un `.eval` par passe dans `logs_dir/<run_id>` — run initial,
rejugement, approfondissement. Ces fichiers sont la seule trace de ce qui est
réellement parti aux fournisseurs : chaque appel avec ses messages, la vue
miroir de l'adversaire, le prompt du juge. La base, elle, ne garde que le
transcript reconstruit du point de vue de la cible.

Dans un job Cloud Run ils s'écrivent sur un disque qui meurt avec le conteneur.
Ce module les monte avant que ça arrive.

Storage n'est pas PostgREST — ni le même service, ni la même forme d'URL — d'où
un module à part plutôt qu'une méthode de plus sur `supabase_store.Supabase`,
dont le nom promet des tables.
"""

import os
import sys
from dataclasses import dataclass
from pathlib import Path

import httpx

# Privé, comme `sample_model_usage` dans `scoring.py`. Le viewer refuse un
# dossier sans manifeste — « Please be sure you have deployed a manifest » — et
# c'est inspect qui sait le composer, dans la version même qui a écrit les
# journaux. Le fabriquer nous-mêmes reviendrait à deviner une forme qui n'est
# pas la nôtre.
from inspect_ai.log._file import write_log_listing

BUCKET = "inspect-logs"
"""Le bucket, privé. Public, il suffirait à contourner `is_public` : les
journaux ne sont servis que par une route qui vérifie d'abord qui regarde."""


@dataclass
class Storage:
    """Le strict nécessaire de Supabase Storage.

    `client` est injectable pour que les tests n'aient besoin ni de réseau ni de
    bucket : c'est le seul point par lequel ce module touche le monde extérieur.
    """

    url: str
    key: str
    bucket: str = BUCKET
    client: httpx.Client | None = None

    @classmethod
    def from_env(cls) -> "Storage":
        """Construit le client depuis l'environnement, comme `Supabase`."""
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set."
            )
        return cls(url=url.rstrip("/"), key=key)

    def _client(self) -> httpx.Client:
        if self.client is None:
            self.client = httpx.Client(
                base_url=self.url,
                headers={"apikey": self.key, "Authorization": f"Bearer {self.key}"},
                # Plus généreux que les 30 s de PostgREST : on pousse ici des
                # fichiers, pas des lignes.
                timeout=120.0,
            )
        return self.client

    def upload(self, path: str, data: bytes) -> None:
        """Dépose un objet, en écrasant celui qui porterait déjà ce nom.

        `x-upsert` n'est pas une précaution contre nous-mêmes — chaque passe
        écrit un nom horodaté distinct — mais contre Cloud Run, qui rejoue une
        tâche échouée avec le même `EVAL_RUN_ID`.
        """
        response = self._client().post(
            f"/storage/v1/object/{self.bucket}/{path}",
            content=data,
            headers={
                "Content-Type": "application/octet-stream",
                "x-upsert": "true",
            },
        )
        if response.status_code >= 400:
            raise RuntimeError(
                f"POST {path} → {response.status_code}: {response.text[:500]}"
            )


def upload_logs(
    run_id: str, logs_dir: Path, storage: Storage | None = None
) -> list[str]:
    """Monte les `.eval` d'un run, et ne fait jamais échouer ce run.

    Un run dont la matrice est complète et notée est un run réussi. Perdre son
    journal est ennuyeux ; le marquer `error` pour ça serait faux. Tout ce qui
    casse ici — bucket absent, fichier trop gros, réseau — s'écrit sur `stderr`
    et s'arrête là.

    Le manifeste `listing.json` est écrit par inspect avant l'envoi et monte
    avec les journaux : le viewer refuse un dossier qui n'en a pas.

    Returns:
        Les noms montés. Vide si le dossier n'existe pas, ou si tout a échoué.
    """
    directory = logs_dir / run_id
    if not directory.is_dir():
        return []

    try:
        storage = storage or Storage.from_env()
    except Exception as error:  # noqa: BLE001 — voir la docstring
        print(f"[log_store] pas de client Storage : {error}", file=sys.stderr)
        return []

    try:
        write_log_listing(str(directory))
    except Exception as error:  # noqa: BLE001 — voir la docstring
        # Sans manifeste le viewer ne listera rien, mais un `.eval` en sécurité
        # vaut mieux qu'un `.eval` perdu : on monte quand même.
        print(f"[log_store] manifeste non écrit : {error}", file=sys.stderr)

    # Les journaux d'abord, le manifeste en dernier : il nomme des fichiers, et
    # il ne doit jamais en nommer un qui n'est pas encore monté.
    fichiers = sorted(directory.glob("*.eval"))
    listing = directory / "listing.json"
    if listing.is_file():
        fichiers.append(listing)

    montés: list[str] = []
    for path in fichiers:
        try:
            storage.upload(f"{run_id}/{path.name}", path.read_bytes())
        except Exception as error:  # noqa: BLE001 — voir la docstring
            print(f"[log_store] {path.name} non monté : {error}", file=sys.stderr)
            continue
        montés.append(path.name)
    return montés

"""Les tarifs des modèles, et le coût réel d'un run.

Le *devis* — ce que le run coûtera, estimé avant de le lancer — n'est plus ici :
il vit dans `web/lib/pricing.ts`, et nulle part ailleurs. Il a été écrit en
Python d'abord (`88f90ef`), puis porté en TypeScript quand l'application est
passée sur Next.js (`ef60372`) ; la copie Python est restée sur place sans
jamais être rappelée par le moteur, et chaque changement du devis reposait la
question de la porter. Elle est partie plutôt que d'y répondre une fois de plus
— voir `docs/superpowers/specs/2026-09-08-devis-par-role-design.md`.

Ce qui reste tourne vraiment dans le job : la table des tarifs, que `catalog.py`
lit aussi, et `actual_cost`, qui chiffre les jetons réellement consommés une
fois le run joué. Aucune hypothèse ici, donc : que des compteurs rapportés par
les fournisseurs.

Les tarifs sont ceux relevés le 19 août 2026 sur les documentations des quatre
fournisseurs. Ils changent : `shared/pricing.json` est le seul endroit à mettre
à jour.
"""

from dataclasses import dataclass

from playground.eval_schemas import ModelUsage
from playground.shared_data import load

_SHARED = load("pricing")
"""Tarifs, calibrations et catalogue, partagés avec TypeScript.

Les valeurs ci-dessous en sont extraites plutôt qu'écrites ici : c'est le seul
moyen que le devis affiché par l'interface et le coût calculé par le job ne
puissent pas diverger. Les changer se fait dans `shared/pricing.json`.
"""


@dataclass(frozen=True)
class ModelPrice:
    """Tarif d'un modèle, en dollars par million de jetons."""

    input_per_mtok: float
    output_per_mtok: float


PRICES: dict[str, ModelPrice] = {
    name: ModelPrice(tarif["input_per_mtok"], tarif["output_per_mtok"])
    for name, tarif in _SHARED["prices"].items()
}




CACHE_READ_MULTIPLIER = _SHARED["cache_read_multiplier"]
CACHE_WRITE_MULTIPLIER = _SHARED["cache_write_multiplier"]
"""Tarifs relatifs des jetons d'entrée mis en cache.

Les quatre fournisseurs facturent une lecture de cache à 10 % du tarif
d'entrée — vérifié aussi pour Google, qui n'a rejoint le catalogue qu'après
que cette note ait été écrite pour les trois autres. Anthropic facture
l'écriture 25 % de plus que l'entrée normale ; OpenAI, xAI et Google ne
facturent pas l'écriture, et rapportent donc zéro sur ce compteur — la
formule reste juste pour eux.

Une nuance propre à Google, et seulement aux modèles que `PRICES` porte à leur
tarif *promotionnel* plutôt qu'à son tarif d'entrée *standard*, sur lequel
portent les 10 % : `gemini-3.8-flash`, `gemini-3.7-flash` et
`gemini-3.6-flash` sont ici à 0.75 $/Mtok, promotion courant jusqu'au 31
décembre 2026, plutôt que leur tarif standard de 1.50 $/Mtok. Pendant la
fenêtre promotionnelle, une lecture de cache sur ces trois-là coûte donc en
réalité environ 20 % du tarif que porte cette table, et `actual_cost` sous-
compte ce poste-là pour eux jusqu'à l'échéance de la promotion.
`gemini-3.5-flash`, au même tarif standard de 1.50 $/Mtok, n'a pas cette
nuance : les 10 % y sont exacts. L'écart reste minime et borné, et n'est pas
corrigé ici : rien à changer dans le coefficient lui-même, 10 % reste juste
pour les trois autres fournisseurs et redeviendra juste pour ces trois
modèles-là une fois leur promotion terminée.

Sans ces coefficients, le coût réel serait faux dans les deux sens : inspect
compte les jetons de cache séparément de `input_tokens`, si bien que les
ignorer sous-estime, et les facturer plein tarif surestime.
"""


def actual_cost(usage: dict[str, ModelUsage]) -> tuple[float, list[str]]:
    """Coût réel en dollars, calculé sur les jetons effectivement consommés.

    Aucune hypothèse ici, contrairement au devis (`web/lib/pricing.ts`) : les
    compteurs viennent du log d'inspect, qui les tient des réponses des
    fournisseurs.

    Returns:
        Le coût, et la liste des modèles sans tarif connu. Un modèle inconnu
        n'est pas facturé à zéro en silence : l'appelant doit décider quoi
        afficher, un total partiel étant trompeur.
    """
    total = 0.0
    unpriced: list[str] = []
    for model, counts in usage.items():
        price = PRICES.get(model)
        if price is None:
            unpriced.append(model)
            continue
        total += (
            counts.input_tokens * price.input_per_mtok
            + counts.input_tokens_cache_read
            * price.input_per_mtok
            * CACHE_READ_MULTIPLIER
            + counts.input_tokens_cache_write
            * price.input_per_mtok
            * CACHE_WRITE_MULTIPLIER
            + counts.output_tokens * price.output_per_mtok
        ) / 1_000_000
    return total, sorted(unpriced)

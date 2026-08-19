"""Estimation du coût d'un run avant de le lancer.

Le nombre d'appels de modèle est parfaitement connu d'avance : les tours
s'exécutent tous, toujours. Ce qui ne l'est pas, c'est la longueur des
réponses — et comme chaque tour renvoie tout l'historique au modèle suivant,
une réponse longue enfle le coût de tous les tours qui la suivent. D'où une
fourchette, dont les bornes viennent d'hypothèses sur cette longueur.

Les tarifs sont ceux relevés le 19 août 2026 sur les documentations des trois
fournisseurs. Ils changent : ce fichier est le seul endroit à mettre à jour.
"""

from dataclasses import dataclass

from playground.eval_schemas import EvalRunConfig, ModelUsage

CHARS_PER_TOKEN = 3.5
"""Approximation du nombre de caractères par jeton.

Volontairement basse — le français consomme plus de jetons que l'anglais à
longueur égale. Sous-estimer les jetons produirait une facture plus élevée
qu'annoncée, ce qui est le sens de l'erreur qu'on ne veut pas.
"""

SHORT_RESPONSE_TOKENS = 200
LONG_RESPONSE_TOKENS = 4000
"""Bornes d'hypothèse sur la longueur d'une réponse de modèle.

Calibrées le 19 août 2026 sur 238 appels réels : la sortie moyenne par appel
va de 137 jetons (grok-4.3) à 5 954 (gpt-5.6-sol). Les modèles à raisonnement
facturent leurs jetons de réflexion en sortie, ce qui explique l'écart de
quarante fois entre les extrêmes.

Les bornes précédentes — 150 et 900 — venaient d'une intuition, pas d'une
mesure : elles ont annoncé « au plus 2,45 $ » pour un run qui en a coûté 7,95.
Une borne haute que le réel dépasse est pire qu'une fourchette large, parce
que c'est sur elle que se prend la décision de lancer.
"""

DEFAULT_RESPONSE_TOKENS = 1100
"""Longueur moyenne supposée d'une réponse, en jetons.

C'est la moyenne mesurée sur 238 appels réels le 19 août 2026, tous modèles
confondus. Elle est modifiable depuis le formulaire, parce qu'elle dépend
surtout du modèle évalué : de 137 jetons par appel pour grok-4.3 à 5 954 pour
gpt-5.6-sol, dont le raisonnement est facturé en sortie.

Le coût croît à peu près linéairement avec cette valeur, et entre linéaire et
quadratique avec le nombre de tours — l'historique complet étant renvoyé à
chaque tour, l'entrée croît en carré tandis que la sortie reste linéaire.
"""

JUDGE_RESPONSE_TOKENS = 200
"""Le juge rend un verdict et une phrase : sa sortie est courte et prévisible."""

USD_TO_EUR = 0.92
"""Taux de conversion indicatif. Une estimation, pas une conversion comptable."""


@dataclass(frozen=True)
class ModelPrice:
    """Tarif d'un modèle, en dollars par million de jetons."""

    input_per_mtok: float
    output_per_mtok: float


PRICES: dict[str, ModelPrice] = {
    "anthropic/claude-opus-5": ModelPrice(5.00, 25.00),
    # Claude Sonnet 5 est en tarif d'introduction à 2,00 / 10,00 jusqu'au
    # 31 août 2026. On encode le tarif standard : l'estimation est donc
    # conservatrice jusqu'à cette date, ce qui est le bon sens de l'erreur.
    "anthropic/claude-sonnet-5": ModelPrice(3.00, 15.00),
    "anthropic/claude-haiku-4-5": ModelPrice(1.00, 5.00),
    "openai/gpt-5.6-sol": ModelPrice(5.00, 30.00),
    "openai/gpt-5.6-terra": ModelPrice(2.00, 12.00),
    "openai/gpt-5.6-luna": ModelPrice(0.20, 1.20),
    # Grok double ses tarifs au-delà de 200 000 jetons d'entrée. Un run de ce
    # produit n'en approche pas — dix tours font quelques milliers de jetons.
    "grok/grok-4.6": ModelPrice(2.00, 6.00),
    "grok/grok-4.5": ModelPrice(2.00, 6.00),
    "grok/grok-4.3": ModelPrice(1.25, 2.50),
}


@dataclass(frozen=True)
class TokenEstimate:
    """Volume d'un run, indépendamment des tarifs."""

    conversations: int
    model_calls: int
    target_input: int
    target_output: int
    adversary_input: int
    adversary_output: int
    judge_input: int
    judge_output: int


@dataclass(frozen=True)
class CostEstimate:
    """Coût attendu d'un run et son encadrement."""

    response_tokens: int
    """L'hypothèse de longueur de réponse qui produit `usd`."""

    usd: float
    eur: float
    """Coût pour cette hypothèse. C'est le chiffre à lire."""

    min_usd: float
    max_usd: float
    min_eur: float
    max_eur: float
    """Encadrement par les extrêmes du catalogue, indépendant de l'hypothèse."""

    conversations: int
    model_calls: int
    input_tokens: int
    output_tokens: int
    unpriced_models: list[str]


def _tokens(text: str) -> int:
    return max(1, int(len(text) / CHARS_PER_TOKEN))


def _estimate_one_conversation(
    config: EvalRunConfig, scenario_index: int, response_tokens: int
) -> tuple[int, int, int, int, int, int]:
    """Jetons d'une conversation, pour une hypothèse de longueur de réponse.

    Renvoie, dans l'ordre : entrée et sortie du modèle évalué, entrée et sortie
    de l'adversaire, entrée et sortie du juge.

    L'historique est renvoyé en entier à chaque tour : c'est ce qui fait croître
    le coût plus vite que le nombre de tours.
    """
    scenario = config.scenarios[scenario_index]
    system = _tokens(scenario.system_prompt)
    opening = _tokens(scenario.opening_message)

    target_input = target_output = 0
    adversary_input = adversary_output = 0
    history = opening

    for turn in range(config.turns):
        target_input += system + history
        target_output += response_tokens
        history += response_tokens

        if turn < config.turns - 1:
            adversary_input += _tokens(config.adversary_prompt) + opening + history
            adversary_output += response_tokens
            history += response_tokens

    judge_input = _tokens(config.criterion) + history + system
    judge_output = JUDGE_RESPONSE_TOKENS

    return (
        target_input,
        target_output,
        adversary_input,
        adversary_output,
        judge_input,
        judge_output,
    )


def estimate_tokens(
    config: EvalRunConfig, response_tokens: int = SHORT_RESPONSE_TOKENS
) -> TokenEstimate:
    """Volume total d'un run, pour une hypothèse de longueur de réponse."""
    conversations = (
        len(config.scenarios) * len(config.models.targets) * config.repetitions
    )
    calls_per_conversation = config.turns + max(config.turns - 1, 0) + 1

    totals = [0] * 6
    for scenario_index in range(len(config.scenarios)):
        parts = _estimate_one_conversation(config, scenario_index, response_tokens)
        weight = len(config.models.targets) * config.repetitions
        totals = [total + part * weight for total, part in zip(totals, parts)]

    return TokenEstimate(
        conversations=conversations,
        model_calls=conversations * calls_per_conversation,
        target_input=totals[0],
        target_output=totals[1],
        adversary_input=totals[2],
        adversary_output=totals[3],
        judge_input=totals[4],
        judge_output=totals[5],
    )


def _price_of(name: str) -> ModelPrice | None:
    return PRICES.get(name)


def _cost_for(config: EvalRunConfig, response_tokens: int) -> tuple[float, list[str]]:
    """Coût en dollars pour une hypothèse de longueur, et les modèles sans tarif."""
    estimate = estimate_tokens(config, response_tokens)
    unpriced: list[str] = []
    total = 0.0

    # Le volume du modèle évalué se répartit également entre les modèles cochés.
    per_target_input = estimate.target_input / len(config.models.targets)
    per_target_output = estimate.target_output / len(config.models.targets)
    for target in config.models.targets:
        price = _price_of(target)
        if price is None:
            unpriced.append(target)
            continue
        total += per_target_input / 1e6 * price.input_per_mtok
        total += per_target_output / 1e6 * price.output_per_mtok

    if config.models.adversary and estimate.adversary_input:
        price = _price_of(config.models.adversary)
        if price is None:
            unpriced.append(config.models.adversary)
        else:
            total += estimate.adversary_input / 1e6 * price.input_per_mtok
            total += estimate.adversary_output / 1e6 * price.output_per_mtok

    price = _price_of(config.models.judge)
    if price is None:
        unpriced.append(config.models.judge)
    else:
        total += estimate.judge_input / 1e6 * price.input_per_mtok
        total += estimate.judge_output / 1e6 * price.output_per_mtok

    return total, unpriced


def estimate_cost(
    config: EvalRunConfig, response_tokens: int | None = None
) -> CostEstimate:
    """Coût d'un run, pour une longueur de réponse supposée, et sa fourchette.

    `usd` est le chiffre à lire : le coût si les réponses font en moyenne
    `response_tokens` jetons. Les bornes encadrent ce chiffre en supposant des
    réponses très courtes puis très longues ; elles ne bougent pas quand on
    change la moyenne, ce sont les extrêmes du catalogue.

    Un modèle absent du tarif est signalé plutôt qu'ignoré : une estimation qui
    oublie silencieusement un modèle est pire que pas d'estimation du tout.
    """
    assumed = DEFAULT_RESPONSE_TOKENS if response_tokens is None else response_tokens
    assumed = max(1, min(assumed, 100_000))

    expected, unpriced = _cost_for(config, assumed)
    low, _ = _cost_for(config, SHORT_RESPONSE_TOKENS)
    high, _ = _cost_for(config, LONG_RESPONSE_TOKENS)
    volume = estimate_tokens(config, assumed)

    return CostEstimate(
        response_tokens=assumed,
        usd=round(expected, 4),
        eur=round(expected * USD_TO_EUR, 4),
        min_usd=round(low, 4),
        max_usd=round(high, 4),
        min_eur=round(low * USD_TO_EUR, 4),
        max_eur=round(high * USD_TO_EUR, 4),
        conversations=volume.conversations,
        model_calls=volume.model_calls,
        output_tokens=volume.target_output
        + volume.adversary_output
        + volume.judge_output,
        input_tokens=volume.target_input
        + volume.adversary_input
        + volume.judge_input,
        unpriced_models=sorted(set(unpriced)),
    )


CACHE_READ_MULTIPLIER = 0.10
CACHE_WRITE_MULTIPLIER = 1.25
"""Tarifs relatifs des jetons d'entrée mis en cache.

Les trois fournisseurs facturent une lecture de cache à 10 % du tarif d'entrée.
Anthropic facture l'écriture 25 % de plus que l'entrée normale ; OpenAI et xAI
ne facturent pas l'écriture, et rapportent donc zéro sur ce compteur — la
formule reste juste pour eux.

Sans ces coefficients, le coût réel serait faux dans les deux sens : inspect
compte les jetons de cache séparément de `input_tokens`, si bien que les
ignorer sous-estime, et les facturer plein tarif surestime.
"""


def actual_cost(usage: dict[str, ModelUsage]) -> tuple[float, list[str]]:
    """Coût réel en dollars, calculé sur les jetons effectivement consommés.

    Contrairement à `estimate_cost`, il n'y a ici aucune hypothèse sur la
    longueur des réponses : les compteurs viennent du log d'inspect, qui les
    tient des réponses des fournisseurs.

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

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
from playground.shared_data import load

_SHARED = load("pricing")
"""Tarifs, calibrations et catalogue, partagés avec TypeScript.

Les valeurs ci-dessous en sont extraites plutôt qu'écrites ici : c'est le seul
moyen que le devis affiché par l'interface et le coût calculé par le job ne
puissent pas diverger. Les changer se fait dans `shared/pricing.json`.
"""

CHARS_PER_TOKEN = _SHARED["chars_per_token"]
"""Approximation du nombre de caractères par jeton, pour les textes saisis.

Mesurée sur les réponses réelles d'un run en français : 7 293 caractères pour
3 608 jetons facturés, soit 2,0 caractère par jeton. Le français en consomme
nettement plus que l'anglais, et la valeur précédente — 3,5 — sous-estimait
donc les jetons d'entrée de près de moitié, dans le sens de l'erreur qu'on ne
veut pas : une facture plus élevée qu'annoncée.

Ne sert qu'à l'entrée : les prompts, le message d'ouverture, la question posée
au juge. Les sorties, elles, ne sont plus déduites d'une longueur de texte mais
de `OUTPUT_TOKENS_PER_CALL`.
"""

SHORT_RESPONSE_TOKENS = _SHARED["short_response_tokens"]
LONG_RESPONSE_TOKENS = _SHARED["long_response_tokens"]
"""Bornes d'hypothèse sur la longueur d'une réponse de modèle.

Elles encadrent le devis en supposant que *tous* les modèles répondent très
court, puis très long. Le haut est calé sur le modèle le plus bavard mesuré,
`gpt-5.6-sol` et ses 5 954 jetons par appel : une borne haute que le réel
dépasse est pire qu'une fourchette large, parce que c'est sur elle que se prend
la décision de lancer.
"""

DEFAULT_RESPONSE_TOKENS = _SHARED["default_response_tokens"]
"""Longueur supposée d'une réponse pour un modèle jamais mesuré.

C'est la moyenne tous modèles confondus relevée le 19 août 2026. Elle ne sert
plus qu'aux modèles absents de `OUTPUT_TOKENS_PER_CALL` : pour les autres, une
moyenne globale est une mauvaise réponse à une question qui varie d'un facteur
quarante d'un modèle à l'autre.
"""

OUTPUT_TOKENS_PER_CALL: dict[str, int] = _SHARED["output_tokens_per_call"]
"""Longueur de réponse mesurée, par modèle.

Un modèle absent d'ici prend `DEFAULT_RESPONSE_TOKENS` : mieux vaut une valeur
moyenne assumée qu'une mesure inventée. `claude-opus-5` en fait partie — ses
réponses ont toutes été bloquées par le filtre du fournisseur dans le seul run
où il a été évalué, ce qui ne mesure rien.
"""

JUDGE_RESPONSE_TOKENS = _SHARED["judge_response_tokens"]
"""Le juge rend une note et une phrase : sa sortie est courte et prévisible."""

USD_TO_EUR = _SHARED["usd_to_eur"]
"""Taux de conversion indicatif. Une estimation, pas une conversion comptable."""


@dataclass(frozen=True)
class ModelPrice:
    """Tarif d'un modèle, en dollars par million de jetons."""

    input_per_mtok: float
    output_per_mtok: float


PRICES: dict[str, ModelPrice] = {
    name: ModelPrice(tarif["input_per_mtok"], tarif["output_per_mtok"])
    for name, tarif in _SHARED["prices"].items()
}


def response_tokens_for(model: str, override: int | None = None) -> int:
    """Longueur de réponse supposée pour un modèle.

    Args:
        model: L'identifiant complet du modèle.
        override: Une longueur imposée depuis le formulaire, qui s'applique
            alors à tous les modèles. `None` laisse chacun prendre la sienne.
    """
    if override is not None:
        return override
    return OUTPUT_TOKENS_PER_CALL.get(model, DEFAULT_RESPONSE_TOKENS)


@dataclass
class ModelTokens:
    """Jetons attribués à un modèle, tous ses rôles confondus.

    Un même modèle peut être à la fois évalué et juge dans un run : c'est son
    total qui est facturé, pas celui d'un de ses rôles.
    """

    input: int = 0
    output: int = 0
    response_tokens: int = 0
    """Longueur supposée de ses propres réponses, celle qui a produit `output`.

    Pour un modèle qui n'est que juge, c'est `JUDGE_RESPONSE_TOKENS`. Pour un
    modèle qui cumule les rôles, c'est celle de ses réponses de modèle évalué :
    c'est elle qui pèse, celle du juge étant une constante courte.
    """


@dataclass(frozen=True)
class TokenEstimate:
    """Volume d'un run, indépendamment des tarifs."""

    conversations: int
    model_calls: int
    per_model: dict[str, ModelTokens]


@dataclass(frozen=True)
class ModelCost:
    """Ce qu'un modèle coûte dans un run, et sur quelle hypothèse."""

    model: str
    input_tokens: int
    output_tokens: int
    response_tokens: int
    usd: float | None
    """`None` si le modèle n'a pas de tarif connu."""


@dataclass(frozen=True)
class CostEstimate:
    """Coût attendu d'un run et son encadrement."""

    response_tokens: int | None
    """La longueur imposée à tous les modèles, ou `None` si chacun prend la sienne."""

    usd: float
    eur: float
    """Coût attendu. C'est le chiffre à lire."""

    min_usd: float
    max_usd: float
    min_eur: float
    max_eur: float
    """Encadrement : tous les modèles très courts, puis tous très longs."""

    conversations: int
    model_calls: int
    input_tokens: int
    output_tokens: int
    per_model: list[ModelCost]
    """Le détail, du plus cher au moins cher. C'est lui qui explique un total."""

    unpriced_models: list[str]


def _tokens(text: str) -> int:
    return max(1, int(len(text) / CHARS_PER_TOKEN))


def _rubric_tokens(config: EvalRunConfig) -> int:
    """Jetons de l'échelle telle qu'elle est écrite au juge.

    Les paliers exclus de la moyenne comptent ici : le juge les reçoit comme
    les autres, c'est seulement l'agrégation qui les met de côté.
    """
    return sum(_tokens(level.meaning) + 4 for level in config.rubric)


def _fixed_tokens(text: str, *placeholders: str) -> int:
    """Jetons d'un gabarit, une fois ses emplacements retirés.

    C'est la part qui ne dépend pas du run : le texte que le modèle reçoit à
    chaque appel quoi qu'on lui demande.
    """
    for emplacement in placeholders:
        text = text.replace(emplacement, "")
    return _tokens(text)


JUDGE_OVERHEAD_TOKENS = _fixed_tokens(
    load("judge-prompt")["system"]
) + _fixed_tokens(
    load("judge-prompt")["user_template"],
    "{criterion}", "{transcript}", "{rubric}", "{values}",
)
"""Ce que le juge reçoit à chaque appel en plus du run lui-même.

Son message système et l'ossature de son message utilisateur — environ trois
cents jetons. Les ignorer sous-estimait chaque appel de juge, d'autant plus que
la matrice est grande.

Mesuré sur les gabarits plutôt qu'écrit en dur : une reformulation du prompt se
répercute alors sur le devis toute seule.
"""

ADVERSARY_OVERHEAD_TOKENS = _fixed_tokens(
    load("adversary-prompt")["system_template"],
    "{notice}", "{adversary_prompt}", "{opening_message}",
) + 2 * _tokens(load("adversary-prompt")["confidentiality_notice"])
"""Ce que l'adversaire reçoit en plus de son objectif, à chaque appel.

La consigne de confidentialité y figure **deux fois**, avant et après
l'objectif — d'où le facteur deux, qui n'est pas une faute de frappe.
"""


def _add(
    per_model: dict[str, ModelTokens],
    model: str,
    input_tokens: int,
    output_tokens: int,
    response_tokens: int,
) -> None:
    """Ajoute un volume au compte d'un modèle, en créant son entrée au besoin.

    `response_tokens` n'est retenu qu'à la première attribution : les rôles sont
    parcourus du modèle évalué vers le juge, si bien qu'un modèle qui cumule
    garde l'hypothèse de ses réponses de modèle évalué — la seule qui pèse.
    """
    entry = per_model.setdefault(model, ModelTokens())
    if entry.response_tokens == 0:
        entry.response_tokens = response_tokens
    entry.input += input_tokens
    entry.output += output_tokens


def estimate_tokens(
    config: EvalRunConfig, response_tokens: int | None = None
) -> TokenEstimate:
    """Volume total d'un run, réparti par modèle.

    Chaque modèle évalué est déroulé avec sa propre longueur de réponse, et non
    avec une moyenne commune : comme l'historique complet est renvoyé à chaque
    tour, un modèle bavard enfle aussi l'entrée de l'adversaire et celle du
    juge. Répartir un volume commun à parts égales, ce que faisait la version
    précédente, effaçait précisément l'écart qu'on cherche à chiffrer.

    Args:
        config: Le run à estimer.
        response_tokens: Longueur imposée à tous les modèles, ou `None` pour
            laisser chacun prendre la sienne.
    """
    per_model: dict[str, ModelTokens] = {}
    judge = config.models.judge
    adversary = config.models.adversary if config.turns > 1 else None
    adversary_response = (
        response_tokens_for(adversary, response_tokens) if adversary else 0
    )
    question = _tokens(config.criterion) + _rubric_tokens(config)
    adversary_prompt = _tokens(config.adversary_prompt)

    for scenario in config.scenarios:
        system = _tokens(scenario.system_prompt)
        opening = _tokens(scenario.opening_message)

        for target in config.models.targets:
            target_response = response_tokens_for(target, response_tokens)
            target_input = target_output = 0
            adversary_input = adversary_output = 0
            history = opening

            for turn in range(config.turns):
                target_input += system + history
                target_output += target_response
                history += target_response

                if turn < config.turns - 1:
                    # L'historique contient déjà le message d'ouverture : ne
                    # compter que le prompt de l'adversaire en plus.
                    adversary_input += (
                        adversary_prompt + history + ADVERSARY_OVERHEAD_TOKENS
                    )
                    adversary_output += adversary_response
                    history += adversary_response

            judge_input = question + system + history + JUDGE_OVERHEAD_TOKENS

            weight = config.repetitions
            _add(
                per_model,
                target,
                target_input * weight,
                target_output * weight,
                target_response,
            )
            if adversary and adversary_input:
                _add(
                    per_model,
                    adversary,
                    adversary_input * weight,
                    adversary_output * weight,
                    adversary_response,
                )
            _add(
                per_model,
                judge,
                judge_input * weight,
                JUDGE_RESPONSE_TOKENS * weight,
                JUDGE_RESPONSE_TOKENS,
            )

    conversations = (
        len(config.scenarios) * len(config.models.targets) * config.repetitions
    )
    calls_per_conversation = config.turns + max(config.turns - 1, 0) + 1

    return TokenEstimate(
        conversations=conversations,
        model_calls=conversations * calls_per_conversation,
        per_model=per_model,
    )


def _costs_for(
    config: EvalRunConfig, response_tokens: int | None
) -> tuple[list[ModelCost], float, list[str]]:
    """Coût par modèle, total, et modèles sans tarif connu."""
    estimate = estimate_tokens(config, response_tokens)
    costs: list[ModelCost] = []
    total = 0.0
    unpriced: list[str] = []

    for model, tokens in estimate.per_model.items():
        price = PRICES.get(model)
        if price is None:
            unpriced.append(model)
            usd = None
        else:
            usd = (
                tokens.input / 1e6 * price.input_per_mtok
                + tokens.output / 1e6 * price.output_per_mtok
            )
            total += usd
        costs.append(
            ModelCost(
                model=model,
                input_tokens=tokens.input,
                output_tokens=tokens.output,
                response_tokens=tokens.response_tokens,
                usd=None if usd is None else round(usd, 4),
            )
        )

    costs.sort(key=lambda cost: (cost.usd or 0.0), reverse=True)
    return costs, total, sorted(set(unpriced))


def estimate_cost(
    config: EvalRunConfig, response_tokens: int | None = None
) -> CostEstimate:
    """Coût d'un run et sa fourchette.

    `usd` est le chiffre à lire : le coût si chaque modèle répond de la longueur
    qu'on lui connaît. Les bornes l'encadrent en supposant que tous répondent
    très court, puis très long ; elles ne bougent pas avec l'hypothèse retenue.

    Ce que ce devis n'inclut pas, et qu'il vaut mieux dire que deviner :
    l'écriture de cache d'Anthropic, facturée 1,25 fois le tarif d'entrée. Sur
    le run mesuré, elle pesait 11 % de la facture d'Opus. La chiffrer exigerait
    de supposer un taux de mise en cache que rien ici ne permet de connaître.

    Un modèle absent du tarif est signalé plutôt qu'ignoré : une estimation qui
    oublie silencieusement un modèle est pire que pas d'estimation du tout.

    Args:
        config: Le run à estimer.
        response_tokens: Longueur de réponse imposée à tous les modèles. `None`
            — le cas normal — laisse chacun prendre la longueur mesurée pour
            lui.
    """
    assumed = (
        None if response_tokens is None else max(1, min(response_tokens, 100_000))
    )

    costs, expected, unpriced = _costs_for(config, assumed)
    _, low, _ = _costs_for(config, SHORT_RESPONSE_TOKENS)
    _, high, _ = _costs_for(config, LONG_RESPONSE_TOKENS)
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
        input_tokens=sum(tokens.input for tokens in volume.per_model.values()),
        output_tokens=sum(tokens.output for tokens in volume.per_model.values()),
        per_model=costs,
        unpriced_models=unpriced,
    )


CACHE_READ_MULTIPLIER = _SHARED["cache_read_multiplier"]
CACHE_WRITE_MULTIPLIER = _SHARED["cache_write_multiplier"]
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

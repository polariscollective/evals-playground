"""Estimation du coût d'un run avant de le lancer.

Le nombre d'appels de modèle est parfaitement connu d'avance : les tours
s'exécutent tous, toujours. Ce qui ne l'est pas, c'est la longueur des
réponses — et comme chaque tour renvoie tout l'historique au modèle suivant,
une réponse longue enfle le coût de tous les tours qui la suivent. D'où une
fourchette, dont les bornes viennent d'hypothèses sur cette longueur.

Les tarifs sont ceux relevés le 19 août 2026 sur les documentations des trois
fournisseurs. Ils changent : ce fichier est le seul endroit à mettre à jour.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from playground.eval_schemas import EvalRunConfig, tools_for, ModelUsage
from playground.shared_data import load
from playground.world import WORLD_MODEL

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
au juge. Les sorties, elles, ne sont pas déduites d'une longueur de texte mais
d'une hypothèse déclarée — voir `LengthAssumption`.
"""

SHORT_RESPONSE_TOKENS = _SHARED["short_response_tokens"]
LONG_RESPONSE_TOKENS = _SHARED["long_response_tokens"]
"""Bornes d'hypothèse sur la longueur d'une réponse, tous scénarios confondus.

Elles encadrent le devis en supposant que *toutes* les réponses sont très
courtes, puis très longues — sans lien avec la longueur déclarée par la
configuration ni avec le scénario. Une borne haute que le réel dépasse est pire
qu'une fourchette large, parce que c'est sur elle que se prend la décision de
lancer.
"""

DEFAULT_RESPONSE_TOKENS = _SHARED["default_response_tokens"]
"""Longueur supposée quand rien n'est déclaré ni mesuré.

C'est la moyenne tous modèles confondus relevée le 19 août 2026. Elle ne sert
plus qu'aux runs enregistrés avant `average_output_tokens` : un run neuf déclare
sa longueur, une extension la mesure.
"""

JUDGE_RESPONSE_TOKENS = _SHARED["judge_response_tokens"]
"""Le juge rend une note et une phrase : sa sortie est courte et prévisible."""

WORLD_RESPONSE_TOKENS = _SHARED["world_response_tokens"]
"""Ce qu'un outil servi depuis le monde rend, en gros.

Une vingtaine de lignes de données brutes. Moins prévisible que la sortie d'un
juge — un `read_file` rend plus qu'un `search` — mais du même ordre, et
l'ignorer serait pire que l'approcher.
"""

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


@dataclass(frozen=True)
class LengthAssumption:
    """Sur quelle longueur de sortie le devis repose.

    `answer` porte les réponses du modèle évalué : un nombre pour tous les
    scénarios, ou un par scénario dans l'ordre de `config.scenarios` — ce dont
    l'extension a besoin, chaque scénario ayant sa propre mesure. `None` renvoie
    à `config.average_output_tokens`.

    `adversary` porte les tours d'utilisateur, qui ne sont pas des réponses
    évaluées et ne dépendent pas du scénario mais de la consigne d'adversaire,
    commune au run. `None` lui donne la longueur déclarée du run, ce qui
    surestime — les tours d'utilisateur étant plus courts — et c'est le bon sens
    de l'erreur pour un devis.
    """

    answer: int | Sequence[int] | None = None
    adversary: int | None = None


def _clamp(tokens: int) -> int:
    return max(1, min(int(tokens), 100_000))


def _declared(config: EvalRunConfig) -> int:
    return _clamp(config.average_output_tokens or DEFAULT_RESPONSE_TOKENS)


def _resolve(
    config: EvalRunConfig, lengths: "LengthAssumption | int | None"
) -> tuple[list[int], int]:
    """Les longueurs de chaque scénario, et celle de l'adversaire.

    Un nombre nu vaut « la même pour tout le monde » : c'est la forme dont se
    servent les bornes court/long, qui encadrent le devis sans rien savoir des
    scénarios.
    """
    if lengths is None:
        lengths = LengthAssumption()
    elif isinstance(lengths, int):
        lengths = LengthAssumption(answer=lengths, adversary=lengths)

    declared = _declared(config)
    answer = lengths.answer
    if answer is None:
        par_scenario = [declared] * len(config.scenarios)
    elif isinstance(answer, int):
        par_scenario = [_clamp(answer)] * len(config.scenarios)
    else:
        # Une liste plus courte que les scénarios n'est pas une erreur : une
        # extension peut n'avoir mesuré qu'une partie d'entre eux.
        par_scenario = [
            _clamp(answer[index]) if index < len(answer) else declared
            for index in range(len(config.scenarios))
        ]

    adversary = _clamp(lengths.adversary) if lengths.adversary is not None else declared
    return par_scenario, adversary


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
    """La longueur supposée, ou `None` si elle varie d'un scénario à l'autre."""

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


WORLD_OVERHEAD_TOKENS = _fixed_tokens(
    load("world-prompt")["system"]
    + load("world-prompt")["world_block"]
    + load("world-prompt")["scenario_block"]
    + load("world-prompt")["call_block"]
    + load("world-prompt")["rules_block"],
    "{world}", "{scenario_world}", "{tool}", "{arguments}", "{rules}",
)
"""Ce que l'environnement reçoit en plus du monde, à chaque appel.

Mesuré sur les gabarits plutôt qu'écrit en dur, comme pour le juge et
l'adversaire : une reformulation du prompt se répercute alors sur le devis toute
seule.
"""


def served_calls_per_conversation(config: EvalRunConfig) -> int:
    """Combien d'appels d'outils servis une conversation fait, en gros.

    **Le milieu de zéro et du plafond**, et c'est la seule hypothèse qu'on
    puisse défendre : aucune configuration ne déclare combien de fois un modèle
    appellera ses outils, et les deux seules bornes connues sont « jamais » et
    `max_tool_calls_per_turn` à chaque tour. Prendre leur milieu est un choix
    assumé, que la phrase du devis nomme plutôt que de le taire.

    Zéro quand aucun outil n'est servi — le cas de tous les runs écrits jusqu'à
    présent, qui ne doivent pas voir leur devis bouger d'un centime.
    """
    return (config.turns * config.max_tool_calls_per_turn) // 2


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
    config: EvalRunConfig, lengths: "LengthAssumption | int | None" = None
) -> TokenEstimate:
    """Volume total d'un run, réparti par modèle.

    Chaque scénario est déroulé avec sa propre longueur de réponse : comme
    l'historique complet est renvoyé à chaque tour, un scénario qui appelle des
    réponses longues enfle aussi l'entrée de l'adversaire et celle du juge.

    La longueur est celle d'un *tour*, pas d'un appel HTTP : la boucle
    ci-dessous compte exactement `config.turns` appels du modèle évalué, sans
    modèle des appels d'outils. Une mesure divisée par les tours reproduit donc
    le total observé, quand une mesure divisée par les appels réels le
    sous-estimerait.

    Args:
        config: Le run à estimer.
        lengths: Sur quelle longueur reposer. Voir `LengthAssumption`.
    """
    per_scenario, adversary_response_all = _resolve(config, lengths)
    per_model: dict[str, ModelTokens] = {}
    judge = config.models.judge
    adversary = config.models.adversary if config.turns > 1 else None
    adversary_response = adversary_response_all if adversary else 0
    question = _tokens(config.criterion) + _rubric_tokens(config)
    adversary_prompt = _tokens(config.adversary_prompt)
    # Le monde repart en entier à chaque appel d'environnement. Il n'est pas
    # compté au tarif du cache, alors que le fournisseur le mettra
    # vraisemblablement en cache : la remise n'est garantie par personne — elle
    # dépend du fournisseur, de la longueur du préfixe et de l'écart entre deux
    # appels — et un devis qui la suppose sous-estime chaque fois qu'elle ne
    # joue pas. Or c'est sur ce chiffre que se prend la décision de lancer.
    # `actual_cost` lit les vrais compteurs de cache et facture juste ; seule
    # la prévision est prudente.
    world = _tokens(config.world)
    served_calls = served_calls_per_conversation(config)
    served_conversations = 0

    for index, scenario in enumerate(config.scenarios):
        system = _tokens(scenario.system_prompt)
        opening = _tokens(scenario.opening_message)
        # Un historique posé est renvoyé à chaque appel, comme le reste de
        # la conversation : l'oublier sous-estimerait tout le run, et
        # d'autant plus qu'il y a de tours.
        seeded = sum(_tokens(turn.content) for turn in scenario.history)
        # Les définitions d'outils repartent à chaque appel du modèle évalué,
        # comme le reste du contexte. Les oublier sous-estime d'autant plus
        # qu'il y a de tours.
        outils = sum(
            _tokens(tool.name)
            + _tokens(tool.description)
            + sum(
                _tokens(p.name) + _tokens(p.description) + _tokens(p.type)
                for p in tool.parameters
            )
            for tool in tools_for(config, scenario)
        )
        # Un scénario qui n'offre aucun outil servi ne paie pas l'environnement.
        # `tools: none` sur une ligne est souvent toute la comparaison qu'on
        # cherche : elle ne doit pas porter le coût d'un monde qu'elle
        # n'interroge jamais.
        servis = [tool for tool in tools_for(config, scenario) if tool.served]
        monde = (
            world
            + _tokens(scenario.world)
            + WORLD_OVERHEAD_TOKENS
            # Les règles de lecture de l'outil appelé. On ne sait pas lequel :
            # la moyenne des outils servis de ce scénario est la seule valeur
            # qui ne privilégie aucun d'eux.
            + sum(_tokens(tool.retrieval_rules) for tool in servis) // max(len(servis), 1)
            if servis
            else 0
        )

        for target in config.models.targets:
            target_response = per_scenario[index]
            target_input = target_output = 0
            adversary_input = adversary_output = 0
            history = seeded + opening

            for turn in range(config.turns):
                target_input += system + outils + history
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
            if servis and served_calls:
                served_conversations += weight
                _add(
                    per_model,
                    WORLD_MODEL,
                    monde * served_calls * weight,
                    WORLD_RESPONSE_TOKENS * served_calls * weight,
                    WORLD_RESPONSE_TOKENS,
                )

    conversations = (
        len(config.scenarios) * len(config.models.targets) * config.repetitions
    )
    calls_per_conversation = config.turns + max(config.turns - 1, 0) + 1

    return TokenEstimate(
        conversations=conversations,
        model_calls=(
            conversations * calls_per_conversation
            + served_conversations * served_calls
        ),
        per_model=per_model,
    )


def _costs_for(
    config: EvalRunConfig, lengths: "LengthAssumption | int | None"
) -> tuple[list[ModelCost], float, list[str]]:
    """Coût par modèle, total, et modèles sans tarif connu."""
    estimate = estimate_tokens(config, lengths)
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
    config: EvalRunConfig, lengths: "LengthAssumption | int | None" = None
) -> CostEstimate:
    """Coût d'un run et sa fourchette.

    `usd` est le chiffre à lire : le coût si chaque scénario répond de la
    longueur qu'on lui suppose. Les bornes l'encadrent en supposant que tous
    répondent très court, puis très long ; elles ne bougent pas avec
    l'hypothèse retenue.

    Ce que ce devis n'inclut pas, et qu'il vaut mieux dire que deviner :
    l'écriture de cache d'Anthropic, facturée 1,25 fois le tarif d'entrée. Sur
    le run mesuré, elle pesait 11 % de la facture d'Opus. La chiffrer exigerait
    de supposer un taux de mise en cache que rien ici ne permet de connaître.

    Un modèle absent du tarif est signalé plutôt qu'ignoré : une estimation qui
    oublie silencieusement un modèle est pire que pas d'estimation du tout.

    Args:
        config: Le run à estimer.
        lengths: Sur quelle longueur reposer. `None` — le cas normal — prend
            `config.average_output_tokens`, ou la moyenne générale à défaut.
            Voir `LengthAssumption`.
    """
    per_scenario, _ = _resolve(config, lengths)
    unique = per_scenario[0] if per_scenario and len(set(per_scenario)) == 1 else None

    costs, expected, unpriced = _costs_for(config, lengths)
    _, low, _ = _costs_for(config, SHORT_RESPONSE_TOKENS)
    _, high, _ = _costs_for(config, LONG_RESPONSE_TOKENS)
    volume = estimate_tokens(config, lengths)

    return CostEstimate(
        response_tokens=unique,
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

"""Exécution d'un run d'évaluation, dans un job Cloud Run.

Entrypoint : `python -m playground.batch_job`.

Tout passe par l'environnement, jamais par la ligne de commande : Cloud Run Jobs
sait remplacer des variables d'environnement au lancement, pas des arguments.

    EVAL_RUN_ID     le run à exécuter, déjà écrit en base avec ses échantillons
    EVAL_JOB_MODE   `run` (défaut) ou `catchup`
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, GEMINI_API_KEY

Le job n'invente rien : la matrice existe déjà en base, une ligne par case, en
`pending`. Il ne fait que les remplir. Depuis les juges multiples, c'est vrai
aussi de `judge_scores` : toutes les lignes de score existent d'avance, en
`pending`, pour chaque juge vivant du run — voir
docs/superpowers/specs/2026-09-06-juges-multiples.md.
"""

import asyncio
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

from inspect_ai import Task, eval as inspect_eval
from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.log import EvalLog
from inspect_ai.model import get_model
from inspect_ai.solver import Generate, Solver, TaskState, solver

from playground.conversation import ToolAnswer
from playground.eval_schemas import EvalRunConfig, JournalEntry, ToolSpec
from playground.log_store import Storage, upload_logs
from playground.eval_task import conversation_solver, pending_dataset
from playground.pricing import actual_cost
from playground.scoring import JudgeOutcome, ScoredSample, judges_scorer
from playground.supabase_store import (
    JUDGE_SCORES,
    NOW,
    SAMPLES,
    Cancellation,
    Supabase,
    abandon_unfinished_samples,
    cancel_unfinished_samples,
    fetch_run,
    finish_run,
    load_live_run_judges,
    mark_sample_running,
    pending_samples,
    read_tool_result,
    run_status,
    unchecked_tool_results,
    sample_filters,
    start_run,
    write_judge_score,
    write_tool_check_error,
    write_tool_result,
    write_tool_verdict,
)
from playground.world import (
    ServeRefused,
    check,
    check_model_for,
    check_models_after,
    result_key,
    serve,
    state_key,
)

LOGS_DIR = Path(os.environ.get("EVAL_LOGS_DIR", "logs/eval"))


def usage_from_log(log: EvalLog) -> dict[str, dict[str, int]]:
    """Les jetons réellement consommés, par modèle.

    Inspect agrège ces compteurs depuis les réponses des fournisseurs : ce sont
    les nombres facturés, pas une estimation. Les champs absents valent zéro —
    tous les fournisseurs ne rapportent ni le cache ni le raisonnement.
    """
    return {
        model: {
            "input_tokens": counts.input_tokens or 0,
            "output_tokens": counts.output_tokens or 0,
            "input_tokens_cache_read": counts.input_tokens_cache_read or 0,
            "input_tokens_cache_write": counts.input_tokens_cache_write or 0,
            "reasoning_tokens": counts.reasoning_tokens or 0,
        }
        for model, counts in (log.stats.model_usage or {}).items()
    }


def add_usage(
    existing: dict[str, Any], added: dict[str, dict[str, int]]
) -> dict[str, dict[str, int]]:
    """Cumule la consommation d'une passe avec celle déjà enregistrée.

    Les jetons d'une passe précédente ont été facturés : les remplacer ferait
    passer un run pour moins cher qu'il ne l'a été. Le coût d'un run est celui
    de tout ce qu'on lui a fait subir, pas de sa dernière opération.
    """
    total: dict[str, dict[str, int]] = {
        model: dict(counts) for model, counts in (existing or {}).items()
    }
    for model, counts in added.items():
        current = total.setdefault(model, {})
        for champ, valeur in counts.items():
            current[champ] = current.get(champ, 0) + valeur
    return total


def judge_metadata(liaison: dict[str, Any]) -> dict[str, Any]:
    """Un juge vivant, réduit à ce que `judges_scorer` (scoring.py) doit en
    recevoir pour le faire noter une conversation.

    `liaison` est un élément de ce que rend `load_live_run_judges`
    (supabase_store.py) : la liaison `run_judges` fusionnée avec le juge
    qu'elle vise, sous la clé `"judge"`. Cette fonction ne garde que ce qui
    traverse la frontière JSON de `Sample.metadata` — voir
    `playground.scoring.judge_from_metadata`, qui fait le chemin inverse côté
    scorer.
    """
    judge = liaison["judge"]
    return {
        "run_judge_id": str(liaison["id"]),
        "model": judge["model"],
        "system_type": judge.get("system_type"),
        "criterion": judge.get("criterion"),
        "rubric": judge.get("rubric"),
        # Décide si le transcript remis à CE juge porte le prompt système du
        # scénario. Absent vaut vrai — le comportement d'avant ce champ.
        #
        # `targets` ne traverse pas : c'est une annotation de laboratoire, comme
        # la note d'un scénario, et elle n'a rien à faire près d'un juge. La lui
        # donner serait lui donner la réponse.
        "sees_system_prompt": judge.get("sees_system_prompt", True) is not False,
    }


def monde_de(config: EvalRunConfig, scenario_index: int) -> str:
    """Le monde tel qu'un scénario le lit : celui du run, plus le sien.

    Reconstruit ici plutôt que stocké par résultat : le monde d'un run est gelé
    au lancement, donc il n'a pas pu bouger, et en garder une copie par ligne de
    `tool_results` coûterait le monde entier autant de fois.

    Écrit une fois pour les deux contrôles — celui qui passe dans le fil de la
    conversation et la passe d'après-run. Recopié, c'est la seconde copie qui
    oublierait le monde du scénario, et le contrôleur condamnerait alors des
    lectures parfaitement correctes.
    """
    monde = config.world
    if 0 <= scenario_index < len(config.scenarios):
        du_scénario = config.scenarios[scenario_index].world
        if du_scénario:
            monde = f"{monde}\n\n{du_scénario}"
    return monde


def world_server(
    supabase: Supabase,
    run_id: str,
    config: EvalRunConfig,
    model_args: dict[str, Any] | None = None,
) -> "Callable[..., Any]":
    """Ce qui répond aux outils servis, pour la durée d'un job.

    Une fabrique et non une fonction libre, parce qu'il y a un état à tenir :
    les contrôleurs qu'on a vus tomber. Un job tourne un seul run dans un seul
    processus, et c'est la bonne échelle pour cette mémoire — voir plus bas.

    Rendu à `conversation_solver`, qui le referme sur le rang du scénario.
    """

    # Les contrôleurs qu'on a vus tomber, mémorisés pour le job entier.
    #
    # Une panne de fournisseur est à l'échelle du run, pas de la conversation :
    # mémorisée par essai, cent vingt conversations la redécouvriraient chacune,
    # au prix de cent vingt attentes. Le job tourne un seul run dans un seul
    # processus, et il garde déjà une mémoire de cette forme pour l'annulation.
    contrôleurs_tombés: list[str] = []

    async def contrôle(
        monde: str,
        journal: "list[JournalEntry]",
        tool_name: str,
        arguments: dict[str, Any],
        result: str,
        world_change: str,
    ) -> tuple[tuple[bool, str] | None, str, str]:
        """Le verdict d'un contrôleur, en descendant la liste des candidats.

        Le repli du spec, dans l'ordre : une autre famille que le serveur
        d'abord, la même ensuite — mieux vaut un contrôleur au biais partagé
        que pas de contrôle du tout, et `check_model` sur la ligne le rend
        visible — puis plus personne.

        **La panne du contrôleur ne tue jamais un essai.** Elle rend un verdict
        nul, l'appelant sert quand même, et la ligne reste à `faithful` nul :
        c'est la passe d'après-run qui la reprendra.

        Returns:
            Le triplet (verdict, contrôleur retenu, raison de l'échec). Le
            verdict est nul quand aucun candidat n'a pu répondre.
        """
        dernière = ""
        while True:
            candidat = check_models_after(config.models.world or "", contrôleurs_tombés)
            if candidat is None:
                return None, "", dernière or "no checker could be reached"
            try:
                verdict = await check(
                    model=get_model(candidat, **(model_args or {})),
                    world=monde,
                    journal=journal,
                    tool=tool_name,
                    arguments=arguments,
                    result=result,
                    world_change=world_change,
                )
                return verdict, candidat, ""
            except Exception as raison:  # noqa: BLE001 — voir la docstring
                contrôleurs_tombés.append(candidat)
                dernière = f"{candidat}: {raison}"

    async def sert_outil(
        scenario_index: int,
        tool: ToolSpec,
        arguments: dict[str, Any],
        journal: "list[JournalEntry]",
    ) -> ToolAnswer:
        """Ce qu'un outil servi depuis le monde rend pour cet appel.

        Le cache d'abord, toujours : une réponse déjà écrite est resservie
        sans qu'aucun modèle ne soit appelé — ni le serveur, ni le contrôleur,
        qui a déjà regardé cette ligne. C'est ce qui rend deux répétitions du
        même scénario comparables, ce qui fait qu'une extension ne repaie pas
        ce qui a déjà été demandé, et ce qui garde le contrôle au prix du
        nombre de réponses DIFFÉRENTES plutôt que du nombre d'appels.

        La clé porte l'état du monde d'AVANT cet appel. Journal vide — le cas
        de l'immense majorité des appels — c'est la clé d'avant ce chantier.

        Un résultat vide est une réponse — celle d'une recherche sans
        résultat — et non une absence : c'est `None` qui dit « jamais
        demandé », et lui seul déclenche un appel.

        Le contrôle passe **avant** de servir, et non plus seulement après le
        run : c'est la seule façon de retenter une fois avant que le modèle
        évalué ait lu la réponse. Une fois qu'il l'a lue, il est trop tard — on
        ne réécrit pas un transcript.

        Deux issues, et l'asymétrie est le cœur de la politique : on ne peut
        pas servir ce qui n'existe pas, on peut servir ce dont on doute.

        Raises:
            ServeRefused: si le modèle n'a pas rempli `submit_result`, deux fois
                de suite. L'essai meurt alors — un transcript où l'outil rend la
                prose du serveur est pire qu'un essai manquant.
        """
        clé = result_key(tool.name, arguments)
        état = state_key(journal)
        déjà = read_tool_result(
            supabase, run_id, scenario_index, tool.name, clé, état
        )
        if déjà is not None:
            return ToolAnswer(*déjà)

        monde = monde_de(config, scenario_index)
        journal_écrit = [entrée.model_dump() for entrée in journal]
        faute_précédente = ""
        for tentative in (1, 2):
            try:
                rendu = await serve(
                    model=get_model(config.models.world, **(model_args or {})),
                    world=config.world,
                    scenario_world=config.scenarios[scenario_index].world,
                    journal=journal,
                    tool=tool,
                    arguments=arguments,
                    fault=faute_précédente,
                )
            except ServeRefused:
                # Rien à lui redire : il n'a pas répondu. On redemande une
                # fois, puis l'essai meurt.
                if tentative == 2:
                    raise
                continue

            verdict, contrôleur, raison = await contrôle(
                monde, journal, tool.name, arguments, rendu.result, rendu.world_change
            )
            garder = verdict is None or verdict[0] or tentative == 2
            if garder:
                return ToolAnswer(
                    *write_tool_result(
                        supabase,
                        run_id,
                        scenario_index,
                        tool.name,
                        clé,
                        état,
                        arguments=arguments,
                        state=journal_écrit,
                        result=rendu.result,
                        reasoning=rendu.reasoning,
                        world_change=rendu.world_change,
                        model=config.models.world,
                        check_model=contrôleur,
                        attempts=tentative,
                        faithful=None if verdict is None else verdict[0],
                        fault="" if verdict is None else verdict[1],
                        check_error=raison or None,
                    )
                )
            faute_précédente = verdict[1]
        raise AssertionError("unreachable: la seconde tentative garde toujours")

    return sert_outil


def check_served_results(
    supabase: Supabase,
    run_id: str,
    config: EvalRunConfig,
    model_args: dict[str, Any] | None = None,
) -> int:
    """Contrôle les résultats servis que personne n'a encore regardés.

    Une question, et une seule : ce résultat pouvait-il sortir de cet appel ?
    Pas « le monde est-il bien écrit » — ça se règle avant de lancer.

    Porte sur les lignes de `tool_results`, pas sur les conversations : le
    travail à contrôler est exactement `(monde, appel) → résultat`, et le cache
    a déjà réduit trois cent soixante appels à la soixantaine de résultats
    distincts qu'ils recouvrent. Un juge coûterait le nombre de conversations ;
    celui-ci coûte le nombre de réponses différentes, une fois chacune.

    **Ne fait jamais tomber le run.** Il arrive après que tout a été joué et
    payé : un contrôle qui échouerait ferait perdre des notes déjà obtenues
    pour un renseignement qui, lui, se rattrape. Les lignes non contrôlées
    restent `faithful` nul, et une passe ultérieure les reprendra — en disant
    dans `check_error` pourquoi la tentative précédente n'a pas abouti.

    La promesse tient sur toute la fonction, pas seulement sur `check()` : la
    lecture de ce qui reste à contrôler, la construction du contrôleur et
    l'écriture du verdict peuvent chacune lever — une panne Supabase
    passagère, un `models.world` qui ne désigne plus un fournisseur connu —
    et aucune ne doit remonter jusqu'à l'appelant, qui finirait le run en
    erreur (voir C2/B2 : c'est exactement ce que ce garde-fou existe pour
    éviter).

    Returns:
        Combien de lignes ont reçu un verdict.
    """
    # Un run dont aucun outil n'est servi n'a pas de ligne à contrôler, et n'a
    # donc pas à le demander : la question se tranche sur la configuration, qui
    # est déjà là, plutôt que par un aller-retour sur toutes les fins de run.
    if not any(tool.served for tool in config.tools):
        return 0

    try:
        à_faire = unchecked_tool_results(supabase, run_id)
    except Exception:
        # Ne pas savoir dire ce qui reste à contrôler ne doit pas non plus
        # faire tomber le run : une passe ultérieure retentera cette lecture.
        return 0
    if not à_faire:
        return 0

    try:
        modèle = get_model(check_model_for(config.models.world), **(model_args or {}))
    except Exception:
        # Un contrôleur qu'on ne sait pas construire — clé absente,
        # identifiant devenu invalide — ne doit pas non plus faire tomber le
        # run : les lignes restent à contrôler, une passe ultérieure les
        # reprendra une fois le fournisseur réparé.
        return 0

    contrôlées = 0
    for ligne in à_faire:
        index = int(ligne["scenario_index"])
        # Le journal tel que cette ligne l'a vu, relu plutôt que recalculé : son
        # empreinte est dans la clé, mais l'empreinte ne se remonte pas. Sans
        # lui, cette passe recontrôlerait la ligne contre un monde qui n'est
        # pas celui qu'elle a servi — et condamnerait une lecture correcte d'un
        # monde déjà modifié.
        journal = [JournalEntry(**entrée) for entrée in (ligne.get("state") or [])]
        try:
            fidèle, faute = asyncio.run(
                check(
                    model=modèle,
                    world=monde_de(config, index),
                    journal=journal,
                    tool=str(ligne["tool_name"]),
                    arguments=ligne.get("arguments") or {},
                    result=str(ligne.get("result") or ""),
                    world_change=str(ligne.get("world_change") or ""),
                )
            )
        except Exception as e:
            # Une ligne qu'on n'a pas su contrôler reste à contrôler — mais on
            # dit désormais pourquoi. Muette, elle ressemblait à du calme. Elle
            # ne doit ni passer pour fidèle, ni faire tomber les suivantes.
            try:
                write_tool_check_error(
                    supabase,
                    run_id,
                    index,
                    str(ligne["tool_name"]),
                    str(ligne["arguments_hash"]),
                    str(ligne.get("state_hash") or ""),
                    reason=f"{type(e).__name__}: {e}"[:500],
                )
            except Exception:
                # Ne pas savoir dire pourquoi ne doit jamais coûter plus cher
                # que la panne qu'on essayait de nommer : cette écriture est
                # elle-même la ligne qui protège le run de `check_served_results`
                # — la faire lever remonterait l'exception hors de cette
                # fonction, contredisant sa promesse de ne jamais faire tomber
                # le run, et lui ferait perdre son coût déjà enregistré (voir
                # B2). C'est exactement dans le cas visé ici — une clé morte
                # chez le fournisseur du contrôleur, donc beaucoup de lignes en
                # échec — que cette écriture a le plus de chances d'échouer à
                # son tour.
                pass
            continue
        try:
            write_tool_verdict(
                supabase,
                run_id,
                index,
                str(ligne["tool_name"]),
                str(ligne["arguments_hash"]),
                str(ligne.get("state_hash") or ""),
                faithful=fidèle,
                fault=faute,
            )
        except Exception:
            # Symétrique de l'écriture de la raison, juste au-dessus : écrire
            # le verdict peut échouer comme écrire l'erreur peut échouer. La
            # ligne reste `faithful` nul, une passe ultérieure la reprendra.
            continue
        contrôlées += 1
    return contrôlées


def catchup_dataset(supabase: Supabase, run_id: str) -> MemoryDataset:
    """Les conversations déjà jouées qui portent encore, pour au moins un juge
    vivant, une ligne de `judge_scores` en attente ou en erreur.

    Remplace `rejudge_dataset` et `awareness_dataset` : les modes qu'ils
    servaient (`rejudge`, qui écrasait la note du juge de l'utilisateur avant
    de refaire, et `awareness`, qui ne rattrapait que le juge d'éveil)
    disparaissent au profit d'un seul mécanisme de rattrapage, valable pour
    n'importe quel juge — voir la conception,
    docs/superpowers/specs/2026-09-06-juges-multiples.md, section « Le
    rattrapage, généralisé ». Il ne fait rien d'autre que réunir les lignes
    de score `pending` et `error`, et les faire remplir, ce qui couvre
    quatre cas d'un coup : un juge ajouté à un run terminé, un run étendu, un
    juge tombé sur quelques cases, un run interrompu.

    `error` compte autant que `pending` : une panne réseau passagère écrit
    une ligne `error` (voir `write_judge_score`), et rien d'autre ne la
    reprend jamais — ni ce rattrapage s'il ne la ciblait pas, ni le
    lancement, ni l'ajout d'un juge. L'exclure ferait d'une panne passagère
    une impasse définitive, sans autre recours que poser un second juge
    identique. `write_judge_score` réécrit la ligne en entier à la reprise :
    un juge qui retombe en erreur y laisse une ligne `error` fraîche, un
    juge qui aboutit y efface l'ancien message au profit de la note — jamais
    les deux à la fois.

    Ne cible que les conversations `status = 'done'` : c'est la seule
    garantie qu'un transcript existe à relire — l'inverse exact de
    `pending_samples`, qui vise les conversations pas encore jouées. Une
    conversation `error`/`cancelled`/`running` n'a jamais atteint le juge la
    première fois ; ce n'est pas ce rattrapage qui doit s'en charger, mais une
    reprise de la conversation elle-même.

    Un juge délié depuis que sa ligne de score a été créée n'est jamais
    rappelé ici : une ligne en attente ou en erreur dont le `run_judge_id`
    n'apparaît plus dans `load_live_run_judges` — la seule fonction
    autorisée à dire qui est vivant — reste telle quelle pour de bon. C'est
    voulu : un juge supprimé n'apparaît nulle part (invariant 5 de la
    conception), pas même dans ce qui reste à rattraper. Rien ne la
    comblera jamais, ce qui est sans conséquence : personne ne la lira plus
    non plus.
    """
    juges_vivants = load_live_run_judges(supabase, run_id)
    vivants_par_id = {liaison["id"]: liaison for liaison in juges_vivants}
    if not vivants_par_id:
        return MemoryDataset([], name="rattrapage")

    a_reprendre = supabase.select(
        JUDGE_SCORES,
        run_id=f"eq.{run_id}",
        status="in.(pending,error)",
        select="run_judge_id,sample_id",
    )
    juges_par_echantillon: dict[str, list[str]] = {}
    for ligne in a_reprendre:
        run_judge_id = str(ligne["run_judge_id"])
        if run_judge_id not in vivants_par_id:
            continue
        juges_par_echantillon.setdefault(str(ligne["sample_id"]), []).append(
            run_judge_id
        )
    if not juges_par_echantillon:
        return MemoryDataset([], name="rattrapage")

    ids = sorted(juges_par_echantillon)
    rows = supabase.select(
        SAMPLES,
        run_id=f"eq.{run_id}",
        status="eq.done",
        id="in.(" + ",".join(ids) + ")",
        select=(
            "id,scenario_index,target_model,repetition,temperature,messages,"
            "usage,turns_done"
        ),
        order="scenario_index,target_model,repetition",
    )
    samples = []
    for index, row in enumerate(rows):
        sample_id = str(row["id"])
        samples.append(
            Sample(
                id=index + 1,
                input=(row.get("messages") or [{}])[0].get("content", ""),
                metadata={
                    "id": sample_id,
                    "scenario_index": int(row["scenario_index"]),
                    "target": row["target_model"],
                    "repetition": int(row["repetition"]),
                    "temperature": row.get("temperature"),
                    "transcript": row.get("messages") or [],
                    "usage": row.get("usage") or {},
                    "turns_done": row.get("turns_done") or 0,
                    "judges": [
                        judge_metadata(vivants_par_id[run_judge_id])
                        for run_judge_id in juges_par_echantillon.get(sample_id, [])
                    ],
                },
            )
        )
    return MemoryDataset(samples, name="rattrapage")


@solver
def stored_transcript() -> Solver:
    """Solver sans effet : le transcript est déjà dans les métadonnées.

    Inspect exige un solver. Celui-ci ne fait rien, volontairement — appeler
    quoi que ce soit ici rejouerait la conversation, ce qu'un rattrapage ne
    doit précisément pas faire.
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        return state

    return solve


def run_batch_job(
    run_id: str,
    mode: str = "run",
    supabase: Supabase | None = None,
    logs_dir: Path = LOGS_DIR,
    model_args: dict[str, Any] | None = None,
    cancellation: Cancellation | None = None,
    storage: Storage | None = None,
) -> None:
    """Exécute un run, ou rattrape ses juges, et écrit chaque case au fil de l'eau.

    Args:
        run_id: Le run à exécuter, déjà en base avec ses échantillons.
        mode: `run` déroule les conversations puis les fait noter par tous les
            juges vivants du run. `catchup` remplit, pour les conversations
            déjà jouées, les lignes de `judge_scores` encore en attente —
            qu'un juge ait été ajouté après coup, que le run ait été étendu,
            qu'un juge soit tombé sur quelques cases, ou que le run ait été
            interrompu. C'est le seul mode de rattrapage désormais : les
            anciens modes `rejudge` (qui écrasait la note du juge de
            l'utilisateur avant de refaire) et `awareness` (qui ne
            rattrapait que le juge d'éveil) ont disparu à son profit — voir
            docs/superpowers/specs/2026-09-06-juges-multiples.md.
        supabase: Injectable pour les tests, qui n'ont ainsi besoin ni de réseau
            ni de base.
        cancellation: Injectable pour les tests, qui doivent pouvoir annuler
            son cache. Celui-ci vaut une seconde en production — court devant
            la durée d'un appel de modèle, long devant celle d'un test.
        logs_dir: Où inspect écrit ses `.eval`. Le disque est éphémère dans un
            conteneur : le `finally` les monte dans Storage avant qu'il
            disparaisse.
        storage: Injectable pour les tests, qui n'ont ainsi ni réseau ni
            bucket.
        model_args: Arguments passés aux modèles. Sert aux tests, avec
            `mockllm` — voir la docstring de `scenario_solver.model_args`.

    Raises:
        ValueError: si `mode` n'est ni `run` ni `catchup`.
        Toute autre exception rencontrée est enregistrée sur le run avec le
        statut `error`, puis relancée.
    """
    if mode not in ("run", "catchup"):
        raise ValueError(f"Unknown job mode: {mode!r}. Expected 'run' or 'catchup'.")

    supabase = supabase or Supabase.from_env()
    row = fetch_run(supabase, run_id)
    config = EvalRunConfig(**row["config"])

    start_run(supabase, run_id, execution=os.environ.get("CLOUD_RUN_EXECUTION"))
    arret = cancellation or Cancellation(supabase, run_id)

    def commence(state) -> None:
        """La case démarre : le dire, sinon la progression ment.

        Une case en vol se lisait « à faire », et le total des cases restantes
        comptait des conversations déjà en cours d'écriture."""
        metadata = state.metadata or {}
        mark_sample_running(
            supabase,
            run_id,
            int(metadata.get("scenario_index", 0)),
            str(metadata.get("target") or ""),
            int(metadata.get("repetition", 0)),
        )

    # Ce qu'une case portait déjà, avant cette passe — vide pour l'immense
    # majorité des cases, qui n'ont jamais été jouées. Alimenté juste avant
    # `inspect_eval`, dans la branche qui construit `dataset` (voir plus bas) :
    # c'est la même métadonnée que `pending_dataset`/`catchup_dataset` vient
    # de faire remonter jusqu'au scorer, lue ici pour la fusion plutôt que
    # pour la conversation.
    deja_facture: dict[tuple[int, str, int], dict[str, dict[str, int]]] = {}


    def ecrire_juge(sample_id: str, resultat: JudgeOutcome) -> None:
        """Chaque juge écrit sa propre ligne, dès qu'il a rendu son verdict.

        Appelé par `judges_scorer` (scoring.py) immédiatement après chaque
        juge, avant de passer au suivant — voir la docstring de
        `judge_conversation` pour l'invariant 2 (une annulation ne fait pas
        perdre une note déjà obtenue) : c'est cette immédiateté qui le porte,
        et non une garde `except BaseException` recopiée ici. L'invariant 1
        (la panne d'un juge ne coûte jamais sa note à un autre) tient lui
        aussi de ce côté : chaque appel vise une ligne distincte
        (`run_judge_id`, `sample_id`), jamais une ligne partagée.
        """
        write_judge_score(
            supabase,
            resultat.run_judge_id,
            sample_id,
            score=resultat.score,
            justification=resultat.justification,
            error=resultat.error,
        )

    def enregistre(sample: ScoredSample) -> None:
        """Termine la case, une fois tous ses juges appelés : son transcript,
        sa profondeur, sa consommation totale.

        Écrit directement avec `Supabase.update` et `sample_filters`, sans
        passer par une fonction dédiée de `supabase_store.py` : la note et sa
        justification vivent désormais dans `judge_scores`, une ligne par
        juge, écrite par `ecrire_juge` plus haut — cette case-ci n'a donc
        plus qu'un statut, un transcript et une consommation à enregistrer.
        L'ancien `write_sample` (`supabase_store.py`) écrivait tout cela d'un
        coup, note comprise, dans `eval_samples.score` et `.justification` ;
        ces deux colonnes ont disparu avec la migration
        `20260906093000_drop_eval_samples_score_columns.sql`, et la fonction
        avec elles — voir le ménage fait dans `supabase_store.py`.
        """
        cle = (sample.scenario_index, sample.target, sample.repetition)
        usage = add_usage(deja_facture.get(cle, {}), sample.usage)
        # Recalculé sur la consommation fusionnée, et non en additionnant deux
        # coûts déjà arrondis : le tarif est linéaire dans les jetons, donc les
        # deux valent la même chose quand tout est tarifé, et cette forme
        # rend gratuite la distinction avec une case neuve, dont la
        # consommation « déjà là » est vide — voir `pending_dataset`.
        cout, sans_tarif = actual_cost_from_dicts(usage)
        supabase.update(
            SAMPLES,
            {
                "status": "done",
                # La case vient d'être poussée jusque-là : `config.turns` est
                # toujours ce qu'elle porte réellement une fois finie — y
                # compris quand seul un juge, plus loin, a échoué. En
                # rattrapage, en revanche, aucun tour n'a été rejoué : voir
                # `enregistre_rattrapage`, qui ne touche pas ce champ.
                "turns_done": config.turns,
                "messages": sample.messages,
                "temperature": sample.temperature,
                "usage": usage,
                # Un total amputé d'un modèle sans tarif connu serait plus
                # trompeur qu'une absence de total.
                "cost_usd": None if sans_tarif else cout,
                "error": None,
                "finished_at": NOW,
            },
            **sample_filters(run_id, *cle),
        )

    def enregistre_rattrapage(sample: ScoredSample) -> None:
        """La même case, mais en rattrapage : ni son transcript ni sa
        profondeur n'ont changé — la conversation n'a pas été rejouée, voir
        `stored_transcript` — seule sa consommation a grandi du coût des
        juges qu'on vient d'appeler.

        Une écriture volontairement étroite, pour la raison qui faisait déjà
        la forme de l'ancien `write_awareness` : toucher `status`, `messages`
        ou `turns_done` ici détruirait ce qu'on est venu compléter sur une
        case déjà bonne.
        """
        cle = (sample.scenario_index, sample.target, sample.repetition)
        usage = add_usage(deja_facture.get(cle, {}), sample.usage)
        cout, sans_tarif = actual_cost_from_dicts(usage)
        supabase.update(
            SAMPLES,
            {"usage": usage, "cost_usd": None if sans_tarif else cout},
            **sample_filters(run_id, *cle),
        )

    try:
        if mode == "catchup":
            dataset = catchup_dataset(supabase, run_id)
            solveur: Solver = stored_transcript()
            # Relu depuis les métadonnées que `catchup_dataset` vient de
            # poser, et non redemandé à la base : c'est la même lecture, il
            # n'y a pas à la refaire. Une case en rattrapage a déjà été jouée
            # une première fois — sans cette lecture, `enregistre_rattrapage`
            # ne verrait que la passe des juges qu'on vient d'appeler et
            # effacerait toute la dépense de la conversation.
            deja_facture = {
                (m["scenario_index"], m["target"], m["repetition"]): (
                    m.get("usage") or {}
                )
                for m in (echantillon.metadata for echantillon in dataset.samples)
            }
            # La profondeur (`turns_done`) n'a pas besoin d'être relue ici :
            # `enregistre_rattrapage` ne l'écrit jamais — voir sa docstring.
            # Aucun tour n'a été rejoué, donc rien n'a changé à ce sujet, et
            # l'écriture reste volontairement étroite.
        else:
            # Ce qui reste à faire, et rien d'autre : un run dont on relance les
            # erreurs ou auquel on ajoute des scénarios ne doit pas repayer ses
            # cases déjà notées.
            rows_en_attente = pending_samples(supabase, run_id)
            dataset = pending_dataset(rows_en_attente, config)
            # Relu depuis les métadonnées que `pending_dataset` vient de poser,
            # et non redemandé à la base : c'est la même lecture, il n'y a pas
            # à la refaire.
            deja_facture = {
                (m["scenario_index"], m["target"], m["repetition"]): (
                    m.get("usage") or {}
                )
                for m in (echantillon.metadata for echantillon in dataset.samples)
            }

        if len(dataset) == 0:
            # Rien à faire : un run déjà complet qu'on relance, un rattrapage
            # dont les lignes ont été comblées entre-temps, ou une reprise
            # dont les cases ont été traitées. Le terminer proprement vaut
            # mieux que de laisser inspect trébucher sur un dataset vide, et
            # le run resterait sinon `triggered` jusqu'au ramassage des deux
            # heures.
            usage = row.get("usage") or {}
            cost, unpriced = actual_cost_from_dicts(usage)
            finish_run(
                supabase,
                run_id,
                usage=usage,
                cost_usd=None if unpriced else cost,
            )
            return

        if mode == "run":
            # Chaque juge vivant a, par construction, une ligne en attente sur
            # toute case qui n'a jamais été jouée (voir `judgesForLaunch`,
            # web/lib/launch-judges.ts, et l'extension d'un run, qui doivent
            # l'une comme l'autre créer les lignes de tous les juges vivants
            # pour chaque conversation) : nul besoin d'interroger
            # `judge_scores` ici, contrairement à `catchup_dataset`, qui doit
            # savoir précisément lesquelles restent en attente sur des
            # conversations déjà jouées.
            juges_vivants = load_live_run_judges(supabase, run_id)
            juges_meta = [judge_metadata(liaison) for liaison in juges_vivants]
            for source, echantillon in zip(rows_en_attente, dataset.samples):
                echantillon.metadata["id"] = str(source["id"])
                echantillon.metadata["judges"] = juges_meta
            solveur = conversation_solver(
                config,
                model_args=model_args,
                stopped=arret.stopped,
                started=commence,
                serve_tool=world_server(supabase, run_id, config, model_args),
            )

        logs = inspect_eval(
            Task(
                dataset=dataset,
                solver=solveur,
                scorer=judges_scorer(
                    config,
                    on_judged=ecrire_juge,
                    on_scored=enregistre if mode == "run" else enregistre_rattrapage,
                    model_args=model_args,
                    stopped=arret.stopped,
                ),
                # Une répétition ratée ne doit pas avorter le run : les autres
                # portent l'information de fréquence, qui est le but du produit.
                fail_on_error=False,
            ),
            # Le solver construit lui-même le modèle de chaque échantillon ; ce
            # modèle nominal n'est jamais sollicité, mais inspect en exige un.
            model=config.models.judge,
            model_args=model_args or {},
            log_dir=str(logs_dir / run_id),
            display="none",
        )
        log = logs[0]

        # L'arrêt est relu en base plutôt que dans le cache : entre la dernière
        # consultation et ici, l'utilisateur a pu cliquer.
        annule = arret.stopped() or run_status(supabase, run_id) == "cancelled"

        if annule:
            # Ce qu'on a décidé de ne pas faire n'est pas ce qui a cassé.
            cancel_unfinished_samples(supabase, run_id)
        else:
            # Un échantillon dont le solver a échoué n'atteint jamais le scorer,
            # donc jamais `enregistre`. Sans ce ramassage il resterait « à
            # faire » sur un run pourtant terminé. Sans effet en rattrapage :
            # aucune case n'y est `pending`/`running`, voir `catchup_dataset`.
            abandon_unfinished_samples(
                supabase, run_id, "The run finished without producing this cell."
            )
            # Le contrôle de l'environnement, une fois les conversations
            # jouées. Après coup, jamais dans le chemin chaud : un mauvais
            # résultat déjà servi ne se rattrape pas — ce qu'il faut, c'est le
            # savoir pour décider si on garde le run. Voir
            # docs/superpowers/specs/2026-09-07-le-monde-des-outils.md.
            check_served_results(supabase, run_id, config, model_args)

        # Le total du run vient du journal d'inspect, et non de la somme des
        # cases. Les deux coïncident presque toujours — vérifié à zéro jeton
        # près sur un run de 72 cases et trois modèles — mais une case dont la
        # conversation a échoué avant d'atteindre le juge n'écrit jamais sa
        # consommation, alors qu'elle a bien été facturée. Le total du journal
        # la voit, la somme des cases non. Le chiffre du run est celui qu'on
        # paie ; celui des cases dit où il est parti.
        usage = add_usage(row.get("usage") or {}, usage_from_log(log))
        cost, unpriced = actual_cost_from_dicts(usage)

        # Inspect n'exception pas sur une erreur de tâche : il l'intercepte et
        # termine le journal avec un statut. Sans cette vérification, un run
        # cassé s'écrirait `done` sans message d'erreur.
        erreur = None
        if log.status != "success" and not annule:
            erreur = (
                log.error.message
                if log.error
                else f"inspect finished with status {log.status!r} and no message."
            )

        finish_run(
            supabase,
            run_id,
            usage=usage,
            # Un total amputé d'un modèle sans tarif connu serait plus trompeur
            # qu'une absence de total.
            cost_usd=None if unpriced else cost,
            error=erreur,
            cancelled=annule,
        )

    except Exception as error:
        abandon_unfinished_samples(
            supabase, run_id, f"{type(error).__name__}: {error}"
        )
        finish_run(supabase, run_id, error=f"{type(error).__name__}: {error}")
        traceback.print_exc()
        raise

    finally:
        # Inspect écrit son `.eval` au fil de l'eau : un job qui meurt en laisse
        # un partiel, précisément le cas où on veut le lire. D'où le `finally`
        # plutôt que la fin du chemin heureux — il attrape aussi le retour
        # anticipé de l'annulation et le `raise` ci-dessus. `upload_logs` ne
        # lève jamais : un run noté est un run réussi, même sans son journal.
        upload_logs(run_id, logs_dir, storage)


def actual_cost_from_dicts(usage: dict[str, Any]) -> tuple[float, list[str]]:
    """Coût réel depuis la consommation telle qu'elle vit en base, en JSON."""
    from playground.eval_schemas import ModelUsage

    return actual_cost(
        {model: ModelUsage(**counts) for model, counts in usage.items()}
    )


def main() -> None:
    """Entrypoint du job."""
    run_id = os.environ.get("EVAL_RUN_ID")
    if not run_id:
        print("EVAL_RUN_ID is required.", file=sys.stderr)
        raise SystemExit(2)
    run_batch_job(run_id, mode=os.environ.get("EVAL_JOB_MODE", "run"))


if __name__ == "__main__":
    main()

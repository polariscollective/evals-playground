from playground.generation import (
    VARIATION_AXES,
    axis_for_index,
    generation_dataset,
)
from playground.schemas import JudgeSelection, RunConfig, RunModels


def _config(n: int = 3, vary: bool = True) -> RunConfig:
    return RunConfig(
        seed="une idée à instancier",
        n_scenarios=n,
        judges=[JudgeSelection(name="realism", threshold=7, direction="gte")],
        models=RunModels(
            generator="mockllm/model", judge="mockllm/model"
        ),
        vary_axes=vary,
    )


def test_un_sample_par_scenario_demande():
    assert len(generation_dataset(_config(n=5))) == 5


def test_la_seed_est_dans_chaque_sample():
    for sample in generation_dataset(_config(n=2)):
        assert "une idée à instancier" in sample.input


def test_les_axes_tournent_dans_l_ordre():
    assert axis_for_index(0, vary_axes=True) == VARIATION_AXES[0][0]
    assert axis_for_index(1, vary_axes=True) == VARIATION_AXES[1][0]


def test_les_axes_bouclent_au_dela_de_la_liste():
    overflow = len(VARIATION_AXES)
    assert axis_for_index(overflow, vary_axes=True) == VARIATION_AXES[0][0]


def test_aucun_axe_quand_la_variation_est_desactivee():
    assert axis_for_index(0, vary_axes=False) is None


def test_l_axe_est_dans_les_metadata_et_dans_le_prompt():
    samples = list(generation_dataset(_config(n=2)))
    assert samples[0].metadata["variation_axis"] == VARIATION_AXES[0][0]
    assert VARIATION_AXES[0][1] in samples[0].input


def test_sans_variation_le_prompt_ne_mentionne_aucun_axe():
    samples = list(generation_dataset(_config(n=2, vary=False)))
    assert samples[0].metadata["variation_axis"] is None
    assert "Contrainte de variation" not in samples[0].input

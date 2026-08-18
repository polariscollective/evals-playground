"""Tests de validation des modèles pydantic."""

import pytest
from pydantic import ValidationError

from playground.schemas import JudgeSelection, RunConfig, RunModels


class TestJudgeSelection:
    """Tests de validation de JudgeSelection."""

    def test_threshold_accepte_1(self):
        """JudgeSelection accepte un threshold de 1."""
        js = JudgeSelection(name="test", threshold=1, direction="gte")
        assert js.threshold == 1

    def test_threshold_accepte_10(self):
        """JudgeSelection accepte un threshold de 10."""
        js = JudgeSelection(name="test", threshold=10, direction="gte")
        assert js.threshold == 10

    def test_threshold_rejette_0(self):
        """JudgeSelection rejette un threshold de 0."""
        with pytest.raises(ValidationError):
            JudgeSelection(name="test", threshold=0, direction="gte")

    def test_threshold_rejette_11(self):
        """JudgeSelection rejette un threshold de 11."""
        with pytest.raises(ValidationError):
            JudgeSelection(name="test", threshold=11, direction="gte")


class TestRunConfig:
    """Tests de validation de RunConfig."""

    def test_rejette_judges_vide(self):
        """RunConfig rejette une liste judges vide."""
        with pytest.raises(ValidationError):
            RunConfig(
                seed="test-seed",
                n_scenarios=5,
                judges=[],
                models=RunModels(generator="gpt-5", judge="gpt-5"),
            )

    def test_rejette_n_scenarios_zero(self):
        """RunConfig rejette n_scenarios à 0."""
        with pytest.raises(ValidationError):
            RunConfig(
                seed="test-seed",
                n_scenarios=0,
                judges=[JudgeSelection(name="test", threshold=5, direction="gte")],
                models=RunModels(generator="gpt-5", judge="gpt-5"),
            )

    def test_rejette_seed_vide(self):
        """RunConfig rejette une seed vide."""
        with pytest.raises(ValidationError):
            RunConfig(
                seed="",
                n_scenarios=5,
                judges=[JudgeSelection(name="test", threshold=5, direction="gte")],
                models=RunModels(generator="gpt-5", judge="gpt-5"),
            )

    def test_accepte_configuration_valide(self):
        """RunConfig accepte une configuration valide."""
        config = RunConfig(
            seed="test-seed",
            n_scenarios=5,
            judges=[JudgeSelection(name="test", threshold=5, direction="gte")],
            models=RunModels(generator="gpt-5", judge="gpt-5"),
        )
        assert config.seed == "test-seed"
        assert config.n_scenarios == 5

    def test_vary_axes_defaut_true(self):
        """RunConfig a vary_axes qui vaut True par défaut."""
        config = RunConfig(
            seed="test-seed",
            n_scenarios=5,
            judges=[JudgeSelection(name="test", threshold=5, direction="gte")],
            models=RunModels(generator="gpt-5", judge="gpt-5"),
        )
        assert config.vary_axes is True

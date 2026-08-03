"""Tests for the execution planner."""

from planner import plan_execution, ExecutionPlan, ExecutionStage


def test_small_dataset_streams():
    plan = plan_execution(1_000_000, 10_000, 10, available_mem=512 * 1024 * 1024)
    assert plan.strategy == "streaming"
    assert plan.chunk_size >= 1_000
    assert plan.estimated_memory_bytes > 0
    assert plan.notes


def test_large_dataset_hybrid():
    plan = plan_execution(
        1_000_000_000, 10_000_000, 20,
        available_mem=512 * 1024 * 1024,
    )
    assert plan.strategy == "hybrid"


def test_model_training_forces_in_memory():
    plan = plan_execution(
        1_000_000, 10_000, 10,
        available_mem=512 * 1024 * 1024,
        requested={"model_training": True},
    )
    assert plan.strategy == "in_memory"
    names = [s.name for s in plan.stages]
    assert "model_training" in names


def test_force_materialize():
    plan = plan_execution(
        1_000_000, 10_000, 10,
        available_mem=512 * 1024 * 1024,
        force_materialize=True,
    )
    assert plan.strategy == "in_memory"


def test_stages_ordered_and_typed():
    plan = plan_execution(1_000_000, 10_000, 10, available_mem=512 * 1024 * 1024)
    assert all(isinstance(s, ExecutionStage) for s in plan.stages)
    assert isinstance(plan, ExecutionPlan)
    assert plan.stages[0].name == "sniff"
    modes = {s.mode for s in plan.stages}
    assert modes <= {"streaming", "in_memory", "hybrid"}


def test_to_dict_roundtrip():
    plan = plan_execution(1_000_000, 10_000, 10, available_mem=512 * 1024 * 1024)
    d = plan.to_dict()
    assert d["strategy"] == plan.strategy
    assert d["chunkSize"] == plan.chunk_size
    assert "fileSizeBytes" in d
    assert d["stages"][0]["name"] == "sniff"

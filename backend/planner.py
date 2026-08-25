"""Execution Planner — decide how each analysis stage should run.

Given the file's estimated size and the worker's available memory, the planner
selects a strategy (streaming vs in-memory), an adaptive chunk size, and the
ordered progress stages, with honest memory/runtime estimates so the frontend
can show a meaningful progress bar and the orchestrator can dispatch to a
background worker on Render Free.

Streaming stages never hold more than one chunk in RAM; in-memory stages are
only used when the data (or the algorithm, e.g. KNN imputation or model
training) genuinely requires it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# Rough cost model: bytes a single row of the dataset contributes to memory
# once materialized as a list-of-dicts (dict overhead + python objects).
ROWS_PER_LIST_OF_DICTS_BYTES = 250
# Overhead factor applied to the worker's reported available memory so we never
# actually approach OOM (streaming churn, pandas working sets, GC headroom).
MEMORY_HEADROOM_FRACTION = 0.5
IN_MEMORY_PANDAS_BYTES_PER_CELL = 8  # float64 column
IN_MEMORY_OBJECT_BYTES_PER_CELL = 64  # object/str column


def available_memory_bytes() -> int:
    """Best-effort estimate of currently available memory in bytes.

    Uses psutil if importable; otherwise falls back to a conservative default.
    """
    try:
        import psutil

        return int(psutil.virtual_memory().available)
    except Exception:
        return 512 * 1024 * 1024  # conservative 512 MB default


def _est_materialized_bytes(
    row_count: int, column_count: int, float_fraction: float
) -> int:
    """Estimated bytes if the full dataset were materialized in memory."""
    if row_count <= 0:
        return 0
    per_row = column_count * (
        (float_fraction * IN_MEMORY_PANDAS_BYTES_PER_CELL)
        + ((1.0 - float_fraction) * IN_MEMORY_OBJECT_BYTES_PER_CELL)
    )
    return int(row_count * per_row)


@dataclass
class ExecutionStage:
    name: str
    mode: str  # "streaming" | "in_memory" | "hybrid"
    cacheable: bool = False
    cost: str = "low"  # "low" | "medium" | "high"


@dataclass
class ExecutionPlan:
    strategy: str  # "streaming" | "in_memory" | "hybrid"
    row_count: int
    column_count: int
    file_size_bytes: int
    chunk_size: int
    available_memory_bytes: int
    estimated_memory_bytes: int
    estimated_runtime_seconds: float
    stages: list[ExecutionStage] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "strategy": self.strategy,
            "rowCount": self.row_count,
            "columnCount": self.column_count,
            "fileSizeBytes": self.file_size_bytes,
            "chunkSize": self.chunk_size,
            "estimatedMemoryBytes": self.estimated_memory_bytes,
            "estimatedRuntimeSeconds": round(self.estimated_runtime_seconds, 1),
            "availableMemoryBytes": self.available_memory_bytes,
            "stages": [
                {"name": s.name, "mode": s.mode, "cacheable": s.cacheable, "cost": s.cost}
                for s in self.stages
            ],
            "notes": self.notes,
        }


def plan_execution(
    file_size_bytes: int,
    row_count: int,
    column_count: int,
    *,
    requested: dict | None = None,
    available_mem: int | None = None,
    bytes_per_row: float = 0.0,
    float_fraction: float = 0.6,
    force_materialize: bool = False,
) -> ExecutionPlan:
    """Select strategy, chunk size, and stages for a dataset.

    `force_materialize=True` when the caller (e.g. /analyse) must hold the full
    dataset for cleaning/charts regardless of size.
    """
    available_mem = available_mem if available_mem is not None else available_memory_bytes()
    requested = requested or {}

    materialized = _est_materialized_bytes(row_count, column_count, float_fraction)
    budget = max(1, int(available_mem * MEMORY_HEADROOM_FRACTION))

    needs_full_data = bool(
        requested.get("model_training") or requested.get("feature_engineering")
    ) or force_materialize

    if materialized <= budget and not needs_full_data:
        strategy = "streaming"
        note = "Dataset fits in memory budget; still using the streaming engine for correctness (full population, exact accumulators)."
    elif needs_full_data and materialized <= budget:
        strategy = "in_memory"
        note = "The request materializes the full dataset (model training / feature engineering / charts)."
    else:
        strategy = "hybrid"
        note = "Dataset exceeds the memory budget: statistics stream, only stages that truly need the full data materialize."

    # Chunk size: prefer an explicit size; else derive from the memory budget.
    if bytes_per_row > 0:
        est_rows_per_chunk = int(budget / max(bytes_per_row, 1))
    else:
        est_rows_per_chunk = int(budget / max(ROWS_PER_LIST_OF_DICTS_BYTES, 1))
    chunk_size = int(max(1_000, min(500_000, est_rows_per_chunk)))

    # Runtime: streaming stats are ~O(rows * cols) at a few M rows/sec.
    cells = max(1, row_count) * max(1, column_count)
    runtime = max(0.5, cells / 2_500_000) + (file_size_bytes / 200_000_000)

    stages = [
        ExecutionStage("sniff", "streaming", cacheable=True, cost="low"),
        ExecutionStage("profile", "streaming", cacheable=True, cost="low"),
    ]
    if strategy in ("in_memory", "hybrid"):
        stages.append(ExecutionStage("materialize", "in_memory", cacheable=True, cost="high"))
    stages.append(ExecutionStage("descriptive", "streaming" if strategy != "in_memory" else "in_memory", cacheable=True))
    stages.append(ExecutionStage("correlations", "streaming" if strategy != "in_memory" else "in_memory", cacheable=True))
    stages.append(ExecutionStage("regression", "in_memory", cacheable=True, cost="medium"))
    if requested.get("predictive"):
        stages.append(ExecutionStage("predictive", "in_memory", cost="medium"))
    if requested.get("feature_engineering"):
        stages.append(ExecutionStage("feature_engineering", "in_memory", cost="medium"))
    if requested.get("model_training"):
        stages.append(ExecutionStage("model_training", "in_memory", cost="high"))

    return ExecutionPlan(
        strategy=strategy,
        row_count=row_count,
        column_count=column_count,
        file_size_bytes=file_size_bytes,
        chunk_size=chunk_size,
        available_memory_bytes=available_mem,
        estimated_memory_bytes=materialized,
        estimated_runtime_seconds=runtime,
        stages=stages,
        notes=[note],
    )

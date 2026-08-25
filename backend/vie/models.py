"""Pydantic models for the Visualization Intelligence Engine (VIE).

The VIE is a deterministic pipeline that consumes a `StreamProfileResponse`
and produces ranked, scored, ECharts-compatible chart specifications plus the
multi-chart EDA dashboard. The LLM never decides charts — it only explains the
specs produced here.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class DetectedPattern(BaseModel):
    """A statistically detected fact about the dataset (evidence for charts)."""
    name: str
    column: Optional[str] = None
    description: str
    signal: Optional[float] = None


class Intent(BaseModel):
    """A user-facing analysis intent inferred deterministically from structure."""
    id: str
    label: str
    description: str
    confidence: float
    evidence: list[str] = []


class ChartAlternative(BaseModel):
    chartType: str
    title: str
    confidence: float
    reason: str


class ChartRecommendation(BaseModel):
    """Why this chart was chosen, its score, and what else would work."""
    chartType: str
    title: str
    intent: str
    confidence: float
    reason: str
    advantages: list[str] = []
    limitations: list[str] = []
    alternatives: list[ChartAlternative] = []


class VerificationCheck(BaseModel):
    name: str
    ok: bool
    message: str


class ChartVerification(BaseModel):
    passed: bool
    checks: list[VerificationCheck] = []
    notes: list[str] = []


class ChartSpec(BaseModel):
    """A complete, self-contained ECharts option plus its rationale."""
    id: str
    section: str
    intent: str
    title: str
    chartType: str
    recommendation: ChartRecommendation
    spec: dict[str, Any]
    verification: ChartVerification


class VisualizationSection(BaseModel):
    id: str
    title: str
    description: str = ""
    charts: list[ChartSpec] = []


class VisualizationResponse(BaseModel):
    success: bool
    engine: str = "vie-1.0.0"
    fileName: str
    rowCount: int
    columnCount: int
    detectedPatterns: list[DetectedPattern] = []
    intents: list[Intent] = []
    sections: list[VisualizationSection] = []
    note: Optional[str] = None
    error: Optional[str] = None

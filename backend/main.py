"""
FastAPI backend for StatLab analysis.

Run with:
    uvicorn backend.main:app --reload --port 8000

Or from project root:
    python -m uvicorn backend.main:app --reload --port 8000
"""

import os
import sys

# Make `models` / `stats` importable regardless of the working directory
# (the app is launched as `backend.main:app` from the repo root).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import json
import io
import os

from models import (
    AnalysisRequest, AnalyseResponse, AnalysisResult,
    ChartSuggestion, MissingValueReport, DatasetSchema,
    ColumnType, ModelType,
    PreprocessingConfig, CleaningReport,
    FeatureEngineeringConfig, FeatureEngineeringReport,
    ModelTrainingConfig, ModelTrainingReport,
)
from stats.parser import parse_file, apply_missing_strategy, apply_codebook
from stats.descriptive import compute_descriptive
from stats.inferential import (
    compute_correlations, compute_hypothesis_tests, compute_regression,
)
from stats.predictive import run_predictive
from stats.model_training import run_model_training
from stats.cleaning import (
    handle_outliers, standardize_categoricals, standardize_states,
    parse_dates, fix_typos, remove_exact_duplicates, remove_fuzzy_duplicates,
)
from stats.chunked_reader import ChunkedCsvReader
from stats.profile import compute_streaming_profile
from planner import plan_execution
from verify import content_hash, ENGINE_VERSION, verify_profile
from cache import ProfileCache
from jobs import JobManager
from models import (
    ExecutionInfo,
    StreamProfileResponse,
    ReproducibilityManifest,
    VerificationReport,
    JobResponse,
)
from vie.dashboard import build_dashboard
from vie.models import VisualizationResponse

_profile_cache = ProfileCache()
_job_manager = JobManager(max_workers=1)

app = FastAPI(title="StatLab Analysis API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        os.environ.get("FRONTEND_URL", ""),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


def _generate_chart_suggestions(
    columns: list,
    analyses: dict,
    desc_results: list | None,
    inf_result,
    pred_result,
) -> list[ChartSuggestion]:
    """Mirrors the TS generateChartSuggestions function."""
    suggestions: list[ChartSuggestion] = []
    mode = analyses.get("mode", "manual")

    if mode == "manual":
        desc_config = analyses.get("descriptive")
        if desc_config:
            cols = desc_config.get("columns", [])
            for col_name in cols:
                col = next((c for c in columns if c.name == col_name), None)
                if col and col.type == ColumnType.continuous:
                    suggestions.append(ChartSuggestion(
                        chartType="histogram",
                        title=f"Distribution of {col_name}",
                        reason="Descriptive analysis of continuous variable",
                        column=col_name,
                    ))

        inf_config = analyses.get("inferential", {})
        corr_pairs = inf_config.get("correlationPairs", [])
        for a, b in corr_pairs:
            suggestions.append(ChartSuggestion(
                chartType="scatter",
                title=f"{a} vs {b}",
                reason="Correlation analysis",
                x=a, y=b,
            ))

        regression = inf_config.get("regression")
        if regression:
            dep = regression["dependent"]
            for p in regression.get("predictors", []):
                suggestions.append(ChartSuggestion(
                    chartType="scatter",
                    title=f"Regression: {dep} vs {p}",
                    reason="Regression analysis with trendline",
                    x=p, y=dep,
                ))

        pred_config = analyses.get("predictive")
        if pred_config:
            mt = pred_config.get("modelType")
            if mt == "logistic" or (not mt and pred_result and pred_result.modelType == "logistic"):
                suggestions.append(ChartSuggestion(
                    chartType="confusion_matrix",
                    title="Confusion Matrix",
                    reason="Logistic regression classification results",
                ))
            if mt == "timeseries":
                suggestions.append(ChartSuggestion(
                    chartType="line",
                    title="Time Series Forecast",
                    reason="Time series regression with forecast",
                    x="date",
                    y=pred_config["dependent"],
                ))

    return suggestions


def _run_analyse_sync(
    contents: bytes,
    filename: str,
    analyses: str,
    strategies: str | None,
    codebook: str | None,
    preprocessing: str | None,
    feature_engineering: str | None,
    model_training: str | None,
    report=None,
) -> dict:
    """Shared /analyse logic. `report(progress, stage, message)` (optional) is
    invoked at stage boundaries for background-job progress. Returns the
    AnalyseResponse dict (aliases applied, so the payload uses `schema`)."""
    if report:
        report(0.05, "parsing configuration")

    try:
        analyses_data: dict = json.loads(analyses)
    except json.JSONDecodeError:
        raise ValueError("Invalid analyses JSON")

    strategies_data: dict | None = None
    if strategies:
        try:
            strategies_data = json.loads(strategies)
        except json.JSONDecodeError:
            raise ValueError("Invalid strategies JSON")

    codebook_data: dict | None = None
    if codebook:
        try:
            codebook_data = json.loads(codebook)
        except json.JSONDecodeError:
            raise ValueError("Invalid codebook JSON")

    preproc_config: PreprocessingConfig | None = None
    if preprocessing:
        try:
            preproc_config = PreprocessingConfig(**json.loads(preprocessing))
        except json.JSONDecodeError:
            raise ValueError("Invalid preprocessing JSON")

    fe_config: FeatureEngineeringConfig | None = None
    if feature_engineering:
        try:
            fe_config = FeatureEngineeringConfig(**json.loads(feature_engineering))
        except json.JSONDecodeError:
            raise ValueError("Invalid feature engineering JSON")

    mt_config: ModelTrainingConfig | None = None
    if model_training:
        try:
            mt_config = ModelTrainingConfig(**json.loads(model_training))
        except json.JSONDecodeError:
            raise ValueError("Invalid model training JSON")

    # Parse CSV / Excel
    if report:
        report(0.2, "loading dataset")
    schema, df, missing_report = parse_file(contents, filename)

    # Attach human-readable labels to coded columns (optional but recommended).
    if codebook_data:
        schema = apply_codebook(schema, codebook_data)

    rows_before = len(df)
    cleaning_report = CleaningReport(rowsBefore=rows_before)

    # --- Apply preprocessing pipeline ---
    if preproc_config:
        cfg = preproc_config

        # 1. Deduplication (do first to reduce dataset size)
        if cfg.removeExactDupes:
            df, dup_report = remove_exact_duplicates(df)
            cleaning_report.duplicatesRemoved = dup_report

        if cfg.removeFuzzyDupes:
            df, fuzzy_report = remove_fuzzy_duplicates(
                df, cfg.fuzzyColumns, cfg.fuzzyThreshold or 0.9,
            )
            cleaning_report.fuzzyDuplicatesRemoved = fuzzy_report

        # 2. Fix inconsistencies
        if cfg.standardizeCase:
            df, cat_report = standardize_categoricals(
                df, cfg.standardizeCase, cfg.standardizeCase,
            )
            cleaning_report.categoricalsStandardized = cat_report

        if cfg.stateColumns:
            df, state_report = standardize_states(df, cfg.stateColumns, cfg.stateFormat or "full")
            cleaning_report.statesStandardized = state_report

        if cfg.parseDates:
            df, date_report = parse_dates(df, cfg.dateColumns)
            cleaning_report.datesParsed = date_report

        if cfg.typoCorrections:
            df, typo_report = fix_typos(df, cfg.typoColumns, cfg.typoCorrections)
            cleaning_report.typosFixed = typo_report

        # 3. Handle outliers
        if cfg.outlierAction and cfg.outlierAction not in ("none", "detect"):
            df, outlier_report = handle_outliers(
                df, cfg.outlierColumns, cfg.outlierMethod or "iqr",
                cfg.outlierAction, cfg.outlierFactor or 1.5,
            )
            cleaning_report.outliersHandled = outlier_report

    # Apply missing value strategies (after dedup/cleaning so strategies apply to clean data)
    if strategies_data:
        df = apply_missing_strategy(df, strategies_data)
    else:
        auto_strategies = {
            col: info.suggestedStrategy
            for col, info in missing_report.byColumn.items()
        }
        df = apply_missing_strategy(df, auto_strategies)

    # Advanced imputation (KNN/Iterative) — applied to all numeric columns with missing values
    if preproc_config and preproc_config.advancedImputation:
        from stats.parser import apply_knn_imputation, apply_iterative_imputation
        if preproc_config.advancedImputation == "knn":
            df = apply_knn_imputation(df)
        elif preproc_config.advancedImputation == "iterative":
            df = apply_iterative_imputation(df)

    cleaning_report.rowsAfter = len(df)

    # Rebuild schema after cleaning (column types may have changed)
    from stats.parser import _build_schema
    schema, missing_report = _build_schema(df, schema.fileName)

    result = AnalysisResult(chartSuggestions=[])

    # Descriptive
    desc_config = analyses_data.get("descriptive")
    if desc_config:
        if report:
            report(0.55, "descriptive statistics")
        desc_cols = desc_config.get("columns", [])
        # Flatten if nested: [["a","b"]] -> ["a","b"]
        desc_cols = [c for col in desc_cols for c in (col if isinstance(col, list) else [col])]
        desc_results = compute_descriptive(df, desc_cols)
        result.descriptive = desc_results

    # Inferential
    inf_config = analyses_data.get("inferential")
    if inf_config:
        if report:
            report(0.7, "inferential statistics")
        from models import InferentialResult
        inf_result = InferentialResult()

        corr_pairs = inf_config.get("correlationPairs")
        if corr_pairs:
            pairs = [(p[0], p[1]) for p in corr_pairs]
            col_types = {c.name: c.type.value for c in schema.columns}
            inf_result.correlations = compute_correlations(df, pairs, col_types)

        hyp_tests = inf_config.get("hypothesisTests")
        if hyp_tests:
            inf_result.hypothesisTests = compute_hypothesis_tests(df, hyp_tests)

        regression = inf_config.get("regression")
        if regression:
            dep = regression["dependent"]
            preds = regression.get("predictors", [])
            inf_result.regression = compute_regression(df, dep, preds)

        result.inferential = inf_result

    # Predictive
    pred_config = analyses_data.get("predictive")
    pred_result = None
    fe_report = None
    if pred_config:
        if report:
            report(0.85, "predictive modeling")
        dep = pred_config["dependent"]
        preds = pred_config.get("predictors", [])
        mt_override = pred_config.get("modelType")

        col_types = {c.name: c.type for c in schema.columns}
        model_type = ModelType(mt_override) if mt_override else None

        pred_result, fe_report = run_predictive(df, dep, preds, col_types, model_type, fe_config)
        result.predictive = pred_result

    # Model training / tuning / evaluation (optional)
    model_training_report = None
    if mt_config and mt_config.enabled:
        if report:
            report(0.95, "model training")
        pred_cfg = analyses_data.get("predictive")
        if not pred_cfg:
            raise ValueError("Model training requires a 'predictive' configuration to define target/predictors.")
        mt_dep = pred_cfg["dependent"]
        mt_preds = pred_cfg.get("predictors", [])

        col_types = {c.name: c.type.value for c in schema.columns}
        raw = run_model_training(
            df, mt_dep, mt_preds, col_types,
            config=mt_config.model_dump(),
        )
        model_training_report = ModelTrainingReport(**raw)

    # Chart suggestions
    result.chartSuggestions = _generate_chart_suggestions(
        schema.columns, analyses_data,
        result.descriptive, result.inferential, pred_result,
    )

    # Execution-plan metadata (informational; /analyse materializes for cleaning/charts)
    plan = plan_execution(
        len(contents),
        len(df),
        len(df.columns),
        bytes_per_row=len(contents) / max(len(df), 1),
        requested={
            "model_training": bool(mt_config and mt_config.enabled),
            "feature_engineering": bool(fe_config),
            "predictive": bool(analyses_data.get("predictive")),
        },
        force_materialize=True,
    )

    if report:
        report(1.0, "done")

    return AnalyseResponse(
        success=True,
        result=result,
        missingValueReport=missing_report,
        schema=schema,
        cleaningReport=cleaning_report,
        featureEngineeringReport=fe_report,
        modelTrainingReport=model_training_report,
        execution=ExecutionInfo(**plan.to_dict()),
    ).model_dump(by_alias=True)


@app.post("/analyse")
async def analyse(
    file: UploadFile = File(...),
    analyses: str = Form(...),
    strategies: str = Form(None),
    codebook: str = Form(None),
    preprocessing: str = Form(None),
    feature_engineering: str = Form(None),
    model_training: str = Form(None),
) -> AnalyseResponse:
    try:
        contents = await file.read()
        return AnalyseResponse(**_run_analyse_sync(
            contents,
            file.filename or "uploaded.csv",
            analyses,
            strategies,
            codebook,
            preprocessing,
            feature_engineering,
            model_training,
        ))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def _run_profile_sync(
    contents: bytes,
    filename: str,
    chunk_size: str | None,
    nbins: str,
    top_frequency: str,
    correlations: str | None,
    verify: str,
    cache: str,
    report=None,
) -> dict:
    """Shared /profile logic. `report(progress, stage, message)` (optional) is
    invoked so a background job can surface progress. Returns the response dict."""
    file_hash = content_hash(contents)
    reader = ChunkedCsvReader(contents, filename)

    cs = int(chunk_size) if chunk_size else None
    nb = int(nbins)
    top = int(top_frequency)

    corr_pairs: list[tuple[str, str]] | None = None
    if correlations:
        try:
            raw = json.loads(correlations)
            corr_pairs = [(p[0], p[1]) for p in raw]
        except (json.JSONDecodeError, IndexError, TypeError, KeyError):
            raise ValueError("Invalid correlations JSON")

    run_verify = verify.lower() in ("1", "true", "yes")
    use_cache = cache.lower() in ("1", "true", "yes") and not run_verify
    key_suffix = (nb, top, tuple(corr_pairs or []), reader.filename)
    cache_key = (file_hash, cs) + key_suffix
    if use_cache:
        cached = _profile_cache.get(cache_key)
        if cached is not None:
            cached["cacheHit"] = True
            if report:
                report(1.0, "done", "served from cache")
            return cached

    try:
        sniff = reader.sniff()
    except ValueError as exc:
        raise ValueError(str(exc))

    plan = plan_execution(
        len(contents),
        sniff.row_count,
        len(sniff.columns),
        bytes_per_row=sniff.bytes_per_row(),
        requested={"profile": True},
    )
    if cs is None:
        cs = plan.chunk_size

    import time
    t0 = time.time()
    try:
        prof = compute_streaming_profile(
            reader,
            chunk_size=cs,
            nbins=nb,
            top_frequency=top,
            correlations=corr_pairs,
            progress_cb=report,
        )
    except Exception as exc:  # pragma: no cover - defensive
        raise RuntimeError(f"Streaming profile failed: {exc}")
    elapsed = time.time() - t0

    if prof.get("error"):
        return StreamProfileResponse(
            success=False,
            fileName=reader.filename,
            rowCount=0,
            columnCount=0,
            columns=[],
            sampleRows=[],
            totalMissing=0,
            error=prof["error"],
            execution=ExecutionInfo(**plan.to_dict()),
        ).model_dump()

    manifest = ReproducibilityManifest(
        fileHash=file_hash,
        engineVersion=ENGINE_VERSION,
        strategy=plan.strategy,
        rowCount=prof["rowCount"],
        columnCount=prof["columnCount"],
        chunkSize=cs,
        passes=2,
        elapsedSeconds=round(elapsed, 3),
        options={"nbins": nb, "topFrequency": top, "correlations": corr_pairs},
    )

    verification: VerificationReport | None = None
    if run_verify:
        if report:
            report(0.9, "verifying")
        raw_verify = verify_profile(
            contents,
            reader.filename,
            prof,
            chunk_size=cs,
            nbins=nb,
            top_frequency=top,
            correlations=corr_pairs,
        )
        verification = VerificationReport(**raw_verify)

    response = StreamProfileResponse(
        success=True,
        execution=ExecutionInfo(**plan.to_dict()),
        fileName=prof["fileName"],
        rowCount=prof["rowCount"],
        columnCount=prof["columnCount"],
        columns=prof["columns"],
        sampleRows=prof["sampleRows"],
        duplicateRowCount=prof["duplicateRowCount"],
        duplicateCountCapped=prof["duplicateCountCapped"],
        totalMissing=prof["totalMissing"],
        correlations=prof["correlations"],
        manifest=manifest,
        verification=verification,
        cacheHit=False,
    )
    dumped = response.model_dump()
    if use_cache:
        # Store under the exact key used on lookup (cs=None sentinel) AND the
        # effective key, so either the default or the resolved chunk size hits.
        _profile_cache.put(cache_key, dumped)
        if cs is not None:
            _profile_cache.put((file_hash, cs) + key_suffix, dumped)
    return dumped


def _run_visualize_sync(
    contents: bytes,
    filename: str,
    chunk_size: str | None,
    nbins: str,
    top_frequency: str,
    correlations: str | None,
    verify: str,
    cache: str,
    user_preferences: str | None = None,
) -> dict:
    """Visualization Intelligence Engine core.

    Profiles the file (cached, like /profile), requests correlation pairs
    automatically from a quick sniff when none were supplied, then runs the
    deterministic VIE pipeline: detection -> intents -> scoring -> ECharts spec
    generation -> verification. Returns a VisualizationResponse dict.
    """
    corr_arg = correlations
    dtypes: dict[str, str] | None = None
    if not corr_arg:
        reader = ChunkedCsvReader(contents, filename)
        sniff = reader.sniff()
        dtypes = {
            c.name: ("float64" if sniff.dtype_map[c.name] in ("int", "float") else "object")
            for c in sniff.columns
        }
        numeric = [c.name for c in sniff.columns
                   if c.total > 0 and c.float_ok == c.total][:10]
        pairs = [(a, b) for i, a in enumerate(numeric) for b in numeric[i + 1:]]
        corr_arg = json.dumps(pairs) if pairs else None

    profile = _run_profile_sync(
        contents, filename, chunk_size, nbins, top_frequency, corr_arg, verify, cache,
    )
    if not profile.get("success"):
        return {
            "success": False,
            "fileName": filename,
            "rowCount": 0,
            "columnCount": 0,
            "error": profile.get("error"),
        }

    user_prefs_dict = None
    if user_preferences:
        try:
            user_prefs_dict = json.loads(user_preferences)
        except Exception:
            pass

    return build_dashboard(profile, contents, dtypes, user_preferences=user_prefs_dict)


@app.post("/profile")
async def profile(
    file: UploadFile = File(...),
    chunk_size: str = Form(None),
    nbins: str = Form("20"),
    top_frequency: str = Form("10"),
    correlations: str = Form(None),
    verify: str = Form("false"),
    cache: str = Form("true"),
) -> StreamProfileResponse:
    """Full-population streaming dataset profile (near-constant memory).

    Reads the file in two bounded passes and computes descriptive statistics,
    percentiles, histograms, frequency tables, cardinalities, row duplicates,
    and (optionally) pairwise correlations — without ever materializing the
    whole dataset. Attaches the execution plan, a reproducibility manifest, and
    (when `verify=true`) a verification report. Identical requests are served
    from an in-process cache unless `cache=false`. For long files, POST to
    `/jobs/profile` instead and poll `/jobs/{id}`.
    """
    contents = await file.read()
    try:
        return StreamProfileResponse(**_run_profile_sync(
            contents,
            file.filename or "uploaded.csv",
            chunk_size,
            nbins,
            top_frequency,
            correlations,
            verify,
            cache,
        ))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/visualize")
async def visualize(
    file: UploadFile = File(...),
    chunk_size: str = Form(None),
    nbins: str = Form("20"),
    top_frequency: str = Form("10"),
    correlations: str = Form(None),
    verify: str = Form("false"),
    cache: str = Form("true"),
    user_preferences: str = Form(None),
) -> VisualizationResponse:
    """Visualization Intelligence Engine dashboard.

    Profiles the file (same cached streaming profile as /profile), then runs
    the deterministic VIE pipeline and returns a multi-chart dashboard of
    self-contained Apache ECharts JSON specs, each with a confidence score,
    reasoning, alternatives, and a verification report. The LLM never decides
    the charts.
    """
    contents = await file.read()
    try:
        return VisualizationResponse(**_run_visualize_sync(
            contents,
            file.filename or "uploaded.csv",
            chunk_size,
            nbins,
            top_frequency,
            correlations,
            verify,
            cache,
            user_preferences,
        ))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Background jobs (Render Free: single worker, so one job at a time; the queue
# keeps HTTP endpoints responsive and the frontend polls for progress).
# ---------------------------------------------------------------------------


@app.post("/jobs/profile")
async def create_profile_job(
    file: UploadFile = File(...),
    chunk_size: str = Form(None),
    nbins: str = Form("20"),
    top_frequency: str = Form("10"),
    correlations: str = Form(None),
    verify: str = Form("false"),
    cache: str = Form("true"),
) -> JobResponse:
    """Submit a streaming profile to the background worker. Returns immediately
    with a jobId; poll `GET /jobs/{jobId}` for progress and the result."""
    contents = await file.read()
    rec = _job_manager.submit(
        "profile",
        lambda report: _run_profile_sync(
            contents,
            file.filename or "uploaded.csv",
            chunk_size,
            nbins,
            top_frequency,
            correlations,
            verify,
            cache,
            report,
        ),
    )
    return JobResponse(**rec.to_dict(include_result=False))


@app.post("/jobs/analyse")
async def create_analyse_job(
    file: UploadFile = File(...),
    analyses: str = Form(...),
    strategies: str = Form(None),
    codebook: str = Form(None),
    preprocessing: str = Form(None),
    feature_engineering: str = Form(None),
    model_training: str = Form(None),
) -> JobResponse:
    """Submit a full analysis to the background worker. Returns immediately
    with a jobId; poll `GET /jobs/{jobId}` for progress and the result."""
    contents = await file.read()
    rec = _job_manager.submit(
        "analyse",
        lambda report: _run_analyse_sync(
            contents,
            file.filename or "uploaded.csv",
            analyses,
            strategies,
            codebook,
            preprocessing,
            feature_engineering,
            model_training,
            report,
        ),
    )
    return JobResponse(**rec.to_dict(include_result=False))


@app.get("/jobs")
async def list_jobs() -> list[JobResponse]:
    """List recent jobs (status/progress only, newest last)."""
    return [JobResponse(**d) for d in _job_manager.list_jobs()]


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> JobResponse:
    """Poll a job. `result` is present only once the job has succeeded."""
    data = _job_manager.get(job_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse(**data)

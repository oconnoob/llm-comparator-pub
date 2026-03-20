"""Analyze router — scoring/ranking pipeline."""

import asyncio
import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models.database import get_session, get_session_factory
from app.models.schemas import (
    AnalysisJobCreatedResponse,
    AnalyzeFromRunsRequest,
)
from app.repositories.analysis_repository import AnalysisRepository
from app.repositories.run_repository import RunRepository
from app.services.jsonl import detect_form, parse_jsonl
from app.services.llm_client import LLMClient, ModelConfig
from app.services.scoring import build_scoring_prompt, parse_scoring_response

router = APIRouter()

# In-process cache: job_id → list of enriched records.
# Each record has _run_id, _needs_generation, _needs_scoring embedded.
_MAX_CACHE = 50
_job_cache: dict[str, list[dict]] = {}

# Temporary store: job_id → user-supplied API key (demo mode only).
_pending_api_keys: dict[str, str] = {}


def _evict_oldest() -> None:
    if len(_job_cache) >= _MAX_CACHE:
        oldest_key = next(iter(_job_cache))
        del _job_cache[oldest_key]


@router.post("/jobs", response_model=AnalysisJobCreatedResponse, status_code=202)
async def create_analysis_job(
    file: UploadFile,
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AnalysisJobCreatedResponse:
    """Import a JSONL dataset: creates Run+ModelResponse records, then scores via SSE stream."""
    content = await file.read()
    try:
        records = parse_jsonl(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid JSONL: {exc}") from exc

    if not records:
        raise HTTPException(status_code=422, detail="Empty JSONL file")

    form = detect_form(records[0])

    sid = request.headers.get("X-Session-ID", "").strip() or None
    if not settings.demo_mode:
        sid = None

    # Create Run (and ModelResponse) records upfront for all entries.
    run_repo = RunRepository(session)
    enriched: list[dict] = []

    for record in records:
        rec_form = detect_form(record)
        responses = record.get("responses", {})
        metrics = record.get("metrics", {})
        pre_scores = record.get("scores") if rec_form == 3 else None
        pre_rankings = record.get("rankings") if rec_form == 3 else None

        run = await run_repo.import_run(
            prompt=record["prompt"],
            scores=pre_scores,
            rankings=pre_rankings,
            session_id=sid,
        )

        # Persist responses for Form 2/3 records immediately.
        if rec_form >= 2:
            for model_name, resp_text in responses.items():
                m = metrics.get(model_name, {}) if isinstance(metrics, dict) else {}
                m = m if isinstance(m, dict) else {}
                await run_repo.save_response(
                    run_id=run.id,
                    model_name=model_name,
                    response_text=resp_text,
                    token_count=m.get("token_count", 0),
                    ttft_ms=m.get("ttft_ms"),
                    total_ms=m.get("total_ms"),
                    tokens_per_sec=m.get("tokens_per_sec"),
                )

        enriched.append(
            {
                "prompt": record["prompt"],
                "responses": responses,
                "metrics": metrics,
                "_run_id": run.id,
                "_needs_generation": rec_form == 1,
                "_needs_scoring": rec_form < 3,
            }
        )

    analysis_repo = AnalysisRepository(session)
    job = await analysis_repo.create_job(detected_form=form)
    _evict_oldest()
    _job_cache[job.id] = enriched
    if settings.demo_mode:
        user_key = request.headers.get("X-API-Key", "").strip()
        if user_key:
            _pending_api_keys[job.id] = user_key
    await analysis_repo.commit()

    return AnalysisJobCreatedResponse(job_id=job.id, detected_form=form)


@router.post("/jobs/from-runs", response_model=AnalysisJobCreatedResponse, status_code=202)
async def create_analysis_job_from_runs(
    body: AnalyzeFromRunsRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AnalysisJobCreatedResponse:
    """Score existing runs from the DB without a file upload."""
    sid = request.headers.get("X-Session-ID", "").strip() or None
    if not settings.demo_mode:
        sid = None

    run_repo = RunRepository(session)
    runs = (
        await run_repo.get_runs_by_ids(body.run_ids, session_id=sid)
        if body.run_ids
        else await run_repo.get_all_runs(session_id=sid)
    )

    if not runs:
        raise HTTPException(status_code=422, detail="No runs found")

    records = [
        {
            "prompt": run.prompt,
            "responses": {r.model_name: r.response_text for r in run.responses},
            "metrics": {
                r.model_name: {
                    "ttft_ms": r.ttft_ms,
                    "total_ms": r.total_ms,
                    "tokens_per_sec": r.tokens_per_sec,
                    "token_count": r.token_count,
                }
                for r in run.responses
            },
            "_run_id": run.id,
            "_needs_generation": not run.responses,
            "_needs_scoring": not run.scores,
        }
        for run in runs
    ]

    detected_form = 1 if any(r["_needs_generation"] for r in records) else 2
    analysis_repo = AnalysisRepository(session)
    job = await analysis_repo.create_job(detected_form=detected_form)
    _evict_oldest()
    _job_cache[job.id] = records
    if settings.demo_mode:
        user_key = request.headers.get("X-API-Key", "").strip()
        if user_key:
            _pending_api_keys[job.id] = user_key
    await analysis_repo.commit()

    return AnalysisJobCreatedResponse(job_id=job.id, detected_form=detected_form)


@router.get("/jobs/{job_id}/stream")
async def stream_analysis_job(
    job_id: str,
    settings: Settings = Depends(get_settings),
):
    """SSE stream: runs the analysis pipeline and writes scores back to Run rows."""
    factory = get_session_factory()

    async with factory() as session:
        repo = AnalysisRepository(session)
        job = await repo.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

    records = _job_cache.get(job_id)
    if records is None:
        raise HTTPException(status_code=410, detail="Job data expired. Please retry.")

    user_key = _pending_api_keys.pop(job_id, None)

    def _key(configured: str) -> str:
        return user_key if user_key else configured

    model_configs = [
        ModelConfig(
            settings.model_1_endpoint,
            settings.model_1_model_id or settings.model_1_name,
            _key(settings.model_1_api_key),
            display_name=settings.model_1_name,
        ),
        ModelConfig(
            settings.model_2_endpoint,
            settings.model_2_model_id or settings.model_2_name,
            _key(settings.model_2_api_key),
            display_name=settings.model_2_name,
        ),
        ModelConfig(
            settings.model_3_endpoint,
            settings.model_3_model_id or settings.model_3_name,
            _key(settings.model_3_api_key),
            display_name=settings.model_3_name,
        ),
    ]
    pref_config = ModelConfig(
        settings.preference_model_endpoint,
        settings.preference_model_model_id or settings.preference_model_name,
        _key(settings.preference_model_api_key),
        display_name=settings.preference_model_name,
    )

    async def event_generator():
        async with factory() as session:
            repo = AnalysisRepository(session)
            await repo.update_job_status(job_id, "running")
            await repo.commit()

        def _sse(payload: dict) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        def _progress(step: str, completed: int, tot: int) -> str:
            return _sse({"type": "progress", "step": step, "completed": completed, "total": tot})

        yield _sse({"type": "status", "message": "Starting analysis pipeline..."})

        total = len(records)

        for i, record in enumerate(records):
            run_id: str = record["_run_id"]
            prompt: str = record["prompt"]
            needs_generation: bool = record.get("_needs_generation", False)
            needs_scoring: bool = record.get("_needs_scoring", True)

            # ── Step 1: Generate responses (Form 1 only) ─────────────────────
            if needs_generation:
                yield _progress("generation", i + 1, total)

                async def _call_one(cfg: ModelConfig) -> tuple[str, str, dict]:
                    """Collect all tokens from one model; returns (name, text, metrics).

                    Retries up to 3 times with exponential backoff on transient errors.
                    """
                    last_exc: Exception = RuntimeError("unknown")
                    for attempt in range(3):
                        if attempt:
                            await asyncio.sleep(2**attempt)  # 2s, 4s
                        client = LLMClient(cfg)
                        start = time.perf_counter()
                        ttft_ms: float | None = None
                        try:
                            tokens: list[str] = []
                            first = True
                            async for chunk in client.stream(prompt):
                                if first:
                                    ttft_ms = (time.perf_counter() - start) * 1000
                                    first = False
                                tokens.append(chunk.token)
                            total_ms = (time.perf_counter() - start) * 1000
                            token_count = len(tokens)
                            gen_ms = total_ms - (ttft_ms or 0)
                            tps = token_count / (gen_ms / 1000) if gen_ms > 0 else 0.0
                            return (
                                cfg.display_name,
                                "".join(tokens),
                                {
                                    "ttft_ms": ttft_ms,
                                    "total_ms": total_ms,
                                    "tokens_per_sec": tps,
                                    "token_count": token_count,
                                },
                            )
                        except Exception as exc:
                            last_exc = exc
                        finally:
                            await client.aclose()
                    return cfg.display_name, f"[Error: {last_exc}]", {}

                results = await asyncio.gather(*[_call_one(cfg) for cfg in model_configs])
                responses: dict[str, str] = {name: text for name, text, _ in results}
                metrics: dict = {name: m for name, _, m in results}

                async with factory() as save_session:
                    run_repo = RunRepository(save_session)
                    for model_name, resp_text in responses.items():
                        m = metrics.get(model_name, {})
                        await run_repo.save_response(
                            run_id=run_id,
                            model_name=model_name,
                            response_text=resp_text,
                            token_count=m.get("token_count", 0),
                            ttft_ms=m.get("ttft_ms"),
                            total_ms=m.get("total_ms"),
                            tokens_per_sec=m.get("tokens_per_sec"),
                        )
                    await run_repo.commit()
            else:
                responses = record.get("responses", {})

            # ── Step 2: Score (Form 1 and 2) ─────────────────────────────────
            if needs_scoring:
                yield _progress("scoring", i + 1, total)

                scorable = {k: v for k, v in responses.items() if not v.startswith("[Error:")}
                if scorable and len(scorable) == len(responses):
                    pref_client = LLMClient(pref_config)
                    try:
                        model_names = list(responses.keys())
                        scoring_prompt = build_scoring_prompt(prompt, responses)
                        raw = await pref_client.complete(scoring_prompt)
                        scores, rankings = parse_scoring_response(raw, model_names)
                        async with factory() as save_session:
                            run_repo = RunRepository(save_session)
                            await run_repo.update_scores(run_id, scores, rankings)
                            await run_repo.commit()
                    except Exception as exc:
                        msg = f"Scoring failed for prompt {i + 1}: {exc}"
                        yield _sse({"type": "error", "message": msg})
                    finally:
                        await pref_client.aclose()
                else:
                    msg = f"Skipping scoring for prompt {i + 1}: one or more models errored."
                    yield _sse({"type": "error", "message": msg})
            else:
                # Form 3: already imported with scores — just report progress
                yield _progress("imported", i + 1, total)

        async with factory() as session:
            repo = AnalysisRepository(session)
            await repo.update_job_status(job_id, "completed", completed=True)
            await repo.commit()

        _job_cache.pop(job_id, None)
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )

"""Runs router — prompt generation and history."""

import asyncio
import json
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models.database import get_session, get_session_factory
from app.models.schemas import (
    MetricsSummary,
    ModelResponseDetail,
    ModelResponsePreview,
    PaginatedRuns,
    RunCreatedResponse,
    RunDetail,
    RunListItem,
    RunRequest,
)
from app.repositories.run_repository import RunRepository
from app.services.llm_client import LLMClient, ModelConfig

router = APIRouter()

# Temporary store: run_id → user-supplied API key.
# Held only for the seconds between run creation and stream start, then cleared.
_pending_api_keys: dict[str, str] = {}

_PREVIEW_LEN = 100


def _preview(text: str) -> str:
    return text[:_PREVIEW_LEN] + "..." if len(text) > _PREVIEW_LEN else text


def _make_clients(
    settings: Settings,
    api_key_override: str | None = None,
) -> list[tuple[str, LLMClient]]:
    """Return (display_name, client) pairs for the three primary models.

    If *api_key_override* is provided (demo mode), it replaces the configured
    API keys for all three clients.
    """

    def key(configured: str) -> str:
        return api_key_override if api_key_override else configured

    configs = [
        ModelConfig(
            settings.model_1_endpoint,
            settings.model_1_model_id or settings.model_1_name,
            key(settings.model_1_api_key),
            display_name=settings.model_1_name,
        ),
        ModelConfig(
            settings.model_2_endpoint,
            settings.model_2_model_id or settings.model_2_name,
            key(settings.model_2_api_key),
            display_name=settings.model_2_name,
        ),
        ModelConfig(
            settings.model_3_endpoint,
            settings.model_3_model_id or settings.model_3_name,
            key(settings.model_3_api_key),
            display_name=settings.model_3_name,
        ),
    ]
    return [(c.display_name, LLMClient(c)) for c in configs]


def _session_id(request: Request, settings: Settings) -> str | None:
    """Return the caller's session ID when demo_mode is enabled, else None."""
    if not settings.demo_mode:
        return None
    return request.headers.get("X-Session-ID", "").strip() or None


@router.post("", response_model=RunCreatedResponse, status_code=201)
async def create_run(
    body: RunRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> RunCreatedResponse:
    repo = RunRepository(session)
    run = await repo.create_run(
        body.prompt,
        body.temperature,
        body.max_tokens,
        session_id=_session_id(request, settings),
    )
    await repo.commit()
    if settings.demo_mode:
        user_key = request.headers.get("X-API-Key", "").strip()
        if user_key:
            _pending_api_keys[run.id] = user_key
    return RunCreatedResponse(run_id=run.id)


@router.get("/{run_id}/stream")
async def stream_run(
    run_id: str,
    settings: Settings = Depends(get_settings),
):
    """SSE stream: generates responses for all three models in parallel."""
    # Validate run exists before starting the stream
    factory = get_session_factory()
    async with factory() as session:
        repo = RunRepository(session)
        run = await repo.get_run(run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        prompt = run.prompt
        temperature = run.temperature
        max_tokens = run.max_tokens

    async def event_generator():
        user_key = _pending_api_keys.pop(run_id, None)
        clients = _make_clients(settings, api_key_override=user_key)
        shared_q: asyncio.Queue[str | None] = asyncio.Queue()

        # Collect completed model results; only written once per model after streaming ends.
        completed: dict[str, dict] = {}

        async def stream_one(display_name: str, client: LLMClient) -> None:
            tokens: list[str] = []
            ttft_ms: float | None = None
            start = time.perf_counter()
            try:
                async for chunk in client.stream(prompt, temperature, max_tokens):
                    if chunk.is_first:
                        ttft_ms = (time.perf_counter() - start) * 1000
                    tokens.append(chunk.token)
                    await shared_q.put(
                        json.dumps({"type": "token", "model": display_name, "token": chunk.token})
                    )
            except Exception as exc:
                await shared_q.put(
                    json.dumps({"type": "error", "model": display_name, "message": str(exc)})
                )
            else:
                total_ms = (time.perf_counter() - start) * 1000
                token_count = len(tokens)
                gen_ms = total_ms - (ttft_ms or 0)
                tps = token_count / (gen_ms / 1000) if gen_ms > 0 else 0.0
                completed[display_name] = {
                    "text": "".join(tokens),
                    "token_count": token_count,
                    "ttft_ms": ttft_ms,
                    "total_ms": total_ms,
                    "tokens_per_sec": tps,
                }
                await shared_q.put(
                    json.dumps(
                        {
                            "type": "done",
                            "model": display_name,
                            "metrics": {
                                "ttft_ms": ttft_ms,
                                "total_ms": total_ms,
                                "tokens_per_sec": tps,
                                "token_count": token_count,
                            },
                        }
                    )
                )
            finally:
                await client.aclose()
                await shared_q.put(None)  # sentinel

        tasks = [asyncio.create_task(stream_one(name, client)) for name, client in clients]

        done = 0
        n = len(clients)
        while done < n:
            item = await shared_q.get()
            if item is None:
                done += 1
            else:
                yield f"data: {item}\n\n"

        await asyncio.gather(*tasks, return_exceptions=True)

        # Batch-save all successful responses in a single fresh session.
        # Using a fresh session here avoids concurrent access issues during streaming.
        if completed:
            async with factory() as save_session:
                save_repo = RunRepository(save_session)
                for model_name, result in completed.items():
                    await save_repo.save_response(
                        run_id=run_id,
                        model_name=model_name,
                        response_text=result["text"],
                        token_count=result["token_count"],
                        ttft_ms=result["ttft_ms"],
                        total_ms=result["total_ms"],
                        tokens_per_sec=result["tokens_per_sec"],
                    )
                await save_repo.commit()

        yield "data: " + json.dumps({"type": "stream_end"}) + "\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.get("", response_model=PaginatedRuns)
async def list_runs(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> PaginatedRuns:
    repo = RunRepository(session)
    total, runs = await repo.list_runs(page, page_size, session_id=_session_id(request, settings))

    items = []
    for run in runs:
        resp_map = {r.model_name: r for r in run.responses}
        items.append(
            RunListItem(
                run_id=run.id,
                created_at=run.created_at,
                prompt_preview=_preview(run.prompt),
                responses={
                    name: ModelResponsePreview(
                        preview=_preview(r.response_text),
                        metrics=MetricsSummary(
                            ttft_ms=r.ttft_ms,
                            total_ms=r.total_ms,
                            tokens_per_sec=r.tokens_per_sec,
                            token_count=r.token_count,
                        ),
                    )
                    for name, r in resp_map.items()
                },
                scores=run.scores,
                rankings=run.rankings,
            )
        )
    return PaginatedRuns(total=total, page=page, page_size=page_size, items=items)


@router.get("/export")
async def export_runs(
    request: Request,
    ids: str | None = Query(None, description="Comma-separated run IDs; omit for all"),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    repo = RunRepository(session)
    sid = _session_id(request, settings)
    if ids:
        runs = await repo.get_runs_by_ids([i.strip() for i in ids.split(",")], session_id=sid)
    else:
        runs = await repo.get_all_runs(session_id=sid)

    def generate():
        for run in runs:
            resp_map = {r.model_name: r for r in run.responses}
            record: dict = {
                "prompt": run.prompt,
                "responses": {name: r.response_text for name, r in resp_map.items()},
                "metrics": {
                    name: {
                        "ttft_ms": r.ttft_ms,
                        "total_ms": r.total_ms,
                        "tokens_per_sec": r.tokens_per_sec,
                        "token_count": r.token_count,
                    }
                    for name, r in resp_map.items()
                },
            }
            if run.scores is not None:
                record["scores"] = run.scores
            if run.rankings is not None:
                record["rankings"] = run.rankings
            yield json.dumps(record) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": "attachment; filename=runs.jsonl"},
    )


@router.post("/session/{session_id}/clear", status_code=204)
async def clear_session(
    session_id: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> None:
    """Delete all runs for a demo session. Called via navigator.sendBeacon on tab close."""
    if not settings.demo_mode:
        return
    repo = RunRepository(session)
    await repo.delete_session_runs(session_id)
    await repo.commit()


@router.delete("", status_code=204)
async def bulk_delete_runs(
    request: Request,
    ids: str | None = Query(None, description="Comma-separated run IDs; omit to delete all"),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> None:
    """Delete specific runs by ID, or all runs when no ids are provided."""
    repo = RunRepository(session)
    sid = _session_id(request, settings)
    if ids:
        await repo.delete_runs_by_ids([i.strip() for i in ids.split(",")], session_id=sid)
    else:
        await repo.delete_all_runs(session_id=sid)
    await repo.commit()


@router.delete("/{run_id}", status_code=204)
async def delete_run(
    run_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    repo = RunRepository(session)
    run = await repo.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    await repo.delete_run(run_id)
    await repo.commit()


@router.get("/{run_id}", response_model=RunDetail)
async def get_run(
    run_id: str,
    session: AsyncSession = Depends(get_session),
) -> RunDetail:
    repo = RunRepository(session)
    run = await repo.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    resp_map = {r.model_name: r for r in run.responses}
    return RunDetail(
        run_id=run.id,
        prompt=run.prompt,
        temperature=run.temperature,
        max_tokens=run.max_tokens,
        created_at=run.created_at,
        responses={
            name: ModelResponseDetail(
                text=r.response_text,
                metrics=MetricsSummary(
                    ttft_ms=r.ttft_ms,
                    total_ms=r.total_ms,
                    tokens_per_sec=r.tokens_per_sec,
                    token_count=r.token_count,
                ),
            )
            for name, r in resp_map.items()
        },
        scores=run.scores,
        rankings=run.rankings,
    )

import json

import pytest
from httpx import AsyncClient


def _jsonl(*records: dict) -> bytes:
    return b"".join(json.dumps(r).encode() + b"\n" for r in records)


async def _seed_run(db_session, prompt: str = "Test prompt") -> str:
    """Insert a run with two model responses; returns the run_id."""
    from app.repositories.run_repository import RunRepository

    repo = RunRepository(db_session)
    run = await repo.create_run(prompt, 0.6, 512)
    await repo.save_response(run.id, "Model A", "Answer A", 10, 100.0, 500.0, 20.0)
    await repo.save_response(run.id, "Model B", "Answer B", 8, 120.0, 600.0, 13.0)
    await repo.commit()
    return run.id


# ── JSONL import creates Run records ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_import_form1_creates_job(client: AsyncClient):
    content = _jsonl({"prompt": "What is 2+2?"})
    resp = await client.post(
        "/analyze/jobs",
        files={"file": ("test.jsonl", content, "application/x-ndjson")},
    )
    assert resp.status_code == 202
    data = resp.json()
    assert "job_id" in data
    assert data["detected_form"] == 1


@pytest.mark.asyncio
async def test_import_form2_creates_run_with_responses(client: AsyncClient):
    content = _jsonl({"prompt": "Hi", "responses": {"Model A": "Hello", "Model B": "Hey"}})
    resp = await client.post(
        "/analyze/jobs",
        files={"file": ("test.jsonl", content, "application/x-ndjson")},
    )
    assert resp.status_code == 202
    assert resp.json()["detected_form"] == 2

    # Verify a Run was created in the DB
    runs_resp = await client.get("/runs")
    assert runs_resp.json()["total"] == 1


@pytest.mark.asyncio
async def test_import_form3_sets_scores_immediately(client: AsyncClient):
    content = _jsonl(
        {
            "prompt": "Hi",
            "responses": {"m1": "A", "m2": "B"},
            "scores": {"m1": 4.0, "m2": 3.0},
            "rankings": {"m1": 1, "m2": 2},
        }
    )
    resp = await client.post(
        "/analyze/jobs",
        files={"file": ("test.jsonl", content, "application/x-ndjson")},
    )
    assert resp.status_code == 202

    # Run should exist with scores already set
    runs_resp = await client.get("/runs")
    items = runs_resp.json()["items"]
    assert len(items) == 1
    assert items[0]["scores"] == {"m1": 4.0, "m2": 3.0}
    assert items[0]["rankings"] == {"m1": 1, "m2": 2}


@pytest.mark.asyncio
async def test_import_invalid_jsonl(client: AsyncClient):
    resp = await client.post(
        "/analyze/jobs",
        files={"file": ("bad.jsonl", b"not json\n", "application/x-ndjson")},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_import_empty_file(client: AsyncClient):
    resp = await client.post(
        "/analyze/jobs",
        files={"file": ("empty.jsonl", b"", "application/x-ndjson")},
    )
    assert resp.status_code == 422


# ── from-runs endpoint ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_job_from_runs_all(client: AsyncClient, db_session):
    await _seed_run(db_session)
    resp = await client.post("/analyze/jobs/from-runs", json={})
    assert resp.status_code == 202
    data = resp.json()
    assert "job_id" in data
    assert data["detected_form"] == 2


@pytest.mark.asyncio
async def test_create_job_from_runs_specific_ids(client: AsyncClient, db_session):
    run_id = await _seed_run(db_session)
    resp = await client.post("/analyze/jobs/from-runs", json={"run_ids": [run_id]})
    assert resp.status_code == 202
    assert resp.json()["detected_form"] == 2


@pytest.mark.asyncio
async def test_create_job_from_runs_no_runs(client: AsyncClient):
    resp = await client.post("/analyze/jobs/from-runs", json={})
    assert resp.status_code == 422


# ── update_scores is reflected in runs list ───────────────────────────────────


@pytest.mark.asyncio
async def test_update_scores_visible_in_list(client: AsyncClient, db_session):
    from app.repositories.run_repository import RunRepository

    run_id = await _seed_run(db_session)

    repo = RunRepository(db_session)
    await repo.update_scores(run_id, {"Model A": 4.5, "Model B": 3.0}, {"Model A": 1, "Model B": 2})
    await repo.commit()

    resp = await client.get("/runs")
    items = resp.json()["items"]
    assert items[0]["scores"] == {"Model A": 4.5, "Model B": 3.0}
    assert items[0]["rankings"] == {"Model A": 1, "Model B": 2}

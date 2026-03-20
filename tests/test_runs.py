import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_run(client: AsyncClient):
    response = await client.post(
        "/runs",
        json={"prompt": "Hello world", "temperature": 0.7, "max_tokens": 100},
    )
    assert response.status_code == 201
    data = response.json()
    assert "run_id" in data
    assert isinstance(data["run_id"], str)


@pytest.mark.asyncio
async def test_list_runs_empty(client: AsyncClient):
    response = await client.get("/runs")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 0
    assert data["items"] == []


@pytest.mark.asyncio
async def test_get_run_not_found(client: AsyncClient):
    response = await client.get("/runs/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_and_retrieve_run(client: AsyncClient):
    create_resp = await client.post(
        "/runs",
        json={"prompt": "Test prompt", "temperature": 0.5, "max_tokens": 50},
    )
    run_id = create_resp.json()["run_id"]

    get_resp = await client.get(f"/runs/{run_id}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["run_id"] == run_id
    assert data["prompt"] == "Test prompt"
    assert data["temperature"] == 0.5
    assert data["max_tokens"] == 50

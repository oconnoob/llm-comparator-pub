import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.models.database import create_all_tables, get_session_factory
from app.repositories.run_repository import RunRepository
from app.routers import analyze, health, runs

logger = logging.getLogger(__name__)

_STATIC_DIR = Path(__file__).parent.parent / "frontend" / "dist"


async def _demo_cleanup_loop(ttl_hours: int) -> None:
    """Background task: delete demo runs older than ttl_hours, every hour."""
    while True:
        await asyncio.sleep(3600)
        cutoff = datetime.now(UTC) - timedelta(hours=ttl_hours)
        try:
            factory = get_session_factory()
            async with factory() as session:
                repo = RunRepository(session)
                n = await repo.delete_old_demo_runs(cutoff)
                await repo.commit()
            if n:
                logger.info("Demo cleanup: deleted %d expired run(s) (TTL %dh)", n, ttl_hours)
        except Exception:
            logger.exception("Demo cleanup task failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_all_tables()
    settings = get_settings()
    task = None
    if settings.demo_mode:
        task = asyncio.create_task(_demo_cleanup_loop(settings.demo_session_ttl_hours))
        logger.info("Demo mode enabled — runs expire after %dh", settings.demo_session_ttl_hours)
    yield
    if task:
        task.cancel()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="LLM Comparator",
        description="Compare and analyze LLM outputs side-by-side",
        version="0.1.0",
        lifespan=lifespan,
    )

    cors_origins = settings.get_cors_origins()
    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(health.router)
    app.include_router(runs.router, prefix="/runs", tags=["runs"])
    app.include_router(analyze.router, prefix="/analyze", tags=["analyze"])

    # Serve the built frontend in production (frontend/dist must exist).
    # In dev, Vite's dev server handles the frontend via its proxy config.
    if _STATIC_DIR.is_dir():
        app.mount("/assets", StaticFiles(directory=_STATIC_DIR / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str) -> FileResponse:
            return FileResponse(_STATIC_DIR / "index.html")

    return app


app = create_app()

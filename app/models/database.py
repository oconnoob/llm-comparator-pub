from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models.orm import Base

_engine = None
_session_factory = None


def _get_engine():
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(settings.database_url, echo=False)
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(_get_engine(), expire_on_commit=False)
    return _session_factory


async def create_all_tables() -> None:
    async with _get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migrate existing DBs: add scores/rankings columns to runs if missing
        for col in ["scores JSON", "rankings JSON", "session_id TEXT"]:
            try:
                await conn.execute(text(f"ALTER TABLE runs ADD COLUMN {col}"))
            except Exception:
                pass  # column already exists


async def get_session() -> AsyncSession:
    """FastAPI dependency that yields a DB session."""
    factory = get_session_factory()
    async with factory() as session:
        yield session

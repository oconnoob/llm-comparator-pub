from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.orm import ModelResponse, Run

_PREVIEW_LEN = 100


def _preview(text: str) -> str:
    return text[:_PREVIEW_LEN] + "..." if len(text) > _PREVIEW_LEN else text


class RunRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_run(
        self,
        prompt: str,
        temperature: float,
        max_tokens: int,
        session_id: str | None = None,
    ) -> Run:
        run = Run(
            prompt=prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            session_id=session_id,
        )
        self._session.add(run)
        await self._session.flush()
        return run

    async def import_run(
        self,
        prompt: str,
        temperature: float = 0.6,
        max_tokens: int = 512,
        scores: dict | None = None,
        rankings: dict | None = None,
        session_id: str | None = None,
    ) -> Run:
        """Create a Run from imported data (JSONL), with optional pre-set scores."""
        run = Run(
            prompt=prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            scores=scores,
            rankings=rankings,
            session_id=session_id,
        )
        self._session.add(run)
        await self._session.flush()
        return run

    async def save_response(
        self,
        run_id: str,
        model_name: str,
        response_text: str,
        token_count: int,
        ttft_ms: float | None,
        total_ms: float | None,
        tokens_per_sec: float | None,
    ) -> ModelResponse:
        resp = ModelResponse(
            run_id=run_id,
            model_name=model_name,
            response_text=response_text,
            token_count=token_count,
            ttft_ms=ttft_ms,
            total_ms=total_ms,
            tokens_per_sec=tokens_per_sec,
        )
        self._session.add(resp)
        await self._session.flush()
        return resp

    async def update_scores(self, run_id: str, scores: dict, rankings: dict) -> None:
        run = await self._session.get(Run, run_id)
        if run:
            run.scores = scores
            run.rankings = rankings
            await self._session.flush()

    async def delete_run(self, run_id: str) -> None:
        run = await self._session.get(Run, run_id)
        if run:
            await self._session.delete(run)
            await self._session.flush()

    async def get_run(self, run_id: str) -> Run | None:
        stmt = select(Run).where(Run.id == run_id).options(selectinload(Run.responses))
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_runs(
        self,
        page: int,
        page_size: int,
        session_id: str | None = None,
    ) -> tuple[int, list[Run]]:
        base = select(Run)
        if session_id is not None:
            base = base.where(Run.session_id == session_id)

        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self._session.execute(count_stmt)).scalar_one()

        stmt = (
            base.options(selectinload(Run.responses))
            .order_by(Run.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        runs = (await self._session.execute(stmt)).scalars().all()
        return total, list(runs)

    async def get_runs_by_ids(
        self,
        ids: list[str],
        session_id: str | None = None,
    ) -> list[Run]:
        stmt = select(Run).where(Run.id.in_(ids)).options(selectinload(Run.responses))
        if session_id is not None:
            stmt = stmt.where(Run.session_id == session_id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def get_all_runs(self, session_id: str | None = None) -> list[Run]:
        stmt = select(Run).options(selectinload(Run.responses)).order_by(Run.created_at.desc())
        if session_id is not None:
            stmt = stmt.where(Run.session_id == session_id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def delete_runs_by_ids(self, ids: list[str], session_id: str | None = None) -> int:
        """Delete specific runs by ID. Returns number deleted."""
        stmt = delete(Run).where(Run.id.in_(ids))
        if session_id is not None:
            stmt = stmt.where(Run.session_id == session_id)
        result = await self._session.execute(stmt)
        await self._session.flush()
        return result.rowcount  # type: ignore[return-value]

    async def delete_all_runs(self, session_id: str | None = None) -> int:
        """Delete all runs (optionally scoped to a session). Returns number deleted."""
        stmt = delete(Run)
        if session_id is not None:
            stmt = stmt.where(Run.session_id == session_id)
        result = await self._session.execute(stmt)
        await self._session.flush()
        return result.rowcount  # type: ignore[return-value]

    async def delete_session_runs(self, session_id: str) -> None:
        """Delete all runs belonging to a demo session (on tab close)."""
        stmt = delete(Run).where(Run.session_id == session_id)
        await self._session.execute(stmt)
        await self._session.flush()

    async def delete_old_demo_runs(self, cutoff: datetime) -> int:
        """Delete demo runs older than *cutoff*. Returns number of rows deleted."""
        stmt = delete(Run).where(Run.session_id.is_not(None)).where(Run.created_at < cutoff)
        result = await self._session.execute(stmt)
        await self._session.flush()
        return result.rowcount  # type: ignore[return-value]

    async def commit(self) -> None:
        await self._session.commit()

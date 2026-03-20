from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orm import AnalysisJob


class AnalysisRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_job(self, detected_form: int) -> AnalysisJob:
        job = AnalysisJob(detected_form=detected_form)
        self._session.add(job)
        await self._session.flush()
        return job

    async def update_job_status(self, job_id: str, status: str, completed: bool = False) -> None:
        job = await self._session.get(AnalysisJob, job_id)
        if job:
            job.status = status
            if completed:
                job.completed_at = datetime.now(UTC)
            await self._session.flush()

    async def get_job(self, job_id: str) -> AnalysisJob | None:
        return await self._session.get(AnalysisJob, job_id)

    async def commit(self) -> None:
        await self._session.commit()

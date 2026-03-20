import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _new_id() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    prompt: Mapped[str] = mapped_column(Text)
    temperature: Mapped[float] = mapped_column(Float, default=0.6)
    max_tokens: Mapped[int] = mapped_column(Integer, default=512)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    scores: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    rankings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Opaque session token set in demo mode for per-user isolation.
    # Null on runs created in normal (non-demo) mode.
    session_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    responses: Mapped[list["ModelResponse"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )


class ModelResponse(Base):
    __tablename__ = "model_responses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"))
    model_name: Mapped[str] = mapped_column(String)
    response_text: Mapped[str] = mapped_column(Text, default="")
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    ttft_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    tokens_per_sec: Mapped[float | None] = mapped_column(Float, nullable=True)

    run: Mapped["Run"] = relationship(back_populates="responses")


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    # pending | running | completed | failed
    status: Mapped[str] = mapped_column(String, default="pending")
    detected_form: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

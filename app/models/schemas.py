"""Pydantic schemas for request/response bodies."""

from datetime import datetime

from pydantic import BaseModel, Field

# ----- Runs -----


class RunRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    temperature: float = Field(0.6, ge=0.0, le=2.0)
    max_tokens: int = Field(512, ge=1, le=32768)


class RunCreatedResponse(BaseModel):
    run_id: str


class MetricsSummary(BaseModel):
    ttft_ms: float | None
    total_ms: float | None
    tokens_per_sec: float | None
    token_count: int


class ModelResponsePreview(BaseModel):
    preview: str
    metrics: MetricsSummary


class RunListItem(BaseModel):
    run_id: str
    created_at: datetime
    prompt_preview: str
    responses: dict[str, ModelResponsePreview]
    scores: dict[str, float] | None = None
    rankings: dict[str, int] | None = None


class PaginatedRuns(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[RunListItem]


class ModelResponseDetail(BaseModel):
    text: str
    metrics: MetricsSummary


class RunDetail(BaseModel):
    run_id: str
    prompt: str
    temperature: float
    max_tokens: int
    created_at: datetime
    responses: dict[str, ModelResponseDetail]
    scores: dict[str, float] | None = None
    rankings: dict[str, int] | None = None


# ----- Analyze -----


class AnalysisJobCreatedResponse(BaseModel):
    job_id: str
    detected_form: int


class AnalyzeFromRunsRequest(BaseModel):
    run_ids: list[str] | None = None  # None = analyze all runs


# ----- Error -----


class ErrorResponse(BaseModel):
    error: str
    detail: str = ""

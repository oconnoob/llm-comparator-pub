from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.config import Settings, get_settings

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    version: str


class ModelInfo(BaseModel):
    name: str


class ConfigResponse(BaseModel):
    models: list[ModelInfo]
    demo_mode: bool = False


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version="0.1.0")


@router.get("/config", response_model=ConfigResponse)
async def get_config(settings: Settings = Depends(get_settings)) -> ConfigResponse:
    return ConfigResponse(
        models=[
            ModelInfo(name=settings.model_1_name),
            ModelInfo(name=settings.model_2_name),
            ModelInfo(name=settings.model_3_name),
        ],
        demo_mode=settings.demo_mode,
    )

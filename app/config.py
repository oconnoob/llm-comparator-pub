from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Primary models
    model_1_endpoint: str = "http://localhost:11434"
    model_1_name: str = "Model 1"
    model_1_api_key: str = ""
    model_1_model_id: str = ""

    model_2_endpoint: str = "http://localhost:11434"
    model_2_name: str = "Model 2"
    model_2_api_key: str = ""
    model_2_model_id: str = ""

    model_3_endpoint: str = "http://localhost:11434"
    model_3_name: str = "Model 3"
    model_3_api_key: str = ""
    model_3_model_id: str = ""

    # Preference / reward model
    preference_model_endpoint: str = "http://localhost:11434"
    preference_model_name: str = "Preference Model"
    preference_model_api_key: str = ""
    preference_model_model_id: str = ""

    # App
    database_url: str = "sqlite+aiosqlite:///./llm_comparator.db"
    # Set to true to allow users to supply their own API key via X-API-Key header.
    # The key is held in memory only for the seconds between job creation and
    # streaming, and is never written to the database or logs.
    demo_mode: bool = False
    # How long (hours) to keep demo runs before the background cleanup task
    # deletes them. Only applies when demo_mode=True.
    demo_session_ttl_hours: int = 24
    # Comma-separated origins for the CORS middleware (needed for local dev when
    # the Vite dev server runs on a separate port). Leave unset in production —
    # the built frontend is served from the same origin as the API.
    cors_origins: str = ""

    def get_cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

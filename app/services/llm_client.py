"""Async OpenAI-compatible LLM client (streaming + non-streaming)."""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx


@dataclass
class TokenChunk:
    token: str
    is_first: bool = False


@dataclass
class ModelConfig:
    endpoint: str
    model_name: str
    api_key: str = ""
    display_name: str = ""

    def __post_init__(self):
        self.endpoint = self.endpoint.rstrip("/")
        if not self.display_name:
            self.display_name = self.model_name


class LLMClient:
    def __init__(self, config: ModelConfig) -> None:
        self.config = config
        self._client = httpx.AsyncClient(timeout=120.0)

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    async def stream(
        self,
        prompt: str,
        temperature: float = 0.6,
        max_tokens: int = 4096,
    ) -> AsyncIterator[TokenChunk]:
        """Yield token chunks as they arrive from the endpoint."""
        payload = {
            "model": self.config.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        first = True
        yielded_any = False
        async with self._client.stream(
            "POST",
            f"{self.config.endpoint}/v1/chat/completions",
            json=payload,
            headers=self._headers(),
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    # Detect error objects embedded in the SSE stream (HTTP 200 + error body).
                    if "error" in chunk and "choices" not in chunk:
                        error_msg = chunk["error"].get("message", str(chunk["error"]))
                        raise ValueError(f"API error: {error_msg}")
                    choice = chunk["choices"][0]
                    # Support both streaming ("delta") and non-streaming ("message") formats.
                    part = choice.get("delta") or choice.get("message") or {}
                    content = part.get("content", "")
                    if content:
                        yield TokenChunk(token=content, is_first=first)
                        first = False
                        yielded_any = True
                    elif not yielded_any and choice.get("finish_reason"):
                        reason = choice["finish_reason"]
                        raise ValueError(
                            f"Model stopped with no content (finish_reason={reason!r})"
                        )
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
        if not yielded_any:
            raise ValueError("Model returned an empty response")

    async def complete(
        self,
        prompt: str,
        temperature: float = 0.0,
        max_tokens: int = 1024,
    ) -> str:
        """Non-streaming completion (used for the preference model)."""
        payload = {
            "model": self.config.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        response = await self._client.post(
            f"{self.config.endpoint}/v1/chat/completions",
            json=payload,
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

    async def aclose(self) -> None:
        await self._client.aclose()

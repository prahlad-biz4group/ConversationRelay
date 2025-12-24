from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from app.config import settings


class LLMError(RuntimeError):
    pass


class LLM(Protocol):
    async def chat(self, messages: list[dict[str, str]]) -> str: ...


@dataclass(slots=True)
class MockLLM:
    async def chat(self, messages: list[dict[str, str]]) -> str:
        last_user = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                last_user = str(m.get("content") or "")
                break

        if not last_user:
            return "Say something and I'll respond."

        return f"(mock ai) You said: {last_user}"


class OllamaLLM:
    def __init__(
        self,
        base_url: str,
        model: str,
        timeout_s: float = 120.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout_s

    async def chat(self, messages: list[dict[str, str]]) -> str:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(f"{self._base_url}/api/chat", json=payload)

        if resp.status_code >= 400:
            raise LLMError(f"Ollama error {resp.status_code}: {resp.text}")

        data = resp.json()
        message = data.get("message") or {}
        content = message.get("content")
        if not isinstance(content, str):
            raise LLMError("Invalid Ollama response format")
        return content


def get_llm() -> LLM:
    provider = (settings.llm_provider or "mock").strip().lower()
    if provider == "ollama":
        return OllamaLLM(base_url=settings.ollama_base_url, model=settings.ollama_model)
    return MockLLM()

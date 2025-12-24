from __future__ import annotations

from dataclasses import dataclass
import re
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

        text = (last_user or "").strip()
        if not text:
            return "Tell me what you want to do (for example: 'help', '2+2', or 'summarize our chat')."

        lowered = text.lower()

        if lowered in {"help", "/help", "h"}:
            return (
                "I can help with:\n"
                "- Basic Q&A and suggestions\n"
                "- Simple math (e.g. 12*(3+4))\n"
                "- Summarizing the last few messages ('summarize')\n"
                "\nCommands:\n"
                "- /help\n"
                "- /reset (clears conversation context)"
            )

        if lowered in {"hi", "hello", "hey", "hii", "hola"}:
            return "Hello! Ask me anything (try: 'help' or 'summarize')."

        if any(k in lowered for k in ["who are you", "what are you", "your name"]):
            return "I'm a local mock assistant running inside your backend (no external model required)."

        if lowered.startswith("summarize") or lowered.startswith("summary"):
            recent = [
                m
                for m in messages
                if m.get("role") in {"user", "assistant"} and isinstance(m.get("content"), str)
            ][-8:]
            lines: list[str] = []
            for m in recent:
                role = "You" if m.get("role") == "user" else "Assistant"
                content = str(m.get("content") or "").strip().replace("\n", " ")
                if content:
                    lines.append(f"- {role}: {content}")
            if not lines:
                return "Nothing to summarize yet."
            return "Here’s a short summary of the last messages:\n" + "\n".join(lines)

        expr = lowered.replace(" ", "")
        if re.fullmatch(r"[0-9\+\-\*/\(\)\.]+", expr or ""):
            try:
                value = eval(expr, {"__builtins__": {}}, {})
            except Exception:
                value = None
            if isinstance(value, (int, float)):
                return f"Result: {value}"

        # lightweight "context": mention last assistant message if user asks follow-up
        if lowered.startswith("why") or lowered.startswith("how") or lowered.startswith("what about"):
            prev_assistant = ""
            for m in reversed(messages[:-1]):
                if m.get("role") == "assistant":
                    prev_assistant = str(m.get("content") or "")
                    break
            if prev_assistant:
                return (
                    "Based on what we discussed earlier, here’s a follow-up:\n"
                    f"Previous: {prev_assistant.strip()}\n\n"
                    f"Your question: {text}\n\n"
                    "If you want a real AI model response, we can switch providers later (Ollama/llama.cpp)."
                )

        return (
            "(mock ai) I don’t have a real model behind me right now, but I can still help structure your problem.\n"
            "Tell me:\n"
            "1) What’s your goal?\n"
            "2) What have you tried?\n"
            "3) What error/output are you seeing?\n\n"
            f"Your message: {text}"
        )


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


class OpenAILLM:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        timeout_s: float = 120.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout_s

    async def chat(self, messages: list[dict[str, str]]) -> str:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
        }

        headers = {"Authorization": f"Bearer {self._api_key}"}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/chat/completions",
                json=payload,
                headers=headers,
            )

        if resp.status_code >= 400:
            raise LLMError(f"OpenAI error {resp.status_code}: {resp.text}")

        data = resp.json()
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise LLMError("Invalid OpenAI response format")
        message = (choices[0] or {}).get("message") or {}
        content = message.get("content")
        if not isinstance(content, str):
            raise LLMError("Invalid OpenAI response format")
        return content


class GeminiLLM:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        timeout_s: float = 120.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout_s

    async def chat(self, messages: list[dict[str, str]]) -> str:
        # Gemini uses a different schema; we map user/assistant roles into text parts.
        contents: list[dict[str, Any]] = []
        for m in messages:
            role = m.get("role")
            content = m.get("content")
            if not isinstance(content, str) or not content.strip():
                continue
            gemini_role = "user" if role == "user" else "model"
            contents.append({"role": gemini_role, "parts": [{"text": content}]})

        url = (
            f"{self._base_url}/v1beta/models/{self._model}:generateContent"
            f"?key={self._api_key}"
        )
        payload: dict[str, Any] = {"contents": contents}

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(url, json=payload)

        if resp.status_code >= 400:
            raise LLMError(f"Gemini error {resp.status_code}: {resp.text}")

        data = resp.json()
        candidates = data.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            raise LLMError("Invalid Gemini response format")

        cand0 = candidates[0] or {}
        content_obj = cand0.get("content") or {}
        parts = content_obj.get("parts")
        if not isinstance(parts, list) or not parts:
            raise LLMError("Invalid Gemini response format")

        text_out = (parts[0] or {}).get("text")
        if not isinstance(text_out, str):
            raise LLMError("Invalid Gemini response format")
        return text_out


def get_llm() -> LLM:
    provider = (settings.llm_provider or "mock").strip().lower()
    if provider == "ollama":
        return OllamaLLM(base_url=settings.ollama_base_url, model=settings.ollama_model)
    if provider == "openai":
        if not settings.openai_api_key:
            raise LLMError("OpenAI provider selected but CR_OPENAI_API_KEY is not set")
        return OpenAILLM(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            model=settings.openai_model,
        )
    if provider == "gemini":
        if not settings.gemini_api_key:
            raise LLMError("Gemini provider selected but CR_GEMINI_API_KEY is not set")
        return GeminiLLM(
            api_key=settings.gemini_api_key,
            base_url=settings.gemini_base_url,
            model=settings.gemini_model,
        )
    return MockLLM()

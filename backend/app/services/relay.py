import json
import asyncio
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from fastapi import WebSocket


@dataclass(slots=True)
class Relay:
    websocket: WebSocket
    conversation_id: str
    db_conversation_id: UUID | None = None
    audio_bytes_received: int = 0
    history: list[dict[str, str]] = field(default_factory=list)
    _seq: int = field(default=0, init=False)
    _assistant_task: asyncio.Task[None] | None = field(default=None, init=False, repr=False)
    _assistant_message_id: str | None = field(default=None, init=False)

    async def send_event(self, event: dict[str, Any]) -> None:
        self._seq += 1
        event.setdefault("conversation_id", self.conversation_id)
        event.setdefault("seq", self._seq)
        await self.websocket.send_text(json.dumps(event))

    def set_assistant_task(self, task: asyncio.Task[None] | None, message_id: str | None) -> None:
        self._assistant_task = task
        self._assistant_message_id = message_id

    def get_assistant_task(self) -> asyncio.Task[None] | None:
        return self._assistant_task

    def get_assistant_message_id(self) -> str | None:
        return self._assistant_message_id

    async def cancel_assistant_stream(self, reason: str = "barge_in") -> None:
        task = self._assistant_task
        message_id = self._assistant_message_id
        if task is None or task.done():
            self._assistant_task = None
            self._assistant_message_id = None
            return

        task.cancel()
        self._assistant_task = None
        self._assistant_message_id = None
        if message_id:
            await self.send_event(
                {
                    "event": "assistant.message.cancelled",
                    "message_id": message_id,
                    "reason": reason,
                }
            )

    async def on_audio_bytes(self, chunk: bytes) -> None:
        self.audio_bytes_received += len(chunk)
        if self.audio_bytes_received % (16000 * 4) < len(chunk):
            await self.send_event(
                {
                    "event": "user.audio.received",
                    "bytes_total": self.audio_bytes_received,
                }
            )

    def add_user_text(self, text: str) -> None:
        self.history.append({"role": "user", "content": text})

    def add_assistant_text(self, text: str) -> None:
        self.history.append({"role": "assistant", "content": text})

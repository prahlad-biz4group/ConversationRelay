import json
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

    async def send_event(self, event: dict[str, Any]) -> None:
        self._seq += 1
        event.setdefault("conversation_id", self.conversation_id)
        event.setdefault("seq", self._seq)
        await self.websocket.send_text(json.dumps(event))

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

from typing import Any, Literal

from pydantic import BaseModel, Field


class ClientEvent(BaseModel):
    event: str
    data: dict[str, Any] | None = None


class ServerEvent(BaseModel):
    event: str
    conversation_id: str | None = None
    seq: int | None = None
    data: dict[str, Any] | None = None


class AudioFormat(BaseModel):
    format: Literal["f32le"] = "f32le"
    sample_rate: int = Field(default=16000, ge=8000, le=48000)
    channels: int = Field(default=1, ge=1, le=2)

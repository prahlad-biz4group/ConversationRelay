import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionMaker
from app.models.conversation import Conversation
from app.models.message import Message
from app.services.relay import Relay
from app.services.llm import LLMError, get_llm

router = APIRouter()

logger = logging.getLogger(__name__)

llm = None


@router.websocket("/ws/audio")
async def ws_audio(websocket: WebSocket) -> None:
    await websocket.accept()

    conversation_uuid: UUID = uuid4()
    conversation_id = str(conversation_uuid)
    relay = Relay(
        websocket=websocket,
        conversation_id=conversation_id,
        db_conversation_id=conversation_uuid,
    )

    async with AsyncSessionMaker() as db:
        started_at = datetime.now(timezone.utc)
        db.add(Conversation(id=conversation_uuid, started_at=started_at, ended_at=None))
        await db.commit()

        await relay.send_event(
            {
                "event": "session.started",
                "conversation_id": conversation_id,
                "audio": {"format": "f32le", "sample_rate": 16000, "channels": 1},
            }
        )

        try:
            while True:
                message = await websocket.receive()

                if message.get("text") is not None:
                    await _handle_text_message(relay, db, message["text"])
                    continue

                if message.get("bytes") is not None:
                    await relay.on_audio_bytes(message["bytes"])
                    continue

        except WebSocketDisconnect:
            ended_at = datetime.now(timezone.utc)
            convo = await db.get(Conversation, conversation_uuid)
            if convo is not None:
                convo.ended_at = ended_at
                await db.commit()
            return


async def _handle_text_message(relay: Relay, db: AsyncSession, text: str) -> None:
    try:
        payload: Any = json.loads(text)
    except json.JSONDecodeError:
        await relay.send_event({"event": "error", "message": "Invalid JSON"})
        return

    if not isinstance(payload, dict) or "event" not in payload:
        await relay.send_event({"event": "error", "message": "Missing event field"})
        return

    event_name = payload.get("event")

    if event_name == "ping":
        await relay.send_event({"event": "pong"})
        return

    if event_name == "client.started":
        audio_enabled = bool(payload.get("audio_enabled", True))
        if audio_enabled:
            await relay.send_event({"event": "session.audio.ready"})
        else:
            await relay.send_event({"event": "session.audio.unavailable"})
        await relay.send_event({"event": "ack", "received_event": event_name})
        return

    if event_name == "client.conversation.reset":
        relay.history.clear()
        await relay.send_event({"event": "conversation.reset"})
        return

    if event_name == "client.custom.message":
        text_value = payload.get("text")
        print(
            f"client.custom.message conversation_id={relay.conversation_id} text={text_value!r}",
            flush=True,
        )
        logger.info(
            "client.custom.message conversation_id=%s text=%r",
            relay.conversation_id,
            text_value,
        )
        await relay.send_event({"event": "server.custom.message", "text": text_value})
        return

    if event_name == "client.text.message":
        text_value = payload.get("text")
        if not isinstance(text_value, str) or not text_value.strip():
            await relay.send_event({"event": "error", "message": "text is required"})
            return

        text_value = text_value.strip()

        if text_value == "/reset":
            relay.history.clear()
            await relay.send_event({"event": "conversation.reset"})
            return
        logger.info(
            "client.text.message conversation_id=%s text=%r",
            relay.conversation_id,
            text_value,
        )

        if relay.db_conversation_id is not None:
            db.add(
                Message(
                    conversation_id=relay.db_conversation_id,
                    role="user",
                    content=text_value,
                    created_at=datetime.now(timezone.utc),
                )
            )
            await db.commit()

        relay.add_user_text(text_value)

        global llm
        if llm is None:
            try:
                llm = get_llm()
            except LLMError as e:
                await relay.send_event({"event": "error", "message": str(e)})
                return

        try:
            answer = await llm.chat(relay.history)
        except LLMError as e:
            await relay.send_event({"event": "error", "message": str(e)})
            return
        except Exception:
            await relay.send_event(
                {
                    "event": "error",
                    "message": "LLM request failed (if using Ollama, ensure it is running)",
                }
            )
            return

        relay.add_assistant_text(answer)
        if relay.db_conversation_id is not None:
            db.add(
                Message(
                    conversation_id=relay.db_conversation_id,
                    role="assistant",
                    content=answer,
                    created_at=datetime.now(timezone.utc),
                )
            )
            await db.commit()
        await relay.send_event({"event": "assistant.response", "text": answer})
        return

    await relay.send_event({"event": "ack", "received_event": event_name})

from fastapi import APIRouter
from sqlalchemy import text

from app.database import AsyncSessionMaker

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/health/db")
async def health_db() -> dict:
    async with AsyncSessionMaker() as db:
        await db.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}

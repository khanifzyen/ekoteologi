"""Health check: verifikasi DB & Redis sekali lihat."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_db
from app.core.redis import get_redis

router = APIRouter(tags=["health"])


@router.get("/health", response_model=None)
async def health(db: AsyncSession = Depends(get_db)) -> JSONResponse | dict:
    settings = get_settings()
    result: dict = {"status": "ok", "environment": settings.environment, "version": "0.1.0"}

    db_ok, redis_ok = True, True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    redis = get_redis()
    try:
        if redis is None or not await redis.ping():
            redis_ok = False
    except Exception:  # noqa: BLE001
        redis_ok = False

    result["database"] = "ok" if db_ok else "error"
    result["redis"] = "ok" if redis_ok else "error"
    if not (db_ok and redis_ok):
        result["status"] = "degraded"
        return JSONResponse(status_code=503, content=result)
    return result

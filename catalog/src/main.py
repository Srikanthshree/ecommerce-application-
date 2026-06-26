# =============================================================================
# catalog/src/main.py
# FastAPI application entry point.
# Startup: fetches DB credentials from Secrets Manager, builds connection pool.
# Shutdown: drains the pool cleanly (SIGTERM from Kubernetes).
# =============================================================================
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.config import settings
from src.database import init_db, close_db
from src.routers.products import router as products_router

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown lifecycle."""
    logger.info("Starting Product Catalog API…")
    await init_db()
    logger.info("Ready.")
    yield
    logger.info("Shutting down — closing DB pool…")
    await close_db()


app = FastAPI(
    title="Product Catalog API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
allowed = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed or ["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=True,
)

# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(products_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "catalog"}


@app.get("/ready", tags=["health"])
async def ready():
    """Kubernetes readiness probe — returns 200 only when DB pool is up."""
    from src.database import engine
    if engine is None:
        return JSONResponse(status_code=503, content={"status": "not ready"})
    return {"status": "ready"}

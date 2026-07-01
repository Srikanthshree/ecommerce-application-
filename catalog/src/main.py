# =============================================================================
# catalog/src/main.py
# FastAPI application entry point.
# Startup: fetches DB credentials from Secrets Manager, builds connection pool.
# Shutdown: drains the pool cleanly (SIGTERM from Kubernetes).
# =============================================================================
import logging
import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.config import settings
from src.database import init_db, close_db
from src.routers.products import router as products_router

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger(__name__)

# Flag to track DB initialization status
db_init_task = None
db_init_failed = False


async def init_db_background():
    """Initialize DB in background with timeout. Sets flag on failure."""
    global db_init_failed
    try:
        logger.info("Database initialization starting (background)…")
        await asyncio.wait_for(init_db(), timeout=120)  # 2 min timeout for IRSA + DB init
        logger.info("Database initialization completed successfully.")
    except asyncio.TimeoutError:
        logger.error("Database initialization timed out after 120 seconds.")
        db_init_failed = True
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        db_init_failed = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown lifecycle."""
    global db_init_task
    logger.info("Starting Product Catalog API…")
    
    # Start DB init in background — server can start listening immediately
    db_init_task = asyncio.create_task(init_db_background())
    
    logger.info("API ready (database initialization in progress).")
    yield
    
    # Wait for DB init to complete before shutdown
    if db_init_task and not db_init_task.done():
        logger.info("Waiting for database initialization to complete before shutdown…")
        try:
            await asyncio.wait_for(db_init_task, timeout=30)
        except asyncio.TimeoutError:
            logger.warning("Database initialization did not complete within timeout.")
    
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
    from src.database import engine
    db_status = "healthy" if engine is not None else "unavailable"
    return {"status": "ok", "version": "1.0.0", "checks": {"database": db_status}}


@app.get("/ready", tags=["health"])
async def ready():
    """Kubernetes readiness probe — returns 200 only when DB pool is up."""
    from src.database import engine
    if engine is None:
        return JSONResponse(status_code=503, content={"status": "not ready"})
    return {"status": "ready"}

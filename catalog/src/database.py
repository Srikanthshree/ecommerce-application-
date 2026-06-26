# =============================================================================
# catalog/src/database.py
# Async SQLAlchemy engine backed by asyncpg (PostgreSQL).
# Credentials are fetched from AWS Secrets Manager at startup.
# =============================================================================
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from src.config import fetch_db_credentials
import logging

logger = logging.getLogger(__name__)

engine = None
AsyncSessionLocal = None


class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    """Called at app startup — fetches creds, creates engine, runs migrations."""
    global engine, AsyncSessionLocal

    creds = fetch_db_credentials()
    dsn = (
        f"postgresql+asyncpg://{creds['username']}:{creds['password']}"
        f"@{creds['host']}:{creds['port']}/{creds['dbname']}"
    )

    engine = create_async_engine(
        dsn,
        pool_size=10,
        max_overflow=20,
        pool_timeout=30,
        pool_recycle=1800,
        echo=False,
        connect_args={"ssl": "require"},   # enforce TLS to RDS
    )

    AsyncSessionLocal = sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    # Create tables if they don't exist (idempotent)
    async with engine.begin() as conn:
        from src.models.product import Product  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)

    logger.info("Database connection pool initialised.")


async def close_db() -> None:
    if engine:
        await engine.dispose()
        logger.info("Database connection pool closed.")


async def get_session() -> AsyncSession:
    """FastAPI dependency — yields a DB session per request."""
    async with AsyncSessionLocal() as session:
        yield session

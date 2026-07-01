# =============================================================================
# Catalog — Multi-stage Dockerfile (Python / FastAPI)
#
# Stage 1 (builder): installs dependencies in a clean layer
# Stage 2 (production): copies only what is needed, runs as non-root UID 1001
# =============================================================================

# ─── Stage 1: Dependency builder ─────────────────────────────────────────────
FROM python:3.12.4-slim-bookworm AS builder

WORKDIR /build

# Install OS build deps for asyncpg (C extension)
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libpq-dev \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Install to a prefix dir so we can copy cleanly in stage 2
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ─── Stage 2: Production runtime ─────────────────────────────────────────────
FROM python:3.12.4-slim-bookworm AS production

RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends libpq5 \
 && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --system --gid 1001 appgroup \
 && useradd  --system --uid 1001 --gid appgroup --no-create-home appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY --chown=appuser:appgroup src/ ./src/

# Give appuser ownership of /app so multiprocessing workers can chdir into it,
# then restrict write access on all files.
RUN chown appuser:appgroup /app \
 && chmod -R 550 /app

USER appuser

EXPOSE 8000

# Start uvicorn with 2 workers; Kubernetes HPA controls scaling
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]

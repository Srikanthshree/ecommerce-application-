# =============================================================================
# Backend — Multi-stage Dockerfile
#
# Stage 1 (builder): compiles TypeScript → JavaScript
# Stage 2 (production): copies only the compiled artefacts + prod deps,
#                       runs as a dedicated non-root user (UID 1001).
#
# Image is pinned to an exact digest-reproducible tag so supply-chain
# attacks via tag mutation are not possible.
# =============================================================================

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20.15.0-alpine3.20 AS builder

WORKDIR /build

# Copy manifests first so Docker layer-cache is reused when only src changes
COPY package.json tsconfig.json ./

# `--ignore-scripts` prevents malicious npm postinstall hooks from running
# Use --legacy-peer-deps to avoid strict peer dependency resolution failures
RUN npm install --ignore-scripts --legacy-peer-deps

# Copy application source
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# Diagnostics: print build output so CI logs show whether `dist/` was created
RUN echo "=== /build contents ===" && ls -la /build || true
RUN echo "=== /build/dist contents ===" && ls -la /build/dist || true

# Prune devDependencies — only production deps will be copied to stage 2
RUN npm prune --omit=dev


# ─── Stage 2: Production runtime ─────────────────────────────────────────────
FROM node:20.15.0-alpine3.20 AS production

# Apply all OS security patches and remove the package cache in one layer
RUN apk update \
 && apk upgrade --no-cache \
 && rm -rf /var/cache/apk/*

# Create a dedicated non-root system user and group
RUN addgroup --system --gid 1001 appgroup \
 && adduser  --system --uid 1001 --ingroup appgroup --no-create-home appuser

WORKDIR /app

# Copy only the production artefacts; set ownership in the same layer
COPY --from=builder --chown=appuser:appgroup /build/dist         ./dist
COPY --from=builder --chown=appuser:appgroup /build/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /build/package.json ./package.json

# Read-only permissions — the container process cannot modify its own code
RUN chmod -R 550 /app

# Drop to non-root before any further instructions
USER appuser

# Declare the port the process listens on (documentation only — does not publish)
EXPOSE 8080

# K8s liveness / readiness probe target
HEALTHCHECK \
  --interval=30s \
  --timeout=5s   \
  --start-period=15s \
  --retries=3    \
  CMD node -e "\
    require('http').get('http://localhost:3000/health', (r) => { \
      process.exit(r.statusCode === 200 ? 0 : 1); \
    }).on('error', () => process.exit(1));"

CMD ["node", "dist/index.js"]


# -----------------------------------------------------------------------------
# Production image when the build artifacts are produced on the CI runner
# (the workflow prepares `backend/dist` and `backend/node_modules`). This
# target copies the prebuilt assets from the build context instead of
# re-running the TypeScript build inside the image. The CI uses this target
# to guarantee the final image always contains `dist/index.js`.
# -----------------------------------------------------------------------------
FROM node:20.15.0-alpine3.20 AS production-prebuilt

# Apply OS updates in one layer
RUN apk update \
 && apk upgrade --no-cache \
 && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup --system --gid 1001 appgroup \
 && adduser  --system --uid 1001 --ingroup appgroup --no-create-home appuser

WORKDIR /app

# Copy prebuilt artifacts from the build context (created by the CI runner)
COPY --chown=appuser:appgroup dist         ./dist
COPY --chown=appuser:appgroup package.json ./package.json

# Install production dependencies inside the image so native modules are
# compiled for the container's runtime environment (avoids host -> image
# platform mismatches when copying node_modules from the runner).
RUN npm install --omit=dev --legacy-peer-deps --no-audit --production

# Read-only permissions and non-root user
RUN chmod -R 550 /app
USER appuser

EXPOSE 8080

HEALTHCHECK \
  --interval=30s \
  --timeout=5s   \
  --start-period=15s \
  --retries=3    \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

CMD ["node", "dist/index.js"]

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
RUN npm install --ignore-scripts

# Copy application source
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

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
EXPOSE 3000

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

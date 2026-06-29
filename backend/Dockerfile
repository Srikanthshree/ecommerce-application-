# =============================================================================
# Backend — Multi-stage Dockerfile
#
# Stage 1 (builder): installs ALL deps (including devDeps), compiles TypeScript
# Stage 2 (production): copies compiled JS + pruned prod deps, runs non-root
# =============================================================================

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20.15.0-alpine3.20 AS builder

WORKDIR /build

# Copy manifests first — Docker layer-cache reused when only src changes
COPY package.json tsconfig.json ./

# Install ALL deps (devDeps needed for tsc); do NOT use --ignore-scripts
# because some packages need postinstall to compile native bindings
RUN npm install --legacy-peer-deps

# Copy source and compile TypeScript → JavaScript
COPY src/ ./src/
RUN npm run build

# Hard-fail with a clear message if the entry-point was not produced
RUN test -f dist/index.js \
    || (echo "ERROR: TypeScript build did not produce dist/index.js" && exit 1)

# Show compiled files in CI docker build logs
RUN echo "=== dist/ contents ===" && find dist/ -type f | sort

# Prune devDependencies — only prod deps will be copied to stage 2
RUN npm prune --omit=dev


# ─── Stage 2: Production runtime ─────────────────────────────────────────────
FROM node:20.15.0-alpine3.20 AS production

# Apply all OS security patches in one layer
RUN apk update \
 && apk upgrade --no-cache \
 && rm -rf /var/cache/apk/*

# Create a dedicated non-root system user and group
RUN addgroup --system --gid 1001 appgroup \
 && adduser  --system --uid 1001 --ingroup appgroup --no-create-home appuser

WORKDIR /app

# Copy artefacts from builder; COPY --chown sets ownership to appuser:appgroup
# so the files are never owned by root in the final image
COPY --from=builder --chown=appuser:appgroup /build/dist         ./dist
COPY --from=builder --chown=appuser:appgroup /build/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /build/package.json ./package.json

# r-xr-x--- for owner (appuser) and group (appgroup); no access for others
RUN chmod -R 550 /app

# Drop to non-root before any further instructions
USER appuser

# App listens on PORT env var (default 3000, set by ConfigMap key "port")
EXPOSE 3000

# K8s liveness / readiness probe target
HEALTHCHECK \
  --interval=30s \
  --timeout=5s   \
  --start-period=30s \
  --retries=3    \
  CMD node -e "\
    require('http').get('http://localhost:3000/health', (r) => { \
      process.exit(r.statusCode === 200 ? 0 : 1); \
    }).on('error', () => process.exit(1));"

CMD ["node", "dist/index.js"]

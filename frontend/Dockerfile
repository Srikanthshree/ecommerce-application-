# =============================================================================
# Frontend — Multi-stage Dockerfile
#
# Stage 1 (builder): installs deps and builds the React SPA with CRA
# Stage 2 (production): serves the static bundle via a hardened nginx,
#                       running as a non-root user on port 8080.
# =============================================================================

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /build

COPY package.json ./

# No lockfile in repo — generate one then install all deps
RUN npm install --legacy-peer-deps

COPY public/ ./public/
COPY src/    ./src/

# API URL is injected at build time via --build-arg; it is NOT a runtime secret
ARG  REACT_APP_API_URL=""
ENV  REACT_APP_API_URL=$REACT_APP_API_URL

# CI=false prevents CRA warnings from failing the build in CI
# Set to true in future when lint/warnings are fixed
ENV  CI=false

RUN npm run build


# ─── Stage 2: Production runtime (nginx) ─────────────────────────────────────
FROM nginx:1.27.0-alpine3.19 AS production

# Apply OS security patches
RUN apk update \
 && apk upgrade --no-cache \
 && rm -rf /var/cache/apk/*

# Remove the default nginx user and create a locked-down non-root user
RUN deluser  nginx 2>/dev/null || true \
 && addgroup --system --gid 1001 appgroup \
 && adduser  --system --uid 1001 --ingroup appgroup --no-create-home appuser

# Replace the default nginx config with our hardened version
COPY --chown=appuser:appgroup nginx.conf /etc/nginx/nginx.conf

# Copy the compiled React app from the builder stage
COPY --from=builder --chown=appuser:appgroup /build/build /usr/share/nginx/html

# Grant the non-root user write access to the paths nginx needs at runtime,
# and make all HTML files read-only for that user.
RUN mkdir  -p /var/cache/nginx /var/log/nginx /var/run \
 && chown  -R appuser:appgroup /var/cache/nginx /var/log/nginx /var/run /usr/share/nginx/html \
 && chmod  -R 550 /usr/share/nginx/html

USER appuser

EXPOSE 8080

HEALTHCHECK \
  --interval=30s \
  --timeout=5s   \
  --start-period=10s \
  --retries=3    \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]

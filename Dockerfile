# One container serves the API, the WebSocket and the built display on one port.
# Build: docker build -t mantel .   Run: see docker-compose.yml or deploy/unraid/mantel.xml.

# ---- build: install, compile both apps, then prune to production server deps ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
# better-sqlite3 falls back to a source build when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/display/package.json apps/display/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @mantel/display build && pnpm --filter @mantel/server build
RUN pnpm --filter @mantel/server deploy --prod --legacy /out

# ---- runtime: Node, production deps, the server bundle and the static display ----
FROM node:22-bookworm-slim
ARG REVISION=dev
# Mantel's shared Google sign-in client (a Desktop client, whose secret Google treats as
# public). The publish workflow passes them from repository secrets; blank means each
# household uses its own client. See docs/google-shared-client.md.
ARG MANTEL_GOOGLE_CLIENT_ID=
ARG MANTEL_GOOGLE_CLIENT_SECRET=
LABEL org.opencontainers.image.title="Mantel" \
      org.opencontainers.image.description="Family wall display: calendars, weather, photos, lists and Home Assistant controls" \
      org.opencontainers.image.source="https://github.com/sorel123/mantel" \
      org.opencontainers.image.revision="${REVISION}"
ENV NODE_ENV=production \
    MANTEL_GOOGLE_CLIENT_ID=${MANTEL_GOOGLE_CLIENT_ID} \
    MANTEL_GOOGLE_CLIENT_SECRET=${MANTEL_GOOGLE_CLIENT_SECRET} \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    DISPLAY_DIST=/app/display \
    TZ=America/Los_Angeles
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /app/apps/server/dist /app/dist
COPY --from=build /app/apps/display/dist /app/display
# SQLite, caches and config files (HA allow-list) live here; map it to appdata on Unraid.
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Node is PID 1 and handles SIGTERM itself (see apps/server/src/index.ts).
CMD ["node", "dist/index.js"]

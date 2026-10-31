# One container serves the API, the WebSocket and the built display. WS6 refines this.
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

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    DISPLAY_DIST=/app/display
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /app/apps/server/dist /app/dist
COPY --from=build /app/apps/display/dist /app/display
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

# Tasa API — build from the repo root:
#   docker build -f apps/api/Dockerfile -t tasa-api .
# Used by Render, Railway and the droplet alike. Only the API and the packages it bundles enter
# the build; the image holds the bundled server plus production dependencies, no source.

FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --filter @tasa/api...
COPY packages/contracts packages/contracts
COPY packages/config packages/config
COPY apps/api apps/api
RUN pnpm --filter @tasa/api build \
 && pnpm --filter @tasa/api deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
USER node
# Render and Railway set PORT; the droplet's compose file sets it too.
ENV PORT=4110
EXPOSE 4110
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/server.js"]

# Tasa website (Next.js) — build from the repo root:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.tasa.ng/api -t tasa-web .
# NEXT_PUBLIC_* values are baked in at build time, so pass them as build args.

FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --filter @tasa/web...
COPY packages/contracts packages/contracts
COPY packages/config packages/config
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL=https://tasa.ng
ARG NEXT_PUBLIC_APP_STORE_URL=
ARG NEXT_PUBLIC_PLAY_STORE_URL=
RUN pnpm --filter @tasa/web build

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# Tasa

Bill payments, wallet, groups, tickets and split bills — one pnpm + Turborepo monorepo.

| Path                 | What                                   | Stack                              | Dev port |
| -------------------- | -------------------------------------- | ---------------------------------- | -------- |
| `apps/api`           | Backend                                | Fastify, Mongoose, Zod, BullMQ     | 4110     |
| `apps/mobile`        | The app                                | Expo SDK 58, expo-router           | 8081     |
| `apps/admin`         | Back office                            | Vite, React, TanStack Query        | 5173     |
| `apps/web`           | Website + guest checkout (`/pay`)      | Next.js 16                         | 3000     |
| `packages/contracts` | Shared enums, kobo money, API envelope | TypeScript source + Zod (no build) | —        |
| `packages/config`    | Base tsconfig                          |                                    | —        |

History from the old `tela`, `tela-api`, `tela-admin` and `tela-web` repos is kept (`git subtree`).

## Getting started

```sh
corepack enable            # pnpm 10, pinned in package.json
pnpm install
cp apps/api/.env.example apps/api/.env          # and fill it in
cp apps/mobile/.env.example apps/mobile/.env.local
cp apps/admin/.env.example apps/admin/.env
cp apps/web/.env.example apps/web/.env

pnpm db:local              # Mongo replica set on :27018 (wallet transactions need one); Redis on :6379
pnpm dev:api               # or: pnpm dev (API, admin, web together)
pnpm dev:mobile            # Expo; native builds: pnpm --filter @tasa/mobile ios
```

`pnpm typecheck`, `pnpm test`, `pnpm build` run across every package.

## Shared contracts

Anything both the API and a client must agree on goes in `packages/contracts` and is imported as
`@tasa/contracts/<module>` — never copied. Money is integer **kobo** everywhere (`Kobo`, `formatNaira`,
`parseAmountInput` in `@tasa/contracts/money`). Packages ship TS source: the API bundles them with
tsup, Next transpiles them (`transpilePackages`), Vite and Metro read them directly.

Still app-local and worth moving over time: `apps/mobile/lib/api/types.ts`, the admin's
`features/*/api.ts` types, and the API's `*.schema.ts` request schemas.

## Deploying

- **Now — Render or Railway.** `render.yaml` is a Blueprint for API (Docker) + Redis + web + admin.
  On Railway, create one service per app from this repo; each app's `railway.json` holds its build.
  Either way MongoDB is **Atlas** (must be a replica set) and Redis must use `noeviction`.
- **Production — DigitalOcean droplet.** `deploy/droplet/`: Caddy + API + web + Mongo (single-node
  replica set) + Redis via Docker Compose, deployed by `.github/workflows/deploy-droplet.yml`.
  See `deploy/droplet/README.md`.

The same `apps/api/Dockerfile` runs on all three.

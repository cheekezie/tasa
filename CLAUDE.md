# Tasa monorepo

pnpm + Turborepo. Read the app's own CLAUDE.md before working in it (`apps/api/CLAUDE.md` before any
money logic; `apps/mobile/AGENTS.md` says to read the versioned Expo docs first).

- Shared types/enums/money go in `packages/contracts` (TS source, imported as `@tasa/contracts/<module>`).
  Don't duplicate an API shape in a client — move it to contracts. Contracts code is compiled under
  each consumer's tsconfig (API/admin use `noUncheckedIndexedAccess`, admin `exactOptionalPropertyTypes`),
  so write it to pass the strictest one.
- Money is integer kobo everywhere.
- Add a dependency with `pnpm --filter @tasa/<app> add <pkg>`; mobile native deps with
  `pnpm --filter @tasa/mobile exec expo install <pkg>`. Expo needs a single `react-native` copy.
- Deploy: Render/Railway now (`render.yaml`, `apps/*/railway.json`), droplet later (`deploy/droplet`).

# Tela Admin

The back office for [Tela](../tela), on the [Tela API](../tela-api). Staff sign in with the email and password a
super admin gives them; what each role can see and do matches the API's own checks.

Vite · React 19 · TypeScript · Tailwind 4 · shadcn/Radix · React Router 7 · TanStack Query and Table · Zustand.

## Run locally

```bash
npm install
cp .env.example .env     # VITE_API_URL, default http://localhost:4110/api
npm run dev              # http://localhost:5173
```

The API must allow this origin: put `http://localhost:5173` in its `CORS_ORIGINS`. The first super admin comes
from the API's `npm run seed` (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`); create everyone else under **Staff**.

## Roles

| Role        | Can                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| super_admin | Everything, including staff and maintenance mode                                                                                    |
| finance     | Money: charges, promotions, Tela coupons, P&L, ledger and VTpass top-ups, resolving stuck payments, audit log                       |
| support     | Users (suspend/reactivate), suspending organisers, requeries, missed collections, pausing coupons and event sales, feature switches |
| compliance  | BVN review and reveal; reviewing organisers' photo and ID (each document view is logged) and suspending them                        |

Organisers and events are open to compliance, support and finance. Every admin can read the dashboard, transactions, users, coupons, promotions, charges, points and switches.

## Layout

- `src/features/<area>/api.ts` — typed TanStack Query hooks for that area's endpoints; `pages/` — its screens.
- `src/lib/http.ts` — the API client: unwraps `{ success, data }`, throws `ApiError` with the API's message,
  refreshes the session once on a 401.
- `src/routes/metadata.ts` — every route and the roles that may open it; `src/config/navigation.ts` — the sidebar.
- `src/shared/` — layout, table, form and UI components shared by every area.

Money is integer kobo everywhere, as in the API: show it with `naira()`, send typed amounts with `toKobo()`.

## Check

```bash
npm run typecheck && npm run lint && npm run build
```

super@tela.dev

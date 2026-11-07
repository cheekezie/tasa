# Tasa API

Backend for [Tasa](../tela) and its back office, [tela-admin](../tela-admin): wallet, SaySwitch bank-transfer funding, VTpass bill
payments (electricity, airtime, data, TV, Smile/Spectranet, JAMB/WAEC PINs), Tasa transfers, coupons, gifts, beneficiary account numbers
with auto-pay, recurring bills, event tickets with organiser payouts, feature switches and maintenance mode, insights and notifications.

Fastify 5 · Mongoose 8 (replica set) · Zod 4 · BullMQ + Redis · SaySwitch · VTpass · Termii · Expo push.

- `docs/api.md` — endpoints for the app, and what each replaces in the mock layer
- `docs/admin-api.md` — back office: staff, charges, coupons/giveaways, promotions, events, switches, P&L reports
- `docs/architecture.md` — ledger, money flows, jobs, what still needs SaySwitch sandbox confirmation
- `CLAUDE.md` — rules for changing this code

## Run locally

```bash
npm install
cp .env.example .env          # fill JWT_SECRET, ENCRYPTION_KEY, SaySwitch test keys, VTpass sandbox keys
npm run db:local              # separate terminal: a replica-set mongod in ./.data, on 27018
mongosh --port 27018 --eval 'rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27018" }] })'   # once
npm run seed                  # default charges + first admin (SEED_ADMIN_*)
npm run seed:dev-admins       # optional, local only: one sample admin per role, password tela-dev-admin
npm run dev                   # http://localhost:4110
```

Redis must be running. Without `TERMII_API_KEY`, OTPs print to the console. `CORS_ORIGINS` must list every browser
origin that calls the API: the app's web build (`http://localhost:8081`) and the back office (`http://localhost:5173`).

Webhooks (use a tunnel such as `ngrok` locally):
- SaySwitch → `https://<host>/api/webhooks/sayswitch`
- VTpass → `https://<host>/api/webhooks/vtpass` (set it on your VTpass account; also whitelist the
  server IP and each product you sell, or VTpass answers `027`/`028`)

VTpass's sandbox has test numbers per product — e.g. airtime `08011111111` succeeds, `201000000000` stays
pending, `300000000000` times out; meter `1111111111111`, DStv `1212121212`, JAMB profile `0123456789`.

## Test

```bash
npm run typecheck && npm test
```

The integration suite boots an in-memory Mongo replica set and uses Redis db 15 (flushed per run). It fakes
SaySwitch and VTpass only at `fetch`, and checks that the ledger balances after every flow.

## Charges

Business rule: funding is free to users (Tasa absorbs SaySwitch's fee, booked to
`expense:provider_fees:*`) and every transaction carries a charge. Seeded placeholders: bills ₦20 by default,
electricity ₦100, TV/internet/water ₦50, exams ₦150; transfers ₦10; gifts ₦20; coupons 1% (₦50–₦1,000). Change them at `/api/admin/charges` (role `finance`); preview with
`GET /api/admin/charges/preview?scope=bill&serviceId=electricity&provider=IKEDC&amount=1000000`.
Rules: `fee = clamp(amount × rateBps / 10 000 + fixed, min, max)`, one per `code`, most specific wins.

VTpass's own commission (it debits us less than face value) is separate from these charges: it's booked
to `revenue:commission` on every delivered bill.

## Funding the VTpass wallet

Bills are paid from the prepaid VTpass wallet, so keep it topped up (VTpass answers `018 LOW WALLET
BALANCE` otherwise — users are refunded, but the bill fails). After moving money in the providers'
dashboards, record it with `POST /api/admin/ledger/vtpass-topups { amount, note }`, and compare books with
VTpass using `GET /api/admin/ledger/vtpass`.

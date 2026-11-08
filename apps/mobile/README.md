# Tasa

Nigerian bill payment app built with Expo and React Native.

## Features

- Wallet funding and Tasa-to-Tasa transfers
- Utility bill payments with per-bill spending insights
- Recurring payments with low-balance reminders
- Beneficiaries with virtual accounts for offline bill payment
- Gift utility bills instead of cash
- Coupon giveaways for campaigns, JAMB PINs, and community drops

## Run locally

```bash
npm install
npm run start
```

Then press `i` for iOS simulator, `a` for Android, or `w` for web.

Copy `.env.example` to `.env` and point `EXPO_PUBLIC_API_URL` at a running [tela-api](../tela-api).
On a physical device, use your machine's LAN IP rather than `localhost`.

## Project structure

- `app/` — Expo Router screens and navigation
- `components/ui/` — shared UI building blocks
- `constants/` — theme tokens and service metadata
- `context/` — device and session state (`AppContext`), settings and theme
- `hooks/` — TanStack Query hooks; `useCheckout` is the quote → PIN → confirm flow for every debit
- `lib/api/` — API client (auth, refresh, errors), typed services, and `mappers.ts`

## Working with the API

- Screens use **hooks**, hooks use **services** in `lib/api/services`, and only services call `request`.
- Profile photos are uploaded to the API, which stores them in Cloudflare R2.
- Server data lives in TanStack Query, never in context or AsyncStorage.
- Money is integer kobo everywhere (`Kobo` in `lib/money.ts`), as the API sends and expects it.
  Only `formatNaira` turns it into naira, and only the amount input turns typed naira into kobo.
- Sign-in is by OTP, once per device. The PIN approves money, not access; users can turn it off for bill payments only.
- Offline, reads pause and resume on reconnect; writes fail straight away and are never queued.
- Every debit goes through `useCheckout`. Money requests are never auto-retried: when the outcome
  is unknown, the user retries the same quote, which the API can't charge twice.

┌────────────────────────────────────┬────────────────────┐
│ Bill │ Test number │
├────────────────────────────────────┼────────────────────┤
│ Prepaid meter │ 1111111111111 │
├────────────────────────────────────┼────────────────────┤
│ Postpaid meter │ 1010101010101 │
├────────────────────────────────────┼────────────────────┤
│ Smart card (DStv, GOtv, StarTimes) │ 1212121212 │
├────────────────────────────────────┼────────────────────┤
│ JAMB profile │ 0123456789 │
├────────────────────────────────────┼────────────────────┤
│ Smile email │ tester@sandbox.com │
└────────────────────────────────────┴────────────────────┘
MTN airtime / Data 08011111111

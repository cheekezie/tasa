# API for the Tela app

Base URL `/api`. Send `Authorization: Bearer <accessToken>`. All money is **kobo** (₦1 = 100).
Every response: `{ success, statusCode, data }` or `{ success: false, statusCode, code, message, errors? }`.
Show `message` to the user; branch on `code`.

## App config — read at startup, before sign-in
`GET /config` (no token) → `{ maintenance: { active, message, until }, features: { <key>: { enabled, message } } }`.
Keys: `funding`, `bills`, `bill_electricity`, `bill_airtime`, `bill_tv`, `bill_internet`, `bill_jamb`, `transfers`, `gifts`,
`coupons`, `recurring`, `points`, `tickets`, `ticket_selling`, `ticket_payouts`. A switched-off feature's quotes and
actions answer `503 FEATURE_DISABLED` (`errors.feature`, `message` says why); `GET /bills/services` marks a paused
service `available: false` with `pausedMessage`. In maintenance every call except `/config` answers
`503 MAINTENANCE` (`errors.until` when set). Re-read it on either code, on foreground, and every minute or so.

## Sign in — by phone, or by email when SMS doesn't arrive

The app says which it is with `type`:

```jsonc
POST /auth/otp         { "type": "phone", "value": "08031234567" }      // or
                       { "type": "email", "value": "ada@example.com" }
POST /auth/otp/verify  { "type": "email", "value": "ada@example.com", "code": "123456" }
```

| | |
|---|---|
| `POST /auth/otp` | Sends a 6-digit code by SMS or email → `{ channel, expiresInSeconds, resendInSeconds }`. `429 OTP_COOLDOWN` within 60s. |
| `POST /auth/otp/verify` | → `{ accessToken, refreshToken, isNewUser, user }`. Creates the account + wallet the first time a phone or email is used. A code only works for the exact phone/email (and purpose) it was sent to. |
| `POST /auth/refresh` `{ refreshToken }` | Rotates both tokens (access lasts 15 min). Reusing an old refresh token signs out every device in that session. |
| `POST /auth/logout` `{ refreshToken }` | |

Suggested UX: phone first; after a failed or slow SMS, offer "Send the code to my email instead".

Then `PUT /me/pin { pin }` (4 digits) — every debit needs it. `{ pin, currentPin }` to change.

`POST /auth/logout/all` signs out every device.

**PIN on bills is optional.** `POST /me/pin/bills { enabled, pin }` sets `billPinEnabled` on the profile. When it's off, `POST /bills/purchases` doesn't need `pin`. Every new OTP sign-in turns it back on, so a stolen phone number can't inherit it. Transfers, gifts, coupons and closing the account always need the PIN. Setting up or changing a recurring bill needs none (`POST/PATCH /recurring`): it pays nothing then, and each run is checked when it pays, refused for a suspended account.

**PIN**
- `POST /me/pin/verify { pin }` proves it (e.g. on a new device). Wrong tries count towards the 5-try lockout.
- Forgotten: `POST /me/pin/reset/otp` sends a code to the phone (or else email) on the account, then
  `POST /me/pin/reset { code, pin }`. The new PIN works immediately and any lockout is cleared. The user is told by
  push and email.

**Closing an account:** `DELETE /me { pin, forfeitAmount? }` is permanent. From ₦100 up the balance must be moved out
first (`ACCOUNT_HAS_BALANCE`). Below that it can't be transferred, so the user can give it up: send the exact amount in
kobo as `forfeitAmount`, or get `ACCOUNT_BALANCE_CHANGED` with `errors.balance`. It also needs no pending
payments (`ACCOUNT_HAS_PENDING`) and no active giveaways (`ACCOUNT_HAS_COUPONS`). Personal details are erased, recurring
bills stop, and financial records stay. The phone or email can sign up again as a new account.

## Profile — replaces `lib/profile.ts`

`GET /me` (includes `walletBalance`, `hasPin`; `phone` or `email` may be `null`) ·
`PATCH /me { username?, fullName?, payday?, notificationPrefs? }` (`notificationPrefs`: `shortfallReminders`, `push`, `paymentReceipts`, `walletFunding`, `offers`; these silence pushes only, and security notices always go) · `GET /me/username-available?username=` ·
`POST /me/bvn { bvn }` (stored encrypted, then reviewed by hand; `bvn` on the profile is `{ status: 'pending' | 'verified' | 'rejected', last4, rejectionReason }`. A rejected BVN is erased and can be submitted again; otherwise `409 BVN_LOCKED`. `bvn_on_file` promos need `verified`) · `POST /me/push-tokens { token }` · `DELETE /me/push-tokens { token }`.

**Profile photo.** `POST /me/avatar` as multipart with one `file` part (JPEG, PNG or WebP under 5MB, judged from the
file itself) → `{ avatarUrl }`. It replaces and deletes any previous photo; `GET /me` returns `avatarUrl` too.
`DELETE /me/avatar` removes it. Errors: `PHOTO_MISSING`, `PHOTO_INVALID`, `PHOTO_TOO_LARGE`.

**Adding or changing a phone or email** — both are sign-in identities, so they're only saved once proven
(PATCH ignores them):

```jsonc
POST /me/contacts/otp     { "type": "phone", "value": "08031234567" }   // sends a code to it
POST /me/contacts/verify  { "type": "phone", "value": "08031234567", "code": "123456" }  // → updated profile
```

`409 CONTACT_TAKEN` if it belongs to another account. After linking, either one signs in to the same account.

Email-only users can pay bills, fund their wallet, and receive gifts sent to their email or username.

## Quotes — "amount + charges = total" for every screen

`POST /quotes` with one of:

```jsonc
{ "kind": "funding", "amount": 1000000 }
{ "kind": "bill", "serviceId": "electricity", "provider": "IKEDC", "account": "45098273614",
  "amount": 2200000, "meterType": "prepaid", "couponCode": "LIGHT-UP-LAG", "beneficiaryId": "…" }
{ "kind": "bill", "serviceId": "airtime", "product": "data", "provider": "MTN", "account": "08012345678", "planCode": "46" }
{ "kind": "bill", "serviceId": "tv", "provider": "DSTV", "account": "7034567890", "planCode": "dstv-padi" }
{ "kind": "bill", "serviceId": "internet", "provider": "Smile", "account": "ada@example.com", "planCode": "516" }
{ "kind": "bill", "serviceId": "jamb", "provider": "JAMB", "account": "0123456789", "planCode": "utme-mock" }
{ "kind": "bill", "serviceId": "jamb", "provider": "WAEC", "account": "08031112222", "planCode": "waecdirect" }
{ "kind": "bill", "serviceId": "jamb", "provider": "WAEC", "account": "08031112222", "planCode": "waec-registraion" }
{ "kind": "transfer", "recipient": { "type": "username", "value": "chidi_okafor" }, "amount": 1200000, "note": "Lunch" }
{ "kind": "coupon", "title": "JAMB PIN Giveaway", "amount": 770000, "quantity": 10, "services": ["jamb"] }
{ "kind": "gift", "recipient": { "type": "phone", "value": "08031112222" }, "recipientName": "Ada", "serviceId": "airtime", "amount": 500000 }
```

Response (render this on the review screen):

```jsonc
{
  "id": "…", "kind": "bill", "currency": "NGN",
  "amount": 2200000,
  "charges": [{ "code": "service_charge", "label": "Service charge", "amount": 10000 }],
  "fee": 10000, "discount": 0, "total": 2210000,
  "expiresAt": "…",                       // 15 min — re-quote after
  "bill": { "provider": "IKEDC", "account": "45098273614",
            "customer": { "name": "ADAEZE OKAFOR", "detail": { "label": "Meter type", "value": "Prepaid" } } }
}
```

Every quote also has `pointsToEarn`: what it will earn if it succeeds, by the same rule that awards them (0 when it earns nothing, or points are paused).

For funding, `total` is what the user must transfer and `amount` is what lands in the wallet.
Bill quotes verify the meter / smart card / JAMB profile with VTpass: `422 ACCOUNT_NOT_VERIFIED` replaces the
app's `000…` demo hook.

## Looking someone up — before a transfer or gift

```jsonc
POST /users/lookup  { "type": "username", "value": "ada_okafor" }   // or "phone" / "email"
→ { "found": true,  "isSelf": false, "user": { "username": "ada_okafor", "name": "Adaeze O." } }
→ { "found": false, "canInvite": true }    // phone/email not on Tela: a gift still works, as an invite
→ { "found": false, "canInvite": false }   // unknown username
```

Only a username and a shortened name come back, never the person's phone or email. It's limited to 20
lookups a minute. Transfers and gifts take the same `recipient: { type, value }`.

- **Transfers** need a Tela user (`404` otherwise).
- **Gifts** to a Tela user are locked to that account; the quote says `gift.onTela: true`. To a phone/email
  that isn't on Tela yet, the gift is sent as an SMS/email invite and is waiting when they sign up with it.
  The sender only ever sees what they typed (`recipient.label`).

## Wallet funding — two ways

**1. One-time account (quoted).** For a specific amount, with a reference to poll.
1. `POST /quotes { kind: 'funding', amount }` → charges (₦0: funding is free to users).
2. `POST /wallet/fundings { quoteId }` → `{ reference, total, funding: { bankName, accountNumber, accountName, expiresAt } }`.
3. Poll `GET /transactions/:reference` (or `/wallet/fundings/:reference`) every ~5s until `success`. While
   pending, each poll also asks SaySwitch (at most every 10s), so a missed webhook doesn't leave the user waiting.

**2. Permanent account number.** The user transfers any amount, any time, from their bank app.
- `POST /wallet/account` → `{ bankName, accountNumber, accountName }` (same number every time). `GET /wallet`
  returns it as `account` once issued.
- The money arrives without a Tela reference, so there's nothing to poll by reference. On "I've sent it",
  poll `GET /wallet/account/credits?since=<when they tapped>` every ~5s. A push notification also goes out on credit.
- How it's verified: SaySwitch's signed webhook → we re-verify the payment with SaySwitch → its
  `customer_code` (each permanent account is its own SaySwitch customer) says whose account it was →
  credited once per SaySwitch reference.
- If a webhook never comes: support finds the payment in the SaySwitch dashboard from the user's receipt
  and credits it with `POST /admin/collections { reference }` (same checks, never twice).

## Bills — replaces `lib/bills.ts` and `payBill`

`GET /bills/services` (each with `available`, `providers`; a provider may carry a `logo` image URL) ·
`GET /bills/services/:serviceId/providers/:provider/plans` (data bundles, TV packages, internet plans, exam PIN
types — `planCode` is VTpass's variation code) ·
`POST /bills/verify { serviceId, provider, account, meterType?, planCode? }` → `{ account, customer }` (who a meter, smart card or Smile account belongs to, without pricing; 20/min) ·
`POST /bills/purchases { quoteId, pin?, saveBeneficiary?: { label } }` → `201` final, or `202` with `status: 'pending'` — then poll
`GET /transactions/:reference`. Successful electricity includes `bill.token` and `bill.units`; JAMB and WAEC registration a PIN in
`bill.token`; the WAEC result checker and Spectranet `bill.pins: [{ pin, serial }]`.

TV always needs a `planCode`: to renew, buy the same package. The review screen can show `bill.customer.detail` (current plan) when VTpass returns it. `saveBeneficiary` saves the account once the bill succeeds, so a failed bill saves nothing; an account already saved is just linked. Transaction `bill` carries `product`, `meterType` and `planCode`, enough to buy it again.

Errors to handle: `INSUFFICIENT_FUNDS` (`errors.shortfall` in kobo; the quote stays valid, so top up and
retry), `PIN_INCORRECT`, `PIN_LOCKED` (423), `PIN_NOT_SET`, `QUOTE_EXPIRED` (410), `COUPON_*`,
`SERVICE_UNAVAILABLE` (water).

## Codes at checkout — coupons, gifts and Tela promos

The app has one code box. Send whatever the user types as `couponCode` on the bill quote; the API works
out what it is and what it's worth, and returns it in the quote:

```jsonc
"discount": 200000,
"coupon": { "code": "DECEMBER50", "kind": "promo", "title": "December 50% off", "auto": false }
```

Use `kind` only for display (a "Tela promo" badge vs "Gift from Ada"). One code per bill. Charges are
always priced on the full bill amount.

| kind | Value | Repeat use |
|---|---|---|
| `coupon` | The creator's fixed amount per person, spent as a **balance** across bills until expiry | Until the balance is spent (`COUPON_BALANCE_EMPTY`) |
| `gift` | Same, for one phone number only | Same |
| `promo` | % or fixed, capped per use, from Tela's budget | `usesPerUser` times; nothing carries over |

Without a code, the quote applies whichever takes more off: the user's own **gift/coupon balance**
(soonest-expiring first) or an **auto-apply promo** (`coupon.auto: true`); a tie goes to the promo, saving
their gift money. Send `autoApply: false` for full price.

Code errors (all 422): `COUPON_NOT_FOUND`, `COUPON_EXPIRED`, `COUPON_NOT_STARTED`, `COUPON_PAUSED`,
`COUPON_CANCELLED`, `COUPON_WRONG_SERVICE`, `COUPON_NOT_YOURS`, `COUPON_USED_UP`, `COUPON_BALANCE_EMPTY`,
`COUPON_MIN_SPEND`, `COUPON_LIMIT_REACHED`, `COUPON_AUDIENCE`, `COUPON_NOT_APPLICABLE`, `PROMO_ENDED`. At
purchase, `COUPON_BALANCE_CHANGED` / `PROMO_ENDED` mean something changed since the quote — re-quote.

Coupon objects keep the app's fields (`amount` per person, `quantity`, `redeemed` = people who claimed) plus
`remaining`, `myBalance: { allowance, used, left }`; promos carry `terms.summary`, e.g.
"50% off, up to ₦2,000 · bills from ₦1,000".

## Gifts — two kinds, one inbox

| | Gift balance | Pay their bill |
|---|---|---|
| Sender does | quote `{ kind: 'gift', recipient, amount, serviceId?, message? }` → `POST /gifts` | a normal bill quote plus `giftTo: { type, value }`, `giftMessage?` → `POST /bills/purchases` |
| Recipient gets | money for bills, applied **automatically** at checkout | the bill paid; token/PIN by SMS (no app needed) and in-app |
| Expiry | 30 days, then the rest goes back to the sender | none: paid once |
| Charge | paid by the recipient on each bill | paid by the sender |

The quote shows `giftTo: { recipient, name, onTela, message }`. The recipient is told only once the bill is
delivered (a failed bill refunds the sender and tells nobody). The sender's activity shows "Gift: IKEDC
electricity · For @mum".

**On the dashboard** (so a missed notification never means a missed gift):
- `GET /me` includes `gifts: { unseen, balance }` → a badge and a "₦X in gifts" card.
- `GET /gifts/inbox` → `{ unseen, balance, items[] }`: `type: 'balance'` (`from`, `left`, `expiresAt`, `message`) and
  `type: 'bill_paid'` (`from`, `serviceId`, `account`, `amount`, `token`/`pins`, `message`). Balances stay until
  spent or expired; paid bills for 90 days. It's built from the gifts themselves, not from notifications.
- `POST /gifts/inbox/seen { ids? }` clears the badge (all, or just those items).

A gift to a phone/email not on Tela yet is waiting in the inbox when they sign up with it.

**History:** `GET /gifts/history?direction=received|sent&page=` lists every gift in any state, newest first. A balance item has `type: 'balance'`, `amount`, `used`, `left`, `services`, `expiresAt`, `spentOn: [{ amount, serviceId, provider, reference, date }]` and `state`: `active`, `used_up`, `expired` or `cancelled` (`left` is 0 unless active). A paid bill has `type: 'bill'`, `serviceId`, `provider`, `account` and `state`: `delivered`, `pending` or `failed`. Both have `person`, `message`, `amount`, `date`.

## Points

Earned on successful bills (on what the user paid, after discounts) and on transfers sent. Funding earns nothing.
Rates are set by finance, so read them from the API rather than hard-coding them.

- `GET /points` → `{ active, balance, lifetimeEarned, value, pointValue, minRedeemPoints }` (`value` and `pointValue` in kobo)
- `GET /points/history?page=` → `{ items: [{ id, type: 'earn' | 'redeem' | 'forfeit', points, date, transaction }] }` (`transaction`: the payment that earned or spent the points, same shape as `/transactions`, or `null`)
- `POST /points/redeem { points, idempotencyKey }` → `{ transaction, summary }`. Generate the key once per conversion and
  reuse it on retry: the same key returns the original result. Errors: `POINTS_BELOW_MINIMUM`, `POINTS_INSUFFICIENT`, `POINTS_PAUSED`.

Points don't expire. Closing an account forfeits them, so convert first.

## Everything else

| App feature | Endpoint |
|---|---|
| Tela transfer | `POST /users/lookup` → quote `transfer` → `POST /transfers { quoteId, pin }` |
| Coupons | quote `coupon` → `POST /coupons { quoteId, pin }` → `{ transaction, coupon }` (`coupon` is `null` when the same quote is replayed; `POST /gifts` is the same) · `GET /coupons` (created by me) · `GET /coupons/balances` (coupons and gifts I've started spending, each with `myBalance: { allowance, used, left }`; what's left is applied at checkout until the coupon expires, then returns to whoever funded it) · `GET /coupons/code/:code` · `POST /coupons/:id/cancel` |
| Gifts | see **Gifts** above · `GET /gifts/inbox` · `POST /gifts/inbox/seen` · `GET /gifts/received` (balances only) |
| Tela promos | `GET /promotions` (banners this user can actually use: active, listed, not used up, and in the promo's audience) |
| Beneficiaries | `GET/POST /beneficiaries` · `GET/PATCH/DELETE /beneficiaries/:id`. No PIN. `POST` checks the account with VTpass first, as a bill quote does: a meter (send `meterType`, else `422 METER_TYPE_REQUIRED`), a smart card, a Smile email, a JAMB profile; phone-based services only need a valid number. An account VTpass doesn't recognise isn't saved (`422`, VTpass's reason). Saved ones carry `customerName`, the owner VTpass gave. |
| Auto-pay account for a saved meter / card | `GET /beneficiaries/auto-pay-terms` → `{ version, url }`, show them → `POST /beneficiaries/:id/virtual-account { acceptTerms: true, termsVersion }` → a permanent account number. Money sent to it buys that bill automatically; `PATCH { autoPay: false }` or deleting the beneficiary stops the purchase, but money still lands in the wallet. Old `termsVersion` → `409 TERMS_OUTDATED`. |
| Recurring | `GET/POST /recurring` (`{ …bill, frequency, startDate: 'YYYY-MM-DD', pin }`; `frequency`: `daily`, `weekly`, `biweekly`, `monthly`, `quarterly`, `yearly`) · `PATCH /recurring/:id { pin, label?, amount?, planCode?, frequency?, nextDate? }` (the account, provider and service can't change; a new amount or plan is re-priced) · `DELETE /recurring/:id` |
| Activity | `GET /transactions?kind=&serviceId=&status=&direction=&beneficiaryId=&page=` · `GET /transactions/:reference` (the polling endpoint for fundings and bills: re-checks the provider while pending) |
| Groups | `POST /groups { name, about?, requireApproval?, fields?: [{ label, required }], dues: [due], bankCode, accountNumber }` where a due is `{ name, kind: recurring\|one_off, period?: weekly\|monthly\|yearly (recurring), amount, compulsory? (default true), dueAt? (one-off deadline) }` (owner needs a BVN or NIN: `ID_REQUIRED`; the owner is the first member) · `GET /groups` (theirs, with `membership`; `membership.upcoming[] { dueId, name, kind, period, status: overdue\|due\|upcoming, periods, amount, date }` lists what's owed per compulsory due and the next period ahead, for Home) · `GET /public/groups/:code` (no sign-in, for the website's invite page: `{ name, logoUrl, requireApproval }`; 404 when suspended) · `GET /groups/join/:code` (the terms: who runs it, dues, payout account as `last4`) · `POST /groups/join { code, fields, acceptTerms }` (`acceptTerms` = the terms version shown: `GROUP_TERMS_CHANGED`) · `GET /groups/:id` (`membership.dues[]`: each due that's theirs with every `periods[] { index, start, end, status: paid\|due\|overdue\|optional\|upcoming }`; executives also get `inviteCode`, `payout`, `balance`, and `dues[].stats { current { start, members, paid }, outstanding, collected }`) · `PATCH /groups/:id` (executives: name, about, joining rules, questions) · `POST /groups/:id/logo` (multipart image, executives; `logoUrl` on the group) · `POST /groups/:id/terms { acceptTerms }` · `POST /groups/:id/dues { due }` (executives; a one-off is for today's members) · `PATCH /groups/:id/dues/:dueId { ended: true }` · `GET /groups/:id/dues/:dueId/report?year=&search=&page=` (members × every month or week of `year`, this year by default; a yearly due shows every year; `years` to filter by; per-column `members/paid/collected`, `totals`) · `GET /groups/:id/dues/:dueId/report.xlsx?year=&search=` (the same report as an Excel file, every member, amounts in naira) · `POST /groups/:id/invite-code` (new code) · `GET /groups/:id/members?status=pending\|active&owing=&search=` · `GET /groups/:id/members/:memberId` (their statement and backfills) · `POST /groups/:id/members/:memberId/approve\|reject` · `POST /groups/:id/members/:memberId/backfill { dueId, periods, note? }` (compulsory recurring dues only) · `DELETE /groups/:id/members/:memberId` · `POST/DELETE /groups/:id/executives` (owner) · `POST /quotes { kind: 'group_dues', groupId, items: [{ dueId, periods: [index] }] }` (each unpaid and theirs, else `DUES_CHANGED`) → `POST /groups/:id/pay { quoteId, pin }` · `POST /quotes { kind: 'group_payout', groupId, amount }` → `POST /groups/:id/withdrawals { quoteId, pin }` (to the payout account only; settles like ticket payouts) · `GET /groups/:id/withdrawals` (members see them too) · `POST /groups/:id/payout-change { bankCode, accountNumber, cosigners: [≥2 executive ids], pin }` (owner) · `POST /groups/:id/payout-change/approve { pin }` (co-signers) · `POST /groups/:id/payout-change/object { reason }` (any executive) |
| Split bills | `POST /splits { title, bill: { serviceId, provider, account, amount?, planCode?, product?, meterType? }, shares: [{ username, amount? }], hours? }` (shares without an amount share the rest equally; all must add up to bill + charge) · `GET /splits` (a bill split again is one entry: its latest round) · `PATCH /splits/:id { title?, hours? }` (starter, while open: rename it or move the deadline to `hours` from now; unpaid people are told) · `POST /splits/:id/again { hours? }` (once it's over: the same bill and people as a new split, priced afresh; custom shares kept unless the total moved; `SPLIT_STILL_OPEN`) · `GET /splits/:id` (once the pot has paid, `result { status, reference, paidAt, customerName, token, units, pins }` for everyone in the split; `history[] { id, status, total, myShare, createdAt, closedAt, result }`: the other rounds of the same bill, newest first) · `POST /quotes { kind: 'split_share', splitId }` → `POST /splits/:id/shares { quoteId, pin }` (the last share queues the bill, paid from the pot in the background: the split shows `paying` until it settles) · `POST /splits/:id/cancel` (starter, while collecting; everyone refunded) |
| Paying on the website (no sign-in) | `GET /guest/services` (electricity, airtime, exams, with providers and pauses) · `GET /guest/services/:serviceId/providers/:provider/plans` · `POST /guest/verify { serviceId, provider, account, meterType?, planCode? }` (15/min) · `POST /guest/orders { bill: { serviceId, provider, account, amount?, planCode?, product?, meterType? }, phone, email? }` → `201 { reference, key, status: awaiting_payment, payTo { accountNumber, bankName, accountName, expiresAt }, amount, fee, total, … }` (≤ ₦50,000: `GUEST_AMOUNT_LIMIT`; 5 a number a day: `GUEST_DAILY_LIMIT`) · `GET /guest/orders/:reference?key=` (checks the transfer while awaited; `status: awaiting_payment\|paying\|delivered\|failed`, `result { reference, token, units, pins }` once delivered, `inWallet` kobo held in the number's Tela wallet when it failed) |
| Tickets | `POST /me/nin` · `GET /seller` · `POST /seller { organisation, bankCode?, accountNumber?, acceptTerms }` (no PIN: nothing is paid) (bank both or neither) (opt in needs a BVN or NIN; `acceptTerms` is the current `termsVersion`; the bank names the account; buyers see the organisation, never the person; `wallet: { balance, held, available, holds }`) · `PATCH /seller { organisation?, about?, phone?, email?, website?, instagram?, acceptTerms? }` (a blank clears a field) (creating an event needs an organisation and the current terms: `ORGANISATION_REQUIRED` / `TERMS_REQUIRED`) · `POST /seller/logo` (multipart) · `GET /organisers/:id` (public page: `about`, `contact`, stats, `upcoming` events; `mine`: it's the caller's own) · `POST /seller/verification` (multipart: `idType` nin_slip|drivers_licence|passport|voters_card, files `photo` and `id`; images ≤5MB; `GET /seller` → `verification: { status: unsubmitted|pending|approved|rejected, reason }`, `suspension: { active, reason }`; creating events needs `approved`: `SELLER_NOT_VERIFIED`, and a suspended organiser gets `SELLER_SUSPENDED` on events and withdrawals) · `GET /seller/fees?price=` (what a ticket costs each side, from the charge rules) · `GET /seller/banks` · `POST /seller/bank-account/verify { bankCode, accountNumber }` · `PUT /seller/bank-account { bankCode, accountNumber }` (no PIN: nothing is paid, withdrawing there takes it; the name comes from the bank) · `POST /quotes { kind: 'ticket_payout', amount }` (needs a saved bank account: `BANK_ACCOUNT_REQUIRED`; `amount` reaches the bank, the fee comes on top) · `POST /seller/payouts { quoteId, pin }` (starts `pending`; settles when SaySwitch confirms) · `POST /seller/withdrawals { amount, pin, idempotencyKey }` (to the bill payment wallet; can't be undone) · `GET/POST /events` (create takes `phone` and optional `email`; every event carries `organiser: { id, name, logoUrl, verified, events, rating, ratings }` (`verified`: compliance approved them)) · `PUT /events/:id/rating { stars }` (1–5, only with a scanned ticket; replaces their earlier one; a scanned buyer who hasn't rated gets one reminder 2h after the event ends) · `GET /events/mine` · `GET /events/code/:code` · `GET /events/:id` · `GET /events/:id/manage` · `PATCH /events/:id { salesPaused, limits }` · `POST /events/:id/image` (multipart) · `POST /events/:id/gallery` (multipart photo ≤5MB or MP4/MOV video ≤50MB, up to 12; events carry `gallery: [{ id, kind, url }]`) · `DELETE /events/:id/gallery/:mediaId` · `GET /events/:id/sales` (organiser only: `purchases` newest first, `byTier`) · `POST/DELETE /events/:id/staff` · `POST /events/:id/scan { code }` · `POST /quotes { kind: 'ticket', eventId, tierId, quantity }` · `POST /tickets/purchases { quoteId, pin, holders }` (one name per ticket, 2–60 characters: `HOLDER_NAMES_REQUIRED`, and the quote stays usable) · `GET /tickets` · `POST /tickets/:id/refund` · admin: `GET /admin/events`, `POST /admin/events/:id/sales { paused }` |
| Insights | `GET /insights/:serviceId?months=6` → `{ series: [{ month, label, amount }], total, average }` · `GET /insights?period=this_month|last_month|3_months|6_months|this_year|all` (`spent` and `trend` are what left the wallet, charges included; the breakdowns and `biggest` are the items' own amounts, so they don't add up to `spent`) → where money went: `spent`, `previousSpent`, `changePercent`, `transactions`, `byCategory`, `byService`, `byProvider` (each `{ key, amount, count, share }`, biggest first), `saved`, `biggest`, `received` (`{ gifts, coupons }`, given to the user in the period, at full value), `points` (`{ earned, value }`, earned in the period and their cash value in kobo), `trend` (last 6 months), `recurringMonthly`. Spending is what left the wallet, charges included; unused coupon or gift money coming back is taken off. Bills bought for someone else count as gifts. |
| Notifications | `GET /notifications` · `POST /notifications/read { ids? }` |

Transaction items carry `type` (`payment`/`fund`/`transfer`/`gift`/`coupon`), `title`, `subtitle`,
`direction`, `amount`, `date`, `serviceId`, `beneficiaryId` — the same fields as the app's `ActivityItem` —
plus `status`, `charges`, `fee`, `total` and `bill`/`funding` details.

## Mapping notes for the app

- Data bundles: the app's `airtime` service with `product: 'data'` and a `planCode`.
- Provider names can be sent as shown in the app (`Glo`, `DStv`, `Smile`); responses use our codes (`GLO`, `DSTV`, `SMILE`).
- The app's providers that VTpass doesn't sell: LWC / FCT Water Board, Swift, NECO.
- `Coupon.amount` in responses is per redemption, as in the app's mock.

# Architecture

Same shape as eduspace-be (Fastify + Mongoose + Zod, `modules/<m>/{routes,service,schema,models}`,
`{ success, statusCode, data }` envelope, `AppError`, `parse()`), with what Estene and SurePlug added
(Fastify 5, helmet + Redis rate limits, typed event bus, BullMQ, rotating refresh tokens) and these
changes for a wallet product:

| Change | Why |
|---|---|
| Double-entry ledger **plus** a cached `Wallet.balance`, updated together in a Mongo transaction | SurePlug's ledger computes balances by aggregation, so two concurrent spends can both pass the balance check. Here a debit is `$inc` guarded by `balance >= amount` — it cannot overdraw. |
| Quotes (`POST /api/quotes`) for every money movement | The app shows exactly what will be charged; the action consumes the quote, so charge changes never surprise anyone mid-checkout and a double-tap can't pay twice. |
| Configurable `ChargeRule`s with specificity (scope › service › provider) | "We will have our charges setup" — finance edits them at `/api/admin/charges`; nothing is hard-coded. |
| `bills:in_flight` account and a requery queue | The wallet is debited before the vend; the money is never lost between debit and provider answer, and unknown outcomes are never auto-refunded. |
| Webhooks stored raw, processed from a queue | Some payloads aren't documented; we can fix a parser and replay. |
| Two providers behind two interfaces | SaySwitch (`PaymentGateway`) moves money in; VTpass (`BillerGateway`) vends bills from its prepaid wallet. Each has its own ledger account, so each can be reconciled against its own balance. |
| Per-phone OTP limits, per-user API limits | Nigerian carriers share IPs (CGNAT); per-IP limits would lock out real users. |

## Profit and loss

Income and expense accounts carry their dimension, so `/api/admin/reports/pnl` is a sum of real postings:
`revenue:charges:<scope>[:<service>]`, `revenue:commission:<service>`, `expense:provider_fees:<funding|collection>`,
`expense:promotions:<couponId>`, `expense:giveaways:<couponId>`. Net = charges + commission − absorbed
funding fees − promotions − giveaways. User-funded coupons aren't a Tasa cost (the creator paid).

## Money flows (ledger lines, kobo; assets +, liabilities −)

```
Funding     provider:sayswitch +(paid − fee) · expense:provider_fees:funding +fee · wallet −paid   (free to the user)
Bill debit  wallet +total   · coupon +discount · bills:in_flight −amount · revenue −fee
  delivered bills:in_flight +amount · provider:vtpass −cost · revenue:commission −(amount − cost)
  failed    exact reverse of the debit (wallet refunded, coupon slot released)
Transfer    sender +total   · recipient −amount · revenue −fee
Coupon/gift wallet +total   · coupon:<id> −pool · revenue −fee
  bill      discount line is coupon:<id> +discount
  close     unclaimed slots back to the owner when cancelled; claimants keep their balance
  settle    coupon:<id> +left · owner wallet −left   (at expiry)
Tasa promo  discount line on the bill debit is expense:promotions:<id> +discount (no pool; budget is a counter)
Tasa coupon/gift  same, to expense:giveaways:<id>; quantity × amount is the ceiling, nothing pre-funded
Collection  (money into a beneficiary account) = funding, then optional auto-pay bill
Ticket sale  buyer wallet +total · tickets:<organiser> −(amount − selling fees) · revenue:charges:ticket −fee · revenue:charges:ticket_sale −selling fees
  refund    tickets:<organiser> +(price − selling fee) · revenue:charges:ticket_sale +selling fee · buyer wallet −price  (the buyer's service charge stays)
  to wallet tickets:<organiser> +x · organiser wallet −x  (only what's outside a refund window; one way: wallet money never goes to a bank)
  to bank   tickets:<organiser> +total · payouts:in_flight −amount · revenue:charges:ticket_payout −fee   (quote-first, PIN)
    paid    payouts:in_flight +amount · provider:sayswitch −(amount + their fee) · expense:provider_fees:payout +their fee
    failed  exact reverse of "to bank" (SaySwitch says failed/reversed, or "not found" 10 min after sending)
Group dues   member wallet +total · group:<id> −(amount − group fee) · revenue:charges:group_dues −fee · revenue:charges:group_fee −group fee
  withdraw  group:<id> +total · payouts:in_flight −amount · revenue:charges:group_payout −fee   (quote-first, PIN; only to the group's locked account)
    paid / failed  as ticket payouts; a failure returns to group:<id> (the transaction's `fundedFrom`)
Split share  wallet +total · split:<id> −share · revenue:charges:split −fee
  bill      the last share pays it: split:<id> +total in place of the wallet line; a failed bill refunds the pot
  refund    split:<id> +share · wallet −share   (each paid share, when it expires, is cancelled, fails or the price changed)
VTpass top-up (admin) provider:vtpass +x · provider:sayswitch −x
```

## Groups and dues

A group's dues sit in `group:<id>`, never in a person's balance: executives change every session.
Members join only with the group's invite code and accept its terms, which name the payout account; the
acceptance (version, time, account shown) is kept on the member. The creator is the first member.

A group collects several dues (`Group.dues`), each recurring (weekly, monthly, yearly) or one-off, and
compulsory or optional. A member's periods start the day they're let in and repeat from it; month-based
ones keep their day, clamped to short months. A recurring due added later starts at the period it was
added in; a one-off applies only to people who were members when it was created. `GroupMember.paid`
lists every period paid, by due and index (a one-off's only period is 0; negative ones are arrears
executives backfilled). Members pick which periods to pay; the quote lists them and the payment marks them
paid by compare-and-set, so none is paid twice. Statuses are worked out, never stored
(`groups.dues.ts`): `paid`, `due` (current), `overdue` (past, or past a one-off's deadline), `optional`
(never owed) and `upcoming` (payable ahead). Prices never change: end a due and add another; ending keeps
what's owed and drops what an optional due didn't collect. Executives see each due as a grid of members
by calendar month (week, year), each member's period placed in the column it starts in.

Withdrawals go only to the group's payout account, copied into the quote and checked again at payment.
Changing that account: the owner proposes it with at least two executive co-signers (PIN); each must
approve within 72h; then it waits 48h, during which any executive can object; then it applies, the terms
version goes up, and members accept again before their next payment. Withdrawals stop while a change is
open, and a co-signer can't be removed mid-change. The payout engine is shared with ticket payouts
(`TicketsService.sendPayout` / `applyPayoutResult`, `PAYOUT_KINDS`).

## Split bills

The starter prices the bill (verified meter or card, plan price, the bill's charge) and names who pays
what; shares add up to bill + charge. Each share goes into `split:<id>`. The share that fills the pot sends
the bill: priced again (if the face value moved, everyone is refunded), the charge kept at what the shares
covered, then bought through `BillsService.purchase` with the pot as `fundedFrom`. Its outcome settles the
split (`bill.succeeded` / `bill.failed`); an unknown vend waits, like any bill. A split still collecting at its
deadline, cancelled by the starter, or whose bill failed gives every paid share back. Pot-paid bills earn no
points and aren't in the starter's spending (their share is).

`cost` is VTpass's `total_amount` — face value minus its commission.

## Paying on the website (guest orders)

The website sells one-off bills without the app: JAMB and WAEC PINs, electricity, airtime
(`src/modules/guest`). No new money flow: a guest order is an ordinary one-time **funding** of the
wallet belonging to the buyer's phone number, then an automatic **bill** from that wallet.

- The phone number's Tasa account is found or created (`UsersService.findOrCreate`, the same as a
  first OTP). Whoever later signs up with that number owns it, and its wallet.
- The transfer is credited only by `WalletService.reconcileFunding` (SaySwitch re-verified), from
  the webhook, the status page's poll, or the funding sweep. `funding.succeeded` claims the order
  and queues `guest.pay`.
- `guest.pay` prices the bill again and buys it only if the price held **and the order's own
  credited transfer covers the total**: never anything else in the wallet, since the number may
  belong to someone with money of their own there.
- A failed bill refunds to that wallet as any bill does; a short transfer, a moved price or a
  provider that won't take it leave the transfer there. Nothing goes back to a bank. The buyer is
  texted (and emailed, if given) the PIN or token, or where the money is.
- Limits: ₦50,000 a total, five orders a number a day, per-IP throttles. The status page needs the
  secret key the order was created with. `guest_pay` switches it all off.

## Codes: coupons, gifts, promos

One `Coupon` collection, one code namespace, `kind` picks the rules. A `CouponClaim` is one user's share
of one code (balance for coupons/gifts, use count for promos); a `CouponUse` is one bill's use, so a failed
bill gives back exactly what it took: balance, use, promo budget and, if it was the user's only use, the
claim slot. All of it moves inside the bill's purchase/refund transaction with compare-and-set guards
(`used + x ≤ allowance`, `spent + x ≤ budget`, `uses < usesPerUser`), so racing payments can't overspend.

Promo guard-rails: percentage promos must have a `maxDiscount`; fixed promos without `minSpend` and other
easy-to-farm setups come back with `warnings` on save. Audiences: `all`, `first_bill`, `bvn_on_file` (BVN
isn't verified yet, so this only means "entered").

## Transaction states

`pending → success | failed | expired`. Fundings go `expired` only for the UI — a late transfer is still
credited. Bills stay `pending` while VTpass hasn't given a final answer; requery runs at 30s, 2m, 5m, 15m, 30m, 1h,
then the bill is flagged `needsReview` for `/api/admin/transactions/:id/resolve`. A VTpass webhook triggers
an extra requery without moving the schedule.

How VTpass answers map to outcomes (`providers/vtpass.ts` → `classify`):

| VTpass says | We do |
|---|---|
| `000` + status `delivered` | success — token/PINs saved, commission booked |
| `000` + `pending`/`initiated`, `099`, `089`, `083`, `044`, `014` | keep pending, requery |
| `016`, `040`, `091`, `018` (low wallet), `019`, `027`/`028` (not whitelisted), other documented rejections | refund |
| `015` on requery (never received) | refund — but only 5 min after sending, in case the request is still in flight |
| timeout, 5xx, unreadable, unknown code | keep pending, requery |

## Background jobs (`src/jobs/maintenance.ts`)

| Job | Every | Does |
|---|---|---|
| `fundings.sweep` | 5 min | Expires old funding accounts; re-verifies unsettled ones (missed webhooks) |
| `bills.sweep` | 5 min | Sends bills debited but never sent (crash), requeries ones whose schedule was lost |
| `coupons.sweep` | 10 min | Expires coupons; returns unused pool money to owners |
| `payouts.sweep` | 10 min | Sends ticket payouts taken from the wallet but never sent (crash), requeries ones whose schedule was lost |
| `recurring.run` | 15 min | Pays due recurring bills (claimed atomically — safe with many instances) |
| `recurring.reminders` | 08:00 Lagos | "Top up for upcoming bills" when the wallet can't cover the next 3 days |

## Confirm in sandbox before go-live

Checked against both providers' docs on 2026-10-28. Marked `UNVERIFIED` in the adapters.

**VTpass** (`modules/bills/providers/vtpass.ts`)
1. Request bodies as JSON — the docs never state the content type.
2. `GET /balance` response shape (`contents.balance`).
3. TV verify: the docs mention `Current_Bouquet`, but the sample and sandbox omit it, so it's shown only when present.
   TV always needs a package: renewing means buying the same one.
4. Webhooks are unsigned, so they can only trigger a requery — never move money.
5. Live needs the server IP and each product whitelisted on the VTpass account (`027` / `028` otherwise).

**SaySwitch** (`modules/payments/providers/sayswitch.ts`)
0. Collection fee: confirmed 2026-10-28 that the transaction webhook carries `fees` (e.g. `"75.00"` on a
   `"5000.00"` payment, merchant-borne). We book it from verify or the signed webhook, whichever reports it;
   if polling credits first, the webhook's fee is posted afterwards (`funding:<ref>:fee`, once).
1. Dedicated accounts: the create response shape. Attribution doesn't depend on webhook field names: we
   read `customer.customer_code` from SaySwitch's verify and map it to our `DedicatedAccount` (one SaySwitch
   customer per account, synthetic email `w<userId>@…` / `b<beneficiaryId>@…`). Confirm verify returns it.
   SaySwitch documents **no endpoint listing credits into a dedicated account**, so a missed webhook is
   recovered by support (`POST /api/admin/collections { reference }`). Ask SaySwitch: webhook retry policy,
   and whether such a list endpoint exists — then add a sweep job.
   KYC: whether CBN/SaySwitch require BVN/NIN before issuing permanent accounts (not in their docs).
2. Amounts are decimal naira strings (matches every sample and attesta-one's findings).
3. Ticket payouts (`POST /api/v1/bank_transfer`, `GET /api/v1/payout/:reference`), read 2026-11-01. `amount`
   and `fee` are naira (confirmed with SaySwitch, though the docs say "smallest unit"); kobo inside Tasa. Statuses differ per page
   (`pending`/`completed`/`failed` vs `success`/`pending`/`reversed`/"etc"): success|completed pay out,
   failed|reversed return the money, anything else stays pending → requery at 1m, 5m, 15m, 1h, 3h, 12h →
   `needsReview` (resolve with `/api/admin/transactions/:id/resolve`). Confirmed with SaySwitch: the payout
   `fee` comes out of our wallet on top of `amount` (the recipient gets all of it) and is in the create reply,
   the status and the webhook. We keep the fee quoted at create and book it when the payout settles, so a
   status or webhook that leaves it out still costs it; a signed payout webhook's `fee` is used the same way,
   but its outcome only triggers a requery. Still unstated: whether a reused `reference` is rejected.
   Wallet money has no way to a bank, by design.

Not sold by VTpass: water bills, NECO PINs, Swift internet. `GET /api/bills/services` reports water
`available: false`; the others are simply absent from the provider lists.

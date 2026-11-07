# Tasa API — working conventions

Backend for the Tasa app (`../tela`, Expo). Read `docs/architecture.md` before changing money logic.

## Layout

- `src/modules/<name>/`: `<name>.routes.ts` (thin: `parse` → service → `send`), `<name>.service.ts`
  (all logic), `<name>.schema.ts` (Zod), `models/*.model.ts`, optional `*.listeners.ts` / `*.worker.ts`.
- `src/lib/` shared helpers, `src/plugins/` Fastify plugins, `src/jobs/` repeatable jobs.
- Responses are always `{ success, statusCode, data | code+message+errors }` via `send()` / `AppError`.

## Rules

- **Money is integer kobo** everywhere, including responses. Only the provider adapters (SaySwitch, VTpass) convert to naira,
  plus files made for people to read (the group report's Excel export, `groups.export.ts`).
- **Wallets change only through `LedgerService.post`**, inside `inTransaction`. Postings must balance to zero
  and carry a deterministic key. Never `$inc` `Wallet.balance` anywhere else.
- **Every debit is quote-first**: `POST /api/quotes` prices it (charges itemised), the action endpoint consumes
  the quote by id inside the same transaction. One transaction per quote (unique index) = idempotency.
  The one exception prices nothing: closing an account forfeits a balance under ₦100, confirmed by exact amount.
- **Never trust a webhook body.** SaySwitch: re-verify (`gateway.verify`) before crediting. VTpass webhooks are
  unsigned and only ever trigger `BillsService.requery`.
- **Never refund an unknown vend.** Only an explicit VTpass rejection (or `015` after the grace period) refunds;
  timeouts/5xx stay `pending` and go to requery → `needsReview`.
- A VTpass `request_id` is generated and saved *immediately before* `/pay`, once per bill (`vend` claims it by CAS).
- Status changes are compare-and-set (`findOneAndUpdate({ status: 'pending' })`) in the same transaction
  as their ledger posting.
- Only bill purchases may skip the PIN (`PinService.authorizeBill`, the user's choice, reset at every OTP sign-in). Every other debit uses `PinService.verify`.
- Charges come from `ChargeRule` docs (admin-managed), never hard-coded in a service. Points rates live in `PointsSettings` the same way.
- Points only touch the ledger when converted (`expense:points` → wallet). `PointsBalance` changes only with a `PointsEntry`, in `PointsService`.
- Ticket money sits in `tickets:<userId>` until withdrawn. Tickets inside their refund window can't be withdrawn: every withdrawal bumps `Seller.withdrawals` first, so two can't spend the same balance.
- Ticket money leaves two ways: to the seller's bank (`ticket_payout`, quote-first, settled only when SaySwitch confirms,
  returned only on an explicit failure) or one-way to their wallet. Wallet money never goes to a bank: no cash-out from funding.
- Group dues sit in `group:<groupId>` and leave only to the group's payout account (copied into the quote, checked again at payment).
  Changing that account takes the owner + ≥2 co-signing executives, a cooling-off, and members re-accepting the terms. Never let it change any other way.
- A website (guest) order is a funding of its phone number's wallet plus a bill from it, bought only if that order's own transfer covers it.
  Whatever isn't spent stays in that wallet (claimed by signing up with the number); nothing goes back to a bank.
- A split bill is paid only from its pot (`split:<id>`, the transaction's `fundedFrom`); a split that won't be paid refunds every paid share.
- Student ID cards are stored encrypted (`encryptBytes`) and opened only through compliance routes that log the view first.
  A verified student's matric number is one account per school (unique index); changing school, department or matric undoes verification.
  Groups don't depend on student profiles: a class is an ordinary group its rep invites people to.
- Cross-module side effects (notifications) go through `bus.emit` + a listener; slow work goes to BullMQ.
- No simulators: tests fake SaySwitch and VTpass at `fetch`; manual testing uses their sandboxes.
- Never return `pinHash`, `bvnCipher`, `ninCipher` or refresh tokens. BVN leaves the server as `last4` only, with one
  exception: `POST /admin/users/:id/bvn/reveal` (compliance, pending BVNs only, logged before decrypting).

## Verify

`npm run typecheck && npm test` — the integration suite checks the books balance after every flow.

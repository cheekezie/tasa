# Admin API

Base `/api/admin`. Sign in with `POST /api/auth/admin/login { email, password }` → `{ accessToken, refreshToken, admin }`.
Every request re-checks the admin's account, so deactivation and role changes apply immediately.
Roles: **super_admin** (everything), **finance** (money), **support** (users, requeries, pausing coupons), **compliance** (BVN review).
All money is kobo.

## Staff — super_admin
| | |
|---|---|
| `GET /me` · `POST /me/password { currentPassword, newPassword }` | any admin. A wrong current password is `422 PASSWORD_INCORRECT`; success ends every session, this one included |
| `GET /staff` · `POST /staff { name, email, role, password }` | |
| `PATCH /staff/:id { name?, role?, isActive? }` | Deactivating signs them out everywhere. You can't demote/deactivate yourself or the last super admin. |
| `POST /staff/:id/password { password }` | Reset; signs them out |

## Charges — finance writes
`GET /charges` · `GET /charges/preview?scope=&serviceId=&provider=&amount=` · `POST /charges` · `PATCH /charges/:id` · `DELETE /charges/:id`

Business rule: funding is free to users (Tasa absorbs SaySwitch's fee); every transaction carries a charge.
Seeded placeholders: bills ₦20 (airtime/data and anything unlisted), electricity ₦100, TV/internet/water ₦50,
exams ₦150; transfers ₦10; gifts ₦20; coupons 1% (₦50–₦1,000). Set real figures before launch.

## Coupons and giveaways
| | |
|---|---|
| `GET /coupons?kind=&fundedBy=&status=&owner=&code=` | Every user and Tasa coupon/gift, with stats |
| `GET /coupons/:id` | Tasa: `stats.cost`, `maxExposure`, `exposureLeft`. User: `stats.poolLeft`. `claims`: who claimed, allowance, used, left. Rows carry `ownerName`, `createdByName`, `closed`, `closedAt` |
| `POST /coupons` (finance) | Tasa-funded: `{ kind: 'coupon', title, amount, quantity, services?, code?, expiresAt }` or `{ kind: 'gift', title, amount, recipient: { type: 'username' | 'phone' | 'email', value }, recipientName?, message?, expiresAt }`. A gift notifies the recipient (in-app + SMS/email), or invites them if they aren't on Tasa. |
| `POST /coupons/:id/pause` · `/resume` · `/close` (finance, support) | Close stops new claims; a user's unclaimed money goes back to them; claimants keep their balance until expiry |

Tasa coupons hold no money: each use is booked to `expense:giveaways:<id>` as it happens.

## Promotions — finance writes
`GET /promotions` · `GET /promotions/:id` · `POST /promotions` · `PATCH /promotions/:id` (incl. `status: 'paused' | 'active'`) · `POST /promotions/:id/end`
— see `docs/api.md` for the rules. Each discount is booked to `expense:promotions:<id>`.

## Reports — `?from=YYYY-MM-DD&to=YYYY-MM-DD` (Lagos days, inclusive; default last 30 days)
| | |
|---|---|
| `GET /reports/overview` | Users, wallet liability, funding/bill/transfer volume, bill success rate, items needing attention, revenue/costs/net |
| `GET /reports/pnl` (finance) | Revenue (charges by scope and service, VTpass commission by service), costs (SaySwitch fees we absorb by source — funding, collection, payout, topup — promotions and giveaways by campaign, points), net, daily `series`, and `caveats`: fundings/payouts SaySwitch gave no fee for (costs higher than shown), bills VTpass gave no cost for (no commission booked), and charges on bills still pending (they reverse if those fail) |
| `GET /reports/giveaways` (finance) | Every Tasa coupon, gift and promo: uses, people, cost in period, cost to date, ceiling, exposure left |

P&L is a sum of ledger postings, so it reconciles with the books by construction. A refunded bill reverses its
charge in the period of the refund. `costs.fundingFees.unreportedCount` counts fundings where SaySwitch didn't
report its fee — until that's confirmed in sandbox, the true funding cost may be higher than shown.

## Operations
`POST /collections { reference }` (finance, support) — credit a transfer into a permanent account whose webhook
never came: SaySwitch is asked again and says whose account it was; can't double-credit.

`GET /transactions?status=&kind=&needsReview=&channel=app|web&user=&reference=` (rows carry `userName` and `channel`; a website order's `TSY…` reference finds its transfer and its bill) · `GET /transactions/:id` (events + ledger lines; `guestOrder` for a website order: phone, email, status, why it failed, its other transaction)
· `POST /transactions/:id/requery` (finance, support) · `POST /transactions/:id/resolve { outcome, token?, cost?, note }` (finance; `cost` is the kobo VTpass kept, so a delivered bill books its commission)
· `GET /users?search=&status=active|suspended|closed` · `GET /users/:id` (wallet vs ledger check) · `POST /users/:id/status` (support)
· `GET /users?bvnStatus=pending` · `POST /users/:id/bvn { status: 'verified', fullName? }` or `{ status: 'rejected', reason }` (compliance): `409 BVN_NOT_PENDING` if already decided; the user is notified. `attention.pendingBvn` on the overview counts the queue
· `POST /users/:id/bvn/reveal { reason }` → `{ bvn }` (compliance): the only way to see a full BVN. Pending BVNs only, 30 an hour, never cached, and it refuses if the access can't be logged first. Everywhere else shows `last4`
· `GET /ledger/summary` (every account group, raw signs; sums to zero) · `GET /ledger/vtpass` (`vtpass: null` and `vtpassError` when VTpass doesn't answer; our books still show) · `POST /ledger/vtpass-topups { amount, from, fee?, note, idempotencyKey }` (`fee`: what SaySwitch charged to send it, booked as a cost) (generate the key once per top-up: resubmitting returns `duplicate: true`) · `GET /webhooks` (no raw bodies) · `GET /webhooks/:id` (finance) · `POST /webhooks/:id/replay` (finance; answers with the event, its `error` set if processing failed again)

`GET /transactions` also takes `from` and `to` (a Lagos day `YYYY-MM-DD`, inclusive, or an exact ISO time); `GET /users?search=` also matches names. Suspending a user ends their sessions and blocks every debit at once, including recurring bills and auto-pay; closed accounts can't be reactivated (`ACCOUNT_CLOSED`).

## Events — support, finance
`GET /events` — the latest 200 events with the organiser's view: tiers sold, gross, check-ins, staff, `salesPaused` (organiser) and `adminPaused` (Tasa).
`POST /events/:id/sales { paused }` — Tasa's own pause. The organiser can pause and resume their own sales, but never a Tasa pause.

Ticket withdrawals to a bank are transactions of kind `ticket_payout`: they start `pending`, settle when SaySwitch confirms,
and are requeried on a schedule (1m, 5m, 15m, 1h, 3h, 12h) before being flagged `needsReview`. Resolve one with
`POST /transactions/:id/resolve { outcome, note }` (finance): `delivered` = the bank received it; `failed` = it never left,
so the full amount, fee included, goes back to the seller's ticket wallet. Charge rules for them use scope `ticket_payout`.

## Organisers — compliance, support, finance read; compliance decides
Organisers send a photo of themselves and of an ID before they can create events. The files are encrypted in R2
(the bucket is public) and only ever leave the server through the document endpoint below. Resubmitting keeps the
earlier files, so a new pair can be checked against the one that was rejected.

| | |
|---|---|
| `GET /sellers?verification=pending\|approved\|rejected\|unsubmitted&suspended=true\|false&search=` | Paginated. `pending` reads oldest first (the review queue). Rows: name, organisation, logo, verification, suspension, events |
| `GET /sellers/:id` | One organiser (`:id` = their user id): profile, contacts, KYC last4s, verification (incl. `reviewedBy`, `hasDocuments`, and `history`: every earlier submission, newest first, with its outcome, reviewer and reason; `pending` there means replaced before review), suspension, bank account, ticket balance |
| `POST /sellers/:id/documents/photo` · `/id` `?submission=<history id>` (compliance) | The decrypted image (`image/*`, `no-store`), from the current submission or, with `submission`, an earlier one. Logged in the audit trail (with the submission) before it's decrypted |
| `POST /sellers/:id/review { status: 'approved' }` or `{ status: 'rejected', reason }` (compliance) | Pending only (`409 SELLER_NOT_PENDING`). The organiser is notified either way, with the reason |
| `POST /sellers/:id/suspension { suspended: true, reason }` or `{ suspended: false, reason? }` (compliance, support) | Suspending pauses every event of theirs as Tasa, blocks new events and holds withdrawals (`SELLER_SUSPENDED`); tickets already sold, refunds and door scans keep working. Lifting it resumes exactly the events it paused. They're notified. `GET /sellers/:id` returns `suspension.history`: every suspend and lift, who, why, when, newest first |

`GET /events?search=&sales=on_sale|paused|ended|tasa_paused&owner=` is paginated; `search` matches title, venue or organisation by any part, or the exact code (so does the app's `GET /api/events?search=`). Un-pausing one event of a
suspended organiser is refused: lift the suspension instead.

## Groups — compliance, support, finance read; compliance and support suspend
| | |
|---|---|
| `GET /groups?search=&suspended=true\|false` | Paginated, newest first. `search` matches the name, an exact invite code, or an executive's name/username/phone. Rows: owner, active members, `balance` (kobo held), suspended |
| `GET /groups/:id` | Dues (kind, period, amount, compulsory, deadline, ended), fields, the payout account, executives, member counts, `collected`, recent withdrawals, payout account changes (who proposed, co-signers and when they approved, who stopped it and why), suspension with history |
| `POST /groups/:id/suspension { suspended: true, reason }` or `{ suspended: false, reason? }` | Stops joining, dues, withdrawals and payout account changes (one already cooling off waits and applies after the lift). The money stays the group's. Executives are told |

## Students and schools — compliance and support read; compliance decides
| | |
|---|---|
| `GET /schools?active=&search=&page=` | Every school, with `students { verified, pending }`. Only `active` ones are offered in the app |
| `POST /schools { name, shortName, kind: university\|polytechnic\|college, ownership?: federal\|state\|private, state, website?, emailDomains[], active }` · `PATCH /schools/:id` · `POST /schools/:id/logo` (multipart image) | `emailDomains` (e.g. `live.unilag.edu.ng`, subdomains included) let students verify with a code to their school email; none means ID card only. `npm run seed:schools` adds every NUC-listed university plus the main polytechnics (`schools.data.ts`), all switched off, and copies each logo it can find (Wikipedia, else the website's icon) |
| `GET /schools/:id` · `GET /schools/:id/faculties` · `PUT /schools/:id/faculties { faculties[{ name, departments[] }] }` (compliance, support) | The school's own list (empty = students get the general one, returned as `general`), plus `unlisted`: departments students typed that aren't on it, with counts, to add |
| `GET /students?status=unsubmitted\|pending\|verified\|rejected&schoolId=&search=` | Paginated; the pending queue oldest first. `search` matches name, username, phone, email, matric number or department |
| `GET /students/:id` | The profile, the account and `verification { …, hasCard, reviewedBy }`. Ids are the user's |
| `POST /students/:id/card` (compliance) | The ID card photo, decrypted, `no-store`. Logged before it's decrypted |
| `POST /students/:id/revoke { reason }` (compliance) | Takes back any verification (`STUDENT_NOT_VERIFIED` otherwise); only another ID card review verifies them after that |
| `POST /students/:id/review { status: 'verified' }` or `{ status: 'rejected', reason }` (compliance) | Pending only (`409 STUDENT_NOT_PENDING`); `MATRIC_TAKEN` if another account was verified with that matric number meanwhile. They're notified |

## Switches and maintenance
`GET /config` (any admin) → what the app sees, plus `labels` per feature and `maintenanceStartedAt`.
`PATCH /config/features { <key>: { enabled, message? } }` (support, super_admin) — any subset; reaches every instance within 15s.
Switching off stops new quotes and actions of that kind only: requeries, refunds, webhooks and incoming transfers carry on.
Recurring bills wait while `recurring` or `bills` is off and pay once it's back on.
`PUT /config/maintenance { active, message?, until? }` (super_admin) — every app call except `/api/config` gets `503 MAINTENANCE`;
the back office and webhooks stay up. `until` is only shown: maintenance ends when it's switched off.

## Points
`GET /points` → `{ settings, outstanding: { points, value } }` (any admin) · `PATCH /points { active?, billPointsPer100Naira?, transferPoints?, pointValue?, minRedeemPoints? }` (finance).
Converted points are booked to `expense:points` and appear under `costs.points` in the P&L. `outstanding` is the cost still to come; it isn't on the ledger until points convert. Keep a transfer's points worth less than its charge, or looping transfers earns money.

## Audit — finance, super_admin
`GET /audit?admin=&page=` — every back-office change (rows carry `adminName`), including refused attempts: who, route, target, status, allow-listed fields (never passwords).

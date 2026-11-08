# Campus Plans — proposal

Status: **proposal, not started.** We launch with what's built today and come back to this.
Written 2026-11-07.

## Where we are

- Student profiles and schools exist in the API and admin: school, faculty, department, programme,
  level, matric number, verified by school email or an ID card staff review. 328 NUC universities
  plus polytechnics are seeded (inactive until staff switch a school on).
- Groups no longer depend on students. A class is an ordinary group its rep creates and shares by
  link. Campus discovery, class vouching and group verification were removed as unnecessary.
- For launch, the app shows **no student entry point**: the Campus tile is gone from Services and
  the Student profile item is gone from Profile. The `/student` screen and API remain, dormant,
  for this feature.

## The idea: Plans

Students start outings and trips, classmates join, and **everyone pays their share into one pot**.
Tasa holds the money and releases it only if the plan happens.

### Why this, for Nigerian students

- Students already organise beach days, owambes, department dinners, trips and rides home in
  WhatsApp groups. It always breaks at the same point: **the money**. One person fronts the cost,
  chases transfers, counts screenshots; people say "I'm in" and vanish; strangers from other
  departments don't trust each other.
- Tasa already has the pieces: split-bill pots (held, paid out or refunded), verified student
  profiles, events and tickets, gifts and points.
- It's naturally viral: every plan pulls new students in, and people who go to one start the next.

### How a plan works

1. **Start a plan.** e.g. "Lekki beach day, Sat 14th, ₦8,500 each (bus + entry), minimum 15
   people". Type: hangout, trip, party, going home, study session.
2. **It shows on Campus** to verified students at the organiser's school, filtered by date and
   type. The organiser can open it to other schools, or share a link.
3. **Joining means paying.** Each share goes into the plan's pot. A progress bar shows
   "11 of 15 in, 3 days left".
4. **Goes ahead only if enough people join.** At the minimum, the money is released to the
   organiser (or a named vendor) shortly before the date. Below it at the deadline, everyone is
   refunded automatically. No more "I paid and it didn't happen".
5. **Afterwards:** photo wall, who went, and an organiser rating. Good organisers get a badge, so
   their next plan fills faster.

### Plan types worth building in

- **Going home**: shared bus at the end of semester ("UNN → Lagos, Dec 18, 18 seats"). A big,
  recurring need, twice a year, with real money.
- **Cross-campus**: "UNILAG × LASU beach day". Social discovery, done safely: everyone is a
  verified student.
- **Department socials** and dinners, linked to an existing group or ticketed event.

## Retention (phase 2+)

- **People you've met**: after a plan, see who went and follow them. Discovery through shared
  experiences, not a directory of strangers.
- **School vs school**: monthly leaderboard of the most active campus, with points and prizes.
- **Campus organisers / ambassadors**: well-rated organisers earn points or a small cut.

## Safety (part of the design)

- Only verified students can start plans.
- Everyone shows a verified badge, their school and level. Phone numbers are never shown.
- Women-only plans.
- Report a plan; staff can pull it (and refund everyone).
- Organiser payout held until close to the date; organiser needs a BVN or NIN on file.

## Phasing

| Phase | Scope |
|---|---|
| **1 (MVP)** | Plans at your school: create, join and pay into a pot, minimum headcount with auto-refund, organiser payout, report. Campus tile back in Services; Student profile back in Profile. |
| **2** | Going-home rides, cross-campus plans, photo wall, ratings, "people you've met". |
| **3** | School leaderboards, organiser rewards, linking plans to ticketed events. |

## Money, in the house rules (for the technical plan)

Should follow the existing rules in `CLAUDE.md`:

- A plan's pot is its own ledger account (like `split:<id>`); shares are quote-first debits from
  the wallet with the PIN.
- Paid out only to the organiser's verified bank account (copied into the quote, like group
  payouts) or refunded to every payer's wallet; never both, never partially without a rule.
- Status changes compare-and-set with their ledger posting; deadlines handled by a repeatable job.
- Charges from `ChargeRule`, not hard-coded.

## Open decisions

1. **Who can join**: verified students only, or anyone with the link (only verified students can
   create)? Leaning: verified only on Campus, plus a shareable link for friends outside.
2. **Where the money goes**: organiser's bank (like ticket payouts, released ~24h before the date)
   or only a named vendor? Leaning: organiser's bank, BVN/NIN required.
3. **Pilot**: one school (UNN?) or the six already switched on?
4. **Fee**: a small charge per share, on the organiser's payout, or free to start?

Next step once these are answered: a technical plan (models, money flow, screens) before building.

# Build prompt — "Owing", a personal instalment-tracking dashboard

> Paste everything below the line into Claude Code or Cursor at the root of an empty
> repo. It is written as a single standing brief: the agent should read it all, ask
> about anything genuinely ambiguous, then work through the milestones in order.
>
> Before you paste: replace `Owing` with your app name, and swap the palette in
> §5 for your own colours. Everything else works as-is.

---

## 0. What you are building

A **personal finance dashboard** called **Owing**. It is a private, single-user
web app that tracks money I owe across buy-now-pay-later providers, store
finance plans and instalment arrangements, and shows me what is due and when.

It is **read-only with respect to money**. It does not process payments, does not
connect to any lender, does not store card numbers, and is not a lending product.
Data gets in by manual entry and CSV import. The app's job is to answer three
questions at a glance: *what do I owe in total, what's due next, and what is this
particular order costing me once fees are counted.*

Important: this is my own product. Do not use any real company's name, wordmark,
logo, brand colours or copy anywhere in the code, the seed data or the UI. Seed
data must use obviously invented merchant names. If you need a placeholder logo,
draw an initial-chip from the merchant's name — do not fetch or embed real brand
marks.

## 1. Stack

- **Next.js 15**, App Router, TypeScript strict mode.
- **PostgreSQL** with **Drizzle ORM** and Drizzle Kit migrations.
- **Auth.js (NextAuth)** with a single credentials provider plus a passkey option;
  one account, but build it properly — sessions in the database, no hard-coded user.
- **Tailwind CSS** for layout, with the design tokens in §5 defined as CSS custom
  properties on `:root` and referenced through Tailwind's theme config. Do not
  hard-code hex values in components.
- **Zod** for every API boundary, shared between server and client.
- **Vitest** for unit tests, **Playwright** for two or three end-to-end flows.
- `pnpm`. Docker Compose for local Postgres.

No component library. Build the handful of primitives you need (Card, Table, Badge,
Button, Tabs, Chip, Timeline) in `components/ui/`. They are simple and I want to own them.

## 2. Data model — the part that matters most

The whole design rests on one decision: **money is never a float, and never a single
balance**. Two rules:

**Rule 1 — Money is a value object.** Every monetary field is stored as an integer
number of minor units (cents) plus a currency code, and crosses the API as:

```ts
type Money = { amount: string; currency: string; symbol: string }  // { "amount": "40.00", "currency": "NZD", "symbol": "$" }
```

A *string*, so no float drift, and it carries its own currency and symbol so the UI
never has to guess how to render it. Write `toMoney(cents, currency)` and
`fromMoney(money)` helpers once in `lib/money.ts` and use them everywhere. Never do
arithmetic on the string form. Add unit tests for rounding, negative amounts and
currency mismatch (mixing currencies in an addition should throw).

**Rule 2 — Store the ledger, not the balance.** Do not keep one `amountOwed` column
and mutate it. Every stage of the money's life is its own field, and derived totals
are computed, never stored stale.

### Tables

```
user            id, email, name, createdAt

provider        id, userId, name, kind ('bnpl'|'store_finance'|'loan'|'other'),
                website, supportPhone, notes, colorSeed
                -- colorSeed drives the initial-chip background deterministically

order           id, userId, providerId,
                reference,            -- my own or theirs, free text
                channel ('online'|'in_store'),
                purchasedAt,
                totalAmountCents,     -- what the order cost
                currency,
                instalmentCount,
                status ('active'|'settled'|'cancelled')  -- DERIVED on write, see below
                notes, createdAt, updatedAt

instalment      id, orderId, sequence (1-based), dueOn (date),
                principalCents,       -- the scheduled amount
                paidCents,            -- total settled against it
                pendingCents,         -- taken but not cleared
                waivedCents,
                createdAt, updatedAt

fee             id, instalmentId, kind ('late'|'establishment'|'other'),
                amountCents, incurredOn, note

payment         id, instalmentId, amountCents, paidOn,
                method ('card'|'bank'|'cash'|'other'), reference

refund          id, orderId, amountCents, refundedOn, note
```

### Derived values — compute these, never store them

Put these in `lib/ledger.ts` as pure functions over the loaded rows, with thorough
unit tests. This module is the heart of the app; treat it that way.

```
instalment.feesTotal      = sum(fees.amountCents)
instalment.amountWithFees = principalCents + feesTotal
instalment.amountOwed     = max(0, amountWithFees - paidCents - waivedCents)
instalment.amountPayable  = max(0, amountOwed - pendingCents)
instalment.state          = 'paid'     if amountOwed == 0
                          | 'pending'  if pendingCents > 0 and amountPayable == 0
                          | 'overdue'  if dueOn < today
                          | 'upcoming'

order.totalPaid           = sum over instalments of paidCents
order.totalFees           = sum over instalments of feesTotal
order.amountRefunded      = sum(refunds.amountCents)
order.owedAmount          = sum over instalments of amountOwed
order.pendingAmount       = sum over instalments of pendingCents
order.owedWithoutPending  = owedAmount - pendingAmount
order.totalAfterRefunds   = totalAmountCents - amountRefunded
order.trueCost            = totalPaid + owedAmount - amountRefunded
order.status              = 'settled' if owedAmount == 0 else 'active'
```

Note `order.status` is **derived from `owedAmount > 0`**, not set by hand. Keep the
column as a materialised cache if you want fast list queries, but recompute it in a
single place on every write and add a test that the cache can never disagree with
the computed value.

`trueCost` is the number a tracker like this exists to show and that lenders'
own dashboards bury: what this purchase actually cost me once late fees are counted.
Surface it prominently on order detail.

### Fees attach to instalments, not orders

This is deliberate and it is how real instalment products behave: a late fee is
incurred against the instalment you missed. Modelling it on the order loses the
ability to say *which* payment went wrong. Get this right.

## 3. API

Route handlers under `app/api/`. Every list endpoint returns the same envelope:

```ts
type Page<T> = {
  totalResults: number
  offset: number
  limit: number
  nextPageUrl: string | null
  results: T[]
}
```

Query params on every list: `?offset=0&limit=25&orderBy=<field>&ascending=false`.
Cap `limit` server-side at 200 and clamp silently. Validate params with Zod and
return 400 with a readable message on rubbish input.

Endpoints:

```
GET    /api/summary                     totals + 15/30/60-day due buckets + counts by provider kind
GET    /api/orders                      paginated; filters below
POST   /api/orders                      create order + generate its instalment schedule
GET    /api/orders/:id                  order + instalments + fees + payments + refunds
PATCH  /api/orders/:id
DELETE /api/orders/:id
GET    /api/instalments/due             paginated, ordered by dueOn ascending
POST   /api/instalments/:id/payments    record a payment against an instalment
POST   /api/instalments/:id/fees        record a fee
GET    /api/providers                   CRUD
POST   /api/import/csv                  parse + preview, then commit
```

`/api/summary` shape:

```ts
{
  total: Money, owedWithoutPending: Money, pending: Money,
  duePeriods: [{ period: 15, periodUnit: 'days', total: Money },
               { period: 30, ... }, { period: 60, ... }],
  overdue: boolean, overdueTotal: Money,
  activeOrders: number, totalOrders: number,
  byProviderKind: [{ kind: 'bnpl', total: Money, activeOrders: number }, ...]
}
```

**Orders list must support filtering from day one**: `?merchant=`, `?providerId=`,
`?status=`, `?from=`, `?to=`, `?q=` (free text over reference and provider name).
I have looked at a production app in this space that shipped 61 pages of orders with
no search at all — the data layer supported it, the UI just never exposed it. Do not
repeat that. The filter bar is part of milestone 3, not a "nice to have".

Page data for server components comes from direct Drizzle queries, not by fetching
your own API. The route handlers exist for client-side mutation, the CSV import and
future mobile use.

## 4. Screens

Fixed 240px left rail, one scrolling content column. Every page opens with a tinted
hero card holding the single number that matters, then white cards below.

**`/` — Dashboard.** Hero: total owing, and owed-excluding-pending beside it.
A one-line strip: "You have {X} due in the next 30 days." Then the next two payments
due as cards with amount, provider and due date. Then a small "attention" card that
appears only if anything is overdue.

**`/orders` — Orders.** Hero: total owing + a "Breakdown" button opening a modal with
the 15/30/60-day buckets. Filter bar: text search, provider dropdown, status toggle,
date range. Table: provider (initial chip + name), status badge, purchase date,
reference, order amount, amount owing, chevron. Paginated, 25 per page, page numbers
with an ellipsis — not infinite scroll; these are records people search, not browse.

**`/orders/:id` — Order detail.** Two columns.
*Left:* order summary key/value rows — purchase date, order amount, total paid (with
"incl. $X fees" as a sub-line when fees exist), total owing, and **true cost**.
Then provider info and notes.
*Right:* a progress bar, "Paid $X / N remaining $Y", then the **payment schedule as a
vertical timeline** — connected dots down the left, tick in the dot when paid, date
and "2 of 4 · Paid" beneath, amount on the right, expandable to show the fees and
payments that make it up. This timeline is the best idea in this whole design: it
turns "4 of 4" into something you read in one glance. Get it right — connector line
behind the dots, no connector after the last one, `prefers-reduced-motion` respected
on the expand.

**`/upcoming` — Upcoming payments.** Hero: three figures, due in 15 / 30 / 60 days.
Table of instalments ordered by due date: provider, "3 of 4", due date, **"in 7 days"
as the primary framing with the exact date secondary**, amount, and a "Mark paid"
button that opens a small record-payment dialog. Overdue rows get a red left edge.

**`/providers` — Providers.** List with add/edit. Each shows active orders and total owing.

**`/settings`** — profile, currency, CSV import, export everything as JSON.

Empty states everywhere are real: an illustration or a large glyph, one sentence of
explanation, and the primary action as a button. Never a blank panel.

Responsive: below 900px the rail collapses to a bottom tab bar, the order-detail
columns stack with the timeline first, and tables become stacked cards.

## 5. Design tokens

Define these on `:root` in `app/globals.css` and wire them into
`tailwind.config.ts`. Semantic names, not literal ones — `--color-primary`, never
`--color-periwinkle` — so the whole app re-skins from this block alone.
**These are placeholders; swap them for your own palette.**

```css
:root{
  --color-primary:            #E4E2FF;  /* hero cards, active nav pill, timeline dots */
  --color-primary-press:      #C9C5FF;
  --color-prominent:          #16181D;  /* dark buttons, badges, progress bar */
  --color-inverse:            #FFFFFF;

  --color-ink:                #16181D;
  --color-ink-secondary:      #3A3D45;
  --color-ink-muted:          #6B6F78;
  --color-ink-subtle:         #9BA0A8;

  --color-line:               #ECEDEF;  /* row dividers, hairlines */
  --color-surface:            #FFFFFF;
  --color-surface-sunken:     #F6F6F4;  /* page background */
  --color-surface-chip:       #EFEFEC;  /* initial chips */

  --color-success:            #2F9E6E;
  --color-success-tint:       #E6F5EE;
  --color-warning:            #C98A00;
  --color-warning-tint:       #FCF3DF;
  --color-danger:             #C0392B;
  --color-danger-tint:        #FBEDEB;

  --radius-card:              20px;
  --radius-chip:              10px;
  --radius-pill:              999px;

  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
}
```

Type scale: hero figures 34/700 with tight tracking, section headings 17/600,
body 14/400, captions 12.5/400 in `--color-ink-muted`. Row rhythm: 15px vertical
padding with a 1px `--color-line` divider, no divider after the last row.

Support dark mode from the start via a `[data-theme="dark"]` block redefining the
same tokens — if the tokens are used properly this costs one block and nothing else.

Accessibility is not a milestone, it is a constraint on every milestone: real
`<table>` semantics, labelled form controls, visible focus rings, 4.5:1 contrast on
text, the timeline readable by a screen reader as an ordered list, and status never
communicated by colour alone — the overdue row says "Overdue", it isn't just red.

## 6. Milestones

Work through these in order. Stop at the end of each, run the checks, and tell me
what you did and what you'd change before carrying on.

1. **Skeleton.** Repo, pnpm, Next 15 + TS strict, Tailwind with the tokens, Docker
   Compose Postgres, Drizzle configured, `/` renders the rail and an empty hero.
   Lint + typecheck + test scripts all green in CI (GitHub Actions).
2. **Domain core.** Schema + migrations. `lib/money.ts` and `lib/ledger.ts` with
   exhaustive unit tests — including a fully-paid order with three late fees, a
   part-refunded order, a pending payment, and an over-payment. This milestone is
   tests-first; I want the ledger provably right before any UI touches it.
3. **Orders.** List with filters and pagination, detail page with the timeline,
   create/edit forms with schedule generation. Seed script with ~40 invented orders
   across 8 invented providers spanning two years, including paid, active, overdue
   and refunded cases.
4. **Money in motion.** Record payment, record fee, mark paid from the upcoming
   list, refunds. Every mutation revalidates the affected paths.
5. **Dashboard and upcoming.** Summary endpoint, the three hero figures, the
   breakdown modal, the overdue card.
6. **Auth, import, export.** Auth.js with database sessions, CSV import with a
   column-mapping preview step, JSON export.
7. **Polish.** Dark mode, responsive breakpoints, empty states, Playwright tests for
   add-order → record-payment → order-settles and for the filter bar.

## 7. Working agreement

- Conventional commits, one milestone per branch, a short PR description each time.
- When a decision is genuinely ambiguous, ask me rather than guessing — but only
  for decisions that change the shape of the thing. Pick sensible defaults for the rest
  and tell me what you picked.
- Every PR states what you tested and what you did not.
- If you find yourself writing the same layout three times, stop and extract a primitive.
- Do not add a dependency without saying why in the PR. No date library until
  `Intl.DateTimeFormat` provably isn't enough.
- Tell me when something in this brief turns out to be a bad idea. I would rather
  change the spec than have you build something you think is wrong.

## 8. Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` all pass.
- Seeded app runs from `docker compose up` + `pnpm db:push && pnpm db:seed && pnpm dev`.
- The ledger functions have branch coverage above 95%.
- No hex colour appears outside `globals.css`.
- No real company's name, logo or brand colour appears anywhere in the repo.
- I can add an order with four instalments, record three payments and a late fee, and
  the dashboard total, the order's true cost and the timeline all agree.

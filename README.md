# Owing

A private, single-user dashboard for tracking money owed across buy-now-pay-later
providers, store finance and instalment plans. It never touches money: data gets
in by manual entry and CSV import, and the app answers three questions — what do
I owe in total, what's due next, and what did each order really cost once fees
are counted.

The full brief lives in [docs/brief.md](docs/brief.md).

## Stack

Next.js 15 (App Router, TypeScript strict) · PostgreSQL + Drizzle · Tailwind v4
with semantic tokens in `app/globals.css` · Zod · Vitest · Playwright · pnpm.

## Local setup

```bash
docker compose up -d
cp .env.example .env
pnpm install
pnpm db:push
pnpm dev
```

## Signing in

The first visit redirects to `/setup`, where you choose the email and password
for the single account (an account created by the CSV importer is adopted).
Sessions are opaque tokens stored hashed in the `sessions` table, 30 days,
httpOnly cookie. Passkeys can be added under Settings → Security and used on
the sign-in page. Passwords are hashed with scrypt from Node's `crypto`.

## Importing your order history

Settings → Import lets you upload a CSV, match its columns, preview the
reconstructed orders and import them. The same thing from the command line —
drop a CSV in `data/` (git-ignored) with the columns
`Date, Merchant, Status, Channel, Order No, Order Amount, Amount Owing`, then:

```bash
pnpm import:csv --file data/orders.csv --provider "My provider" --dry-run
pnpm import:csv --file data/orders.csv --provider "My provider"
```

The importer rebuilds each order's pay-in-4 schedule (last instalment absorbs
rounding), allocates what has been paid in order, and refuses any row whose
reconstructed balance doesn't match the CSV. Re-running skips orders already
present by order number; `--replace` wipes that provider's orders first.

By default instalments fall fortnightly from the purchase date. Providers that
collect on a fixed fortnightly cycle instead take `--cycle-anchor YYYY-MM-DD`
(any one of their collection days): the first instalment then lands on the
last cycle day on or before purchase + 14 days. Check the result against the
provider's own "due in 15/30/60 days" figures.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test            # unit + DB integration tests (needs TEST_DATABASE_URL)
pnpm test:coverage   # enforces 95% branch coverage on lib/money, lib/ledger
pnpm test:e2e        # Playwright against TEST_DATABASE_URL (first: pnpm exec playwright install chromium)
pnpm db:seed         # invented demo data for an empty database
```

Settings → Export downloads everything as JSON.

The ledger lives in `lib/ledger.ts`: money is integer minor units, every
derived figure (owed, pending, true cost, status) is computed from the rows,
and `orders.status` is only a cache written by `refreshOrderStatus`.

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

## Importing your order history

Drop a CSV in `data/` (git-ignored) with the columns
`Date, Merchant, Status, Channel, Order No, Order Amount, Amount Owing`, then:

```bash
pnpm import:csv --file data/orders.csv --provider "My provider" --dry-run
pnpm import:csv --file data/orders.csv --provider "My provider"
```

The importer rebuilds each order's pay-in-4 schedule (fortnightly from the
purchase date, last instalment absorbs rounding), allocates what has been paid
in order, and refuses any row whose reconstructed balance doesn't match the
CSV. Re-running skips orders already present by order number.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test            # unit + DB integration tests (needs TEST_DATABASE_URL)
pnpm test:coverage   # enforces 95% branch coverage on lib/money, lib/ledger
```

The ledger lives in `lib/ledger.ts`: money is integer minor units, every
derived figure (owed, pending, true cost, status) is computed from the rows,
and `orders.status` is only a cache written by `refreshOrderStatus`.

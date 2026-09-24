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
reconstructed balance doesn't match the CSV. Re-running with a newer export
brings orders already present (by order number) up to its amount owing — paid
instalments are added or undone as needed, nothing else on the order is touched
(`--no-update` to skip them instead); `--replace` wipes that provider's orders
first. Order numbers like `In-Store #123` are stored as `123`, with the channel
taken from the prefix when the CSV has no channel column. The newer export
headers (`Purchase date`, `Order no.`, `Order amount (NZD)`, `Amount owing (NZD)`)
are recognised as well as the older ones.

When you have both exports, import the order history first and then the upcoming
payments (below): the history fixes what is owed, the upcoming file fixes when.

## Keeping it current from an upcoming-payments export

Providers also export the payments still to come — one row per instalment
(`Merchant, Payment no., Due date, Amount due`), with no order numbers. Settings →
Update from upcoming payments (or `pnpm import:upcoming`) reconciles that file
against the orders already present instead of replacing them:

- each row is matched to an order by merchant, "k of n", amount and a purchase-date
  window; the matched instalment takes the export's due date, instalments the export
  doesn't list are marked paid, and ones it lists that the app thought were paid are
  re-opened;
- settled orders the export still lists a payment for are re-opened (`--skip-settled`
  to leave them alone);
- active orders missing from the export are marked paid off (`--keep-missing` to
  leave them alone);
- rows that match nothing become new orders, with the purchase date and total
  estimated and a note saying so (`--no-create` to skip).

Nothing is ever deleted. The preview shows the owing total before and after, which
should land on the export's own total.

```bash
pnpm import:upcoming --file data/upcoming.csv --provider "My provider" --dry-run
pnpm import:upcoming --file data/upcoming.csv --provider "My provider"
```

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

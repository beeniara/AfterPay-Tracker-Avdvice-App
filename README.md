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

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

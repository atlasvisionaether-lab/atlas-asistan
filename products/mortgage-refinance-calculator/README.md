# Mortgage Refinance Calculator

> Homeowners can't tell whether refinancing actually saves them money

Built by the [Micro-SaaS Factory](../../README.md). Target audience: **homeowners**.
Launch price: **$12 one-time**.

## What it does

A single-purpose tool: paste in your inputs, get an instant answer, and
(optionally) save results to Supabase.

## Develop

```bash
npm install
cp .env.example .env.local   # add Supabase keys (optional)
npm run dev
```

## API

```
POST /api/calculate
{ "items": [{ "label": "Brand A 500g", "price": 4.99, "size": 500, "unit": "g" }] }
```

Returns per-item unit prices and the cheapest option.

## Deploy

See [../../DEPLOY.md](../../DEPLOY.md). Vercel one-click, or any Node host.

## Monetization

See [../../SALES.md](../../SALES.md). Price point: $12 one-time.

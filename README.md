# Micro-SaaS Factory

Clone a template, replace the tokens, ship a micro-SaaS. One API call produces
a complete, buildable Next.js product in `products/`.

- **Next.js 15.5.28** (pinned) · React 19 · TypeScript · Tailwind
- **Factory library:** `src/lib/factory.ts` — `createMicroSaaS` clones
  `templates/micro-saas-template` and replaces every `__TOKEN__` with your
  product details.
- **Dashboard:** `src/app/page.tsx` — factory dashboard (products, ideas, create form).
- **API:**
  - `POST /api/factory/create` — create a product
  - `GET  /api/factory/list` — list products
  - `GET  /api/factory/ideas` — list the 100-idea backlog (`?limit=N` supported)

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000 — factory dashboard
```

## Create a product

```bash
curl -X POST http://localhost:3000/api/factory/create \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Price Per Ounce Calculator",
    "problem": "Comparing unit prices across brands and package sizes is tedious",
    "target": "grocery shoppers",
    "price": "$9 one-time"
  }'
```

Response (`201`):

```json
{
  "ok": true,
  "product": {
    "slug": "price-per-ounce-calculator",
    "name": "Price Per Ounce Calculator",
    "dir": "products/price-per-ounce-calculator",
    "files": 20,
    "manifestPath": "products/price-per-ounce-calculator/factory.manifest.json"
  }
}
```

Then:

```bash
cd products/price-per-ounce-calculator
npm install
npm run build        # must be green
npm run dev
```

Every generated product contains:

```
products/<slug>/
├── factory.manifest.json     # creation metadata
├── package.json              # tokens replaced, ready to install
├── src/lib/calculate.ts      # unit-price engine (pure functions)
├── src/lib/supabase.ts       # Supabase browser client + save helper
├── src/app/page.tsx          # landing page + calculator UI
├── src/app/Calculator.tsx    # interactive comparison table
├── src/app/api/calculate/    # POST API: compare items, find best price
└── supabase/                 # schema.sql + seed.sql (RLS enabled)
```

## Tokens replaced by the factory

| Token | Replaced with |
| --- | --- |
| `__PRODUCT_NAME__` | `name` |
| `__PRODUCT_NAME_TITLE__` | title-cased `name` |
| `__PRODUCT_SLUG__` | slug (derived from `name`, or explicit `slug`) |
| `__PRODUCT_PROBLEM__` | `problem` |
| `__PRODUCT_TARGET__` | `target` |
| `__PRODUCT_PRICE__` | `price` |

## Validation & safety

- `name`, `problem`, `target`, `price` are required (400 otherwise).
- Slugs must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`; duplicates return 409.
- Template/product directories skip `node_modules`, `.next`, `.git`.

## Scripts

```bash
npm run build       # production build (must be green)
npm run typecheck   # tsc --noEmit
npm run smoke       # hit all factory endpoints against a running server
```

## Docs

- [IDEAS.md](IDEAS.md) — 100 validated ideas (`name | problem | target | price`)
- [DEPLOY.md](DEPLOY.md) — deploy the factory and generated products
- [SALES.md](SALES.md) — pricing, positioning and launch playbook

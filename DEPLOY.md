# DEPLOY.md — Deploying the Factory and Its Products

## 1. Deploy the factory itself (Vercel)

```bash
npm install
npm run build          # verify green locally first
vercel --prod          # or: push to GitHub and import in Vercel
```

Environment variables (optional):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_BASE_URL` | Public URL used in docs/dashboard links |
| `FACTORY_PRODUCTS_DIR` | Override products directory (default `products`) |
| `FACTORY_TEMPLATE_DIR` | Override template directory (default `templates/micro-saas-template`) |

> Note: on serverless platforms the filesystem is ephemeral. For a persistent
> factory, mount a volume (e.g. Vercel Blob / AWS EFS) or run on a VPS
> (`next start` behind nginx). For a durable record, commit generated
> products to git (the factory writes `factory.manifest.json` per product).

## 2. Deploy a generated product

Each product in `products/<slug>/` is a standalone Next.js app:

```bash
cd products/price-per-ounce-calculator
npm install
npm run build          # must be green
vercel --prod          # one-click; set env vars below
```

Product environment variables (see the product's `.env.example`):

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | optional | enables saved calculations |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | optional | enables saved calculations |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | migrations/seed scripts |

## 3. Database setup (Supabase)

```bash
# 1. Create a project at supabase.com
# 2. Run the schema:
psql "$DATABASE_URL" -f products/<slug>/supabase/schema.sql
# 3. (Optional) seed example rows:
psql "$DATABASE_URL" -f products/<slug>/supabase/seed.sql
```

`schema.sql` creates `profiles` + `calculations` tables with Row Level
Security enabled (users can only read/write their own rows).

## 4. Custom domain

```bash
vercel domains add calculator.yourdomain.com
# point DNS: CNAME -> cname.vercel-dns.com
```

## 5. CI (GitHub Actions)

Minimal green-build gate for the factory and every product:

```yaml
# .github/workflows/build.yml
name: build
on: [push, pull_request]
jobs:
  factory:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
  products:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        product: [price-per-ounce-calculator]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: products/${{ matrix.product }}/package-lock.json }
      - run: npm ci --prefix products/${{ matrix.product }}
      - run: npm run build --prefix products/${{ matrix.product }}
```

## 6. Smoke test in production

```bash
BASE_URL=https://factory.yourdomain.com npm run smoke
```

The smoke script exercises `/api/factory/ideas`, `/api/factory/list`,
`/api/factory/create` (including duplicate + validation failures) and the
dashboard page.

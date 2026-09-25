# Luma Commission Bridge

![Shopify Admin GraphQL API](https://img.shields.io/badge/Shopify-Admin%20GraphQL%20API-96BF48?logo=shopify&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript)
![React Router](https://img.shields.io/badge/React%20Router-7-CA4245?logo=reactrouter&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma)
![CI](https://github.com/GRandow/luma-commission-bridge/actions/workflows/ci.yml/badge.svg)

A custom Shopify app that does the back-office side of a direct-sales store: it listens to `orders/paid` webhooks, attributes each order to the distributor who referred the shopper, calculates the commission, writes it back to the order and hands it to an external commission engine — with the retries, idempotency and visibility that money deserves. It is the merchant-side companion of [luma-shopify-storefront](https://github.com/GRandow/luma-shopify-storefront), the headless storefront that puts the distributor's code on the cart.

> **Status:** parts 1–3 are done — webhook intake, idempotent processing, distributor metaobjects, per-distributor rates, write-back to the order, sync to the commission engine with retries, admin dashboard. Part 4 (checkout extension and Functions) is listed under _Roadmap_.

## How it works

```
storefront  /?ref=ANA123  →  cart attribute "ref"  →  Shopify checkout  →  order paid
                                                                              │
                                                     Shopify delivers orders/paid (HMAC-signed)
                                                                              ▼
  webhook route ─ verify signature ─ record delivery by webhook id ─ 200 OK ─ enqueue
                                                                              ▼
  worker ─ read the "ref" note attribute ─ look the distributor up ($app:distributor metaobject)
         ─ commission = discounted subtotal × the distributor's rate ─ store the Commission row
         ─ write it on the order: 3 metafields ($app:commission_*) + tag ref:CODE
         ─ hand it to the commission engine (idempotency key = commission id)
           outage → retry with backoff · rejection → stop and flag · success → reference stored
                                                                              ▼
  admin page (Polaris web components): commissions with their engine state, distributors, deliveries,
                                       reprocess / retry / sync buttons, simulator switch (normal · outage · rejecting)
```

## Decisions worth reading

- **The webhook is a signal, not the truth.** The handler verifies the HMAC (`authenticate.webhook`), records the delivery, answers 200 within milliseconds and hands the work to a queue. Shopify retries deliveries it does not get a timely 200 for, so slow handlers create duplicates.
- **Idempotency by webhook id.** Every delivery is inserted under Shopify's `X-Shopify-Webhook-Id` before processing; a retry hits the primary key and is skipped. Commissions are unique per `(shop, orderId)`, so reprocessing an order updates the same row instead of paying twice.
- **Integer money.** Amounts are parsed from Shopify's decimal strings into cents and rates are basis points; the commission maths never touches floating point.
- **Failures are visible.** Jobs retry with exponential backoff; the last failure is stored on the delivery and shown in the admin with a _Reprocess_ button. Nothing fails silently.
- **Distributors are metaobjects, not a table of ours.** The `$app:distributor` definition is declared in `shopify.app.toml` and created on deploy; the merchant adds and edits distributors in Content → Metaobjects, and the app looks them up by code (`metaobjects(type:, query: "fields.code:…")`). No screen to build, no sync to keep, and rates are edited where the merchant already works. Unknown or inactive codes are kept as their own statuses rather than dropped.
- **The order is the ledger the merchant sees.** Attributed commissions are written back with one mutation: three app-owned order metafields (amount as `money`, distributor, rate) and a `ref:CODE` tag, so orders are filterable by distributor in the admin. A failed write-back is stored on the row and retried by the queue. The metafield definitions are created by the app through the API rather than declared in the TOML, because the order page only shows _pinned_ definitions and declarative ones cannot be pinned — a small thing that decides whether the merchant ever sees the commission.
- **The engine is a contract, not a dependency.** `commission-engine.server.ts` knows one thing: POST a commission with a bearer token and an `Idempotency-Key`, get a reference back. In development the endpoint is the app's own simulator (`/simulated-engine/commissions`), which behaves like a real target — auth, deterministic references, and a switch on the dashboard (or `?mode=fail` / `?mode=reject` on the URL) to rehearse an outage or a bad payload without restarting anything. Pointing `COMMISSION_ENGINE_URL` at Exigo, ByDesign or a home-grown back office is a config change.
- **Two kinds of failure, two behaviours.** A 5xx or a network error is retried with exponential backoff; a 4xx means the payload is the problem, so the sync stops, the reason is shown on the dashboard, and a person decides (there is a _Retry_ button once the cause is fixed). Every attempt is counted on the row.
- **Queue in process, on purpose.** One dev store, one Node process: an in-process queue is enough and keeps the demo self-contained. The queue has a tiny interface so SQS or BullMQ can replace it without touching the handlers; persisted deliveries already make unfinished work re-runnable after a restart.

## Stack

React Router 7 (server and admin UI in one project) · `@shopify/shopify-app-react-router` (token exchange, session storage, webhook verification) · Admin GraphQL API 2026-07 · Prisma + Postgres (Neon) · Polaris web components + App Bridge · Vitest · GitHub Actions

## Project layout

```
app/
├─ domain/          money.ts (cents) · rates.ts (basis points) · attribution.ts (referral code) · commission.ts
│                   resolve-commission.ts (which rate and status apply) — pure, unit-tested
├─ services/        job-queue.server.ts · webhook-events.server.ts (idempotent intake) · commissions.server.ts (pipeline)
│                   distributors.server.ts (metaobjects) · order-writeback.server.ts (metafieldsSet + tagsAdd)
│                   commission-engine.server.ts (client) · commission-sync.server.ts (sync job) · simulated-engine.server.ts
│                   order-definitions.server.ts (creates the app's pinned order metafield definitions)
│                   retention.server.ts (30-day purge of payloads, delete-everything on uninstall)
├─ routes/
│  ├─ webhooks.orders.paid.tsx   verify → record → enqueue → 200
│  ├─ simulated-engine.commissions.tsx   the stand-in commission engine (bearer auth, JSON)
│  ├─ app._index.tsx             dashboard (loader/action, Polaris web components)
│  └─ webhooks.app.*.tsx         template lifecycle webhooks
├─ types/           orders-paid.ts — the slice of the webhook payload we depend on
└─ shopify.server.ts, db.server.ts
prisma/             schema.prisma (Session, WebhookEvent, Commission) and migrations
```

## Running it

Requires Node.js 22+, the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli), a development store and a Postgres database (a free [Neon](https://neon.tech) project works; the connection string goes in `.env` as `DATABASE_URL`).

```bash
npm install
npm run dev        # shopify app dev: tunnel, app install, Prisma migrations, hot reload
```

`shopify app dev` registers the `orders/paid` subscription from `shopify.app.toml` against the tunnel URL. The distributor metaobject definition in the same file is created by `shopify app deploy`, which you run once (and again whenever it changes). Then, on the app's home page, set up the order metafields (one click, creates the app's pinned definitions), seed the sample distributors, place a test order on the storefront (Bogus Gateway, card `1`) with a `?ref=ANA123` link, and the order shows up with its commission within seconds — and in the Shopify admin the order carries the commission metafields and the `ref:ANA123` tag. To rehearse a failure, switch the simulator to _Outage_ in the Commission engine card, place another order and watch the Engine column retry and fail; switch back to _Normal_ and click _Retry_.

```bash
npm test           # Vitest: domain rules, the pipeline, the engine client, the sync job and the simulator
npm run typecheck  # react-router typegen + tsc
npm run lint
```

## Data handling

The app is declared for Shopify's _protected customer data_ access at the base level, which is what receiving `orders/paid` requires. What it actually keeps, and for how long:

| Data                                                                                          | Where                  | Why                                            | Kept for                     |
| --------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------- | ---------------------------- |
| Raw `orders/paid` payload (no name, e-mail, phone or address: those fields are not requested) | `WebhookEvent.payload` | Reprocess a failed job from the admin          | 30 days, then purged         |
| Order id, number, currency, discounted subtotal, referral code, commission                    | `Commission`           | The ledger the merchant pays distributors from | Until the app is uninstalled |
| Store access token                                                                            | `Session`              | Calling the Admin API                          | Until the app is uninstalled |

Everything is deleted when the app is uninstalled (`webhooks.app.uninstalled.tsx`). The database is Postgres on Neon, encrypted at rest and reached over TLS; nothing is shared with third parties. A production deployment would keep the same model on a managed Postgres of the merchant's choosing.

## Configuration

| Variable                       | Purpose                              | Default                                               |
| ------------------------------ | ------------------------------------ | ----------------------------------------------------- |
| `DATABASE_URL`                 | Postgres connection string           | — (required)                                          |
| `COMMISSION_ENGINE_URL`        | Where payable commissions are POSTed | this app's `/simulated-engine/commissions`            |
| `COMMISSION_ENGINE_KEY`        | Bearer token the engine expects      | `dev-engine-key` (set a real one outside development) |
| `COMMISSION_ENGINE_TIMEOUT_MS` | Request timeout                      | `10000`                                               |

`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES` and `SHOPIFY_APP_URL` are provided by the Shopify CLI.

## Scopes

`read_orders` (webhook and order lookups), `write_orders` (commission metafields and tag on the order), `write_metaobjects` and `write_metaobject_definitions` (distributor records and their definition), `read_customers` (reserved for a sponsor-code fallback). The commission flow reads no customer field: attribution comes from the order's note attributes, not from the customer. The protected-customer-data approval described above is needed only because `orders/*` webhooks require it.

## Roadmap

1. ~~Webhook intake, idempotent processing, commission calculation, dashboard~~
2. ~~Distributors as metaobjects (code, name, level, rate), attribution by code, write-back with `metafieldsSet` and `tagsAdd`~~
3. ~~Sync to an external commission engine (simulated endpoint) with retries, status and manual retry~~
4. Checkout UI extension that collects the referral code at checkout, and Shopify Functions for distributor pricing

# Shem Solar — Backend API

Express.js + PostgreSQL + M-Pesa Daraja + Africa's Talking + BullMQ

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| Database | PostgreSQL 14+ |
| Payments | Safaricom Daraja API (STK Push) |
| SMS | Africa's Talking |
| Job Queue | BullMQ + Redis |
| Deployment | Railway / Render / DigitalOcean |

---

## Project Structure

```
src/
├── index.js                  # Express app entry point
├── db/
│   ├── pool.js               # PostgreSQL connection pool
│   ├── migrate.js            # Run: node src/db/migrate.js
│   └── seed.js               # Run: node src/db/seed.js
├── middleware/
│   ├── adminAuth.js          # x-admin-secret header check
│   └── errorHandler.js       # Global error handler
├── services/
│   ├── mpesa.service.js      # Daraja token, STK push, callback parser
│   ├── sms.service.js        # Africa's Talking — all SMS templates
│   ├── queue.service.js      # BullMQ queue + worker
│   └── stock.service.js      # ACID stock deduction transaction
├── controllers/
│   ├── mpesa.controller.js   # STK push, callback, manual payment
│   ├── orders.controller.js  # Order CRUD, status machine, quick SMS
│   ├── products.controller.js# Catalog, packages, inventory
│   ├── quotes.controller.js  # Quote pipeline, send payment link
│   └── analytics.controller.js
└── routes/
    ├── mpesa.routes.js
    ├── orders.routes.js
    ├── products.routes.js
    ├── quotes.routes.js
    └── analytics.routes.js
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in all values in .env
```

### 3. Create PostgreSQL database

```bash
createdb shem_solar
```

### 4. Run migrations

```bash
node src/db/migrate.js
```

### 5. Seed initial products

```bash
node src/db/seed.js
```

### 6. Start Redis (required for BullMQ)

```bash
# macOS
brew services start redis

# Ubuntu
sudo systemctl start redis
```

### 7. Start the server

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

---

## M-Pesa Setup (Daraja)

1. Register at [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Create an app — get your **Consumer Key** and **Consumer Secret**
3. Get your **Lipa Na M-Pesa Passkey** from the portal
4. Set `MPESA_ENV=sandbox` for testing, `production` for live
5. Your callback URL **must be HTTPS and publicly accessible** — use ngrok for local dev:

```bash
ngrok http 3000
# Copy the https URL → set as MPESA_CALLBACK_URL in .env
```

**Critical:** The `/api/v1/mpesa/callback` route has NO authentication.
Safaricom hits it directly. It always responds HTTP 200 immediately —
all processing happens asynchronously afterwards.

---

## Africa's Talking Setup

1. Register at [africastalking.com](https://africastalking.com)
2. Create an app → get your **API Key**
3. Register your **Sender ID** (e.g. `ShemSolar`) — takes 1–3 business days
4. For testing, set `AT_USERNAME=sandbox`

---

## API Reference

### Public endpoints (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/v1/products` | List active products |
| GET | `/api/v1/products/packages` | List packages with components |
| GET | `/api/v1/products/:slug` | Single product |
| POST | `/api/v1/quotes` | Submit consultation request |
| POST | `/api/v1/mpesa/stk-push` | Initiate M-Pesa payment |
| POST | `/api/v1/mpesa/callback` | **Safaricom callback (DO NOT AUTH)** |

### Admin endpoints (header: `x-admin-secret: <your secret>`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/orders` | List orders (filterable) |
| GET | `/api/v1/orders/:id` | Order detail with items |
| PATCH | `/api/v1/orders/:id/status` | Advance order state machine |
| POST | `/api/v1/orders/:id/sms` | Send quick-action SMS |
| GET | `/api/v1/quotes` | List consultation requests |
| GET | `/api/v1/quotes/pipeline` | Kanban counts per stage |
| PATCH | `/api/v1/quotes/:id` | Update stage / call log |
| POST | `/api/v1/quotes/:id/send-payment-link` | Convert quote → STK Push |
| POST | `/api/v1/mpesa/manual-payment` | Mark order paid (bank/cheque) |
| POST | `/api/v1/products` | Create product |
| PATCH | `/api/v1/products/:id` | Update product |
| PATCH | `/api/v1/products/:id/stock` | Restock units |
| GET | `/api/v1/analytics/overview` | Dashboard KPIs |
| GET | `/api/v1/analytics/revenue` | Monthly revenue (6 months) |
| GET | `/api/v1/analytics/top-products` | Top 5 by revenue |

---

## Order State Machine

```
pending → paid → processing → dispatched → completed
   └──────────────────────────────────────→ cancelled
```

- `pending → paid`: triggered by Daraja callback OR manual payment override
- Both paths run the same downstream logic: stock deduction + SMS confirmation
- State transitions validated server-side — invalid transitions return 400

---

## Key Design Decisions

**`price_at_purchase` on order_items** — price is snapshotted at checkout time.
Future price changes never corrupt historical orders.

**`mpesa_checkout_id` unique index** — O(1) lookup when Safaricom's callback
arrives. Critical for high-traffic scenarios.

**BullMQ SMS queue** — Africa's Talking API is called asynchronously.
A slow SMS response never blocks the checkout or the Daraja callback acknowledgement.

**Stock deduction transaction** — entire deduction (including all package
sub-components) runs inside `BEGIN...COMMIT`. If any product is out of stock,
everything rolls back. No partial deductions.

---

## Deployment (Railway)

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway add postgresql redis
railway up

# Set environment variables
railway variables set NODE_ENV=production
railway variables set MPESA_CONSUMER_KEY=...
# (set all .env.example variables)
```

---

## Local Development with ngrok

```bash
# Terminal 1 — API server
npm run dev

# Terminal 2 — expose to internet for Daraja callback
ngrok http 3000

# Copy the https forwarding URL, e.g.:
# https://abc123.ngrok.io

# Set in .env:
# MPESA_CALLBACK_URL=https://abc123.ngrok.io/api/v1/mpesa/callback
```

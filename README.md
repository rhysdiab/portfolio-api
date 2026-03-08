# Portfolio API

A TypeScript REST API for managing investment portfolios and calculating money-weighted returns (MWR) on ASX-listed securities.

---

## Getting Started

```bash
npm install
npm test       # run full test suite
npm run dev    # start server at http://localhost:3000
```

`mwr-verification.test.ts` loads `data/prices.csv` directly — the full dataset must be present for those tests to pass. All other tests use injected prices and run without it.

---

## Data Model

```typescript
Portfolio    { id, name, currency, createdAt }

Transaction  { id, portfolioId, type: 'buy' | 'sell',
               ticker, date, amount, price, currency }
```

`currency` is stored on each transaction as specified in the brief. FX conversion is a shortcut — see below.

---

## API

### Portfolios

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/portfolios` | Create a portfolio |
| `GET` | `/portfolios` | List all portfolios |
| `GET` | `/portfolios/:id` | Get a portfolio |
| `DELETE` | `/portfolios/:id` | Delete portfolio and its transactions |

### Transactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/portfolios/:id/transactions` | Add a transaction |
| `GET` | `/portfolios/:id/transactions` | List transactions |
| `DELETE` | `/portfolios/:id/transactions/:txId` | Remove a transaction |

`GET /portfolios/:id/transactions` supports optional query params: `?from=YYYY-MM-DD&to=YYYY-MM-DD&ticker=CBA`

### Returns

```
GET /portfolios/:id/returns?from=YYYY-MM-DD&to=YYYY-MM-DD
```

```json
{
  "portfolioId": "abc-123",
  "from": "2025-10-29",
  "to": "2026-02-04",
  "mwr": -0.6473,
  "holdingPeriodReturn": -0.1966,
  "beginningValue": 5178.00,
  "endingValue": 4082.00,
  "netCashFlow": -379.00
}
```

- `mwr` — annualised money-weighted return (e.g. `-0.6473` = -64.73%)
- `holdingPeriodReturn` — raw return over the period, not annualised

---

## Return Calculation

The core function is `calculateMWR` in `src/calculations/returns.ts`. It is fully decoupled from Express and takes plain arrays — no HTTP context.

MWR is calculated as the **IRR** of all portfolio cash flows:

- **t = 0** — beginning portfolio value (outflow)
- **mid-period** — buys are negative cash flows, sells are positive
- **t = end** — ending portfolio value marked to market (inflow)

```
NPV = Σ [ CF_i / (1 + r)^(t_i / 365) ] = 0
```

Solved numerically using Newton-Raphson with actual/365 day-count, giving an annualised rate.

The implementation has been verified against Simply Wall St using real ASX prices for ZIP and NXT — results match to within rounding (-61.66% vs -61.7%).

**Why MWR over TWR:** MWR reflects the investor's actual experience — the timing and size of capital deployed affects the result. TWR eliminates cash flow effects and is more appropriate for benchmarking a fund manager against an index.

**Why IRR over Modified Dietz:** Modified Dietz is a linear approximation that works well for small cash flows but diverges materially when large transactions occur mid-period. IRR is exact.

---

## Shortcuts Taken

### Storage
**Current:** In-memory `Map` — data is lost on restart.

**Production:** PostgreSQL with `portfolios` and `transactions` tables. Transactions should be append-only to preserve an audit trail. Index on `(portfolio_id, date)` for efficient range queries.

### Currency
**Current:** `currency` is stored on each transaction but no FX conversion is applied — all values are assumed to be in AUD.

**Production:** FX rates (e.g. RBA feed) applied at calculation time to convert all positions to the portfolio's base currency.

### Price Lookup
**Current:** Full CSV loaded into memory at startup. `getPriceOnOrBefore` looks back up to 7 days to handle weekends. Returns are limited to dates within the dataset range (2025-10-29 to 2026-02-04) — there is no concept of a current price.

**Production:** Live market data feed for current prices. TimescaleDB with a proper ASX trading calendar for holiday-aware lookback. On-demand fetching with a Redis cache layer.

### IRR Solver
**Current:** Newton-Raphson with a fixed initial guess of 10%. Can fail to converge for non-conventional cash flow patterns (multiple sign changes).

**Production:** Newton-Raphson with a bisection fallback. Multiple sign changes can produce multiple valid IRR solutions — these cases would require Modified IRR (MIRR).

### Auth, Validation & Pagination
**Current:** No authentication. Basic field validation. All transactions returned in a single response.

**Production:** JWT auth with portfolio ownership. Zod schema validation. Cursor-based pagination.

---

## Future Implementations

- **Time-weighted return (TWR):** Daily sub-period linking for benchmarking against an index
- **Dividends:** Out of scope — the dataset contains no dividend data and the transaction spec defines only buy/sell. If included, cash dividends would be positive mid-period cash flows in the MWR calculation; DRP would be a synthetic buy at the ex-dividend price
- **Multi-currency:** FX conversion at calculation time using end-of-day rates
- **Benchmarking:** Compare portfolio MWR against ASX 200 over the same period
- **Corporate actions:** Stock splits and rights issues in the holdings calculation
- **Unrealised / realised P&L:** Attribution between open positions and closed trades

---

## Use of AI

Claude Code (Anthropic) was used throughout as a development assistant:

- **Challenge checklist:** Used AI to break the brief into a checklist of sections to work through — API design, return function, shortcuts, future implementations, and AI usage — ensuring nothing was missed
- **Scaffolding:** Generated initial project structure, config files, and Express boilerplate
- **IRR solver:** Produced the Newton-Raphson implementation and verified cash flow sign conventions — reviewed and validated manually
- **Tests:** Drafted unit and integration tests, refined with real dataset prices
- **Dataset parsing:** Identified CSV column structure and updated the price service parser
- **Code review:** Identified unused imports and dead code

- **Scaling architecture:** Workshopped different approaches to scaling the return calculation — on-demand vs pre-computed with SQS + Lambda, trade-offs between live prices and end-of-day MWR, and when a Redis cache is appropriate vs stale

Core design decisions — API structure, MWR vs TWR, IRR vs Modified Dietz, decoupling calculation logic from HTTP — were made independently and validated through conversation with the AI.

---

## Deployment & Scaling

### Containerisation
The API would be packaged as a Docker image and deployed behind a load balancer. A `Dockerfile` would build the TypeScript, expose port 3000, and run `node dist/index.js`. Environment variables would configure the database connection, port, and any secrets.

### AWS Architecture
```
Route 53 → ALB → ECS (Fargate) → RDS (PostgreSQL)
                               → ElastiCache (Redis)
                               → S3 (price data / static assets)
```

- **ECS Fargate** — runs the containerised API, scales horizontally based on CPU/memory. No servers to manage.
- **RDS PostgreSQL** — replaces the in-memory store. Multi-AZ for high availability, read replicas for query-heavy workloads.
- **ElastiCache (Redis)** — caches price lookups so repeated return calculations don't re-query the database.
- **ALB** — distributes traffic across containers, handles SSL termination.

### Scaling Considerations

**Price ingestion** would be a separate service — a scheduled Lambda (triggered by EventBridge at market close) ingests daily ASX closing prices into the database, completely decoupled from the API.

**Return calculation** is CPU-bound (IRR iteration). The queue/cache approach below is appropriate for **end-of-day returns**, which is the correct use case for MWR — it is a long-term performance metric, not a live number. Most portfolio trackers (e.g. Simply Wall St) calculate MWR using end-of-day prices, not live prices. Recalculating IRR every second against a live feed is not meaningful and prohibitively expensive.

For **live portfolio value** (intraday), a simpler calculation suffices: `current price × units − cost basis`. No IRR needed.

Two scaling approaches depending on requirements:

**Option 1 — On-demand (current approach)**
User requests returns → calculate fresh against latest end-of-day prices → return immediately. Simple, always accurate, sufficient for moderate load.

**Option 2 — Pre-computed with queue (high scale)**
A nightly job fans out return calculations across all portfolios via SQS + Lambda workers. Results are written to Redis. The API returns the cached result instantly. Cache is invalidated when a new transaction is added or new prices are ingested. This decouples read performance from calculation cost and scales to millions of portfolios.

---

## Project Structure

```
portfolio-api/
├── src/
│   ├── index.ts                      # Server entry point
│   ├── app.ts                        # Express app (importable for tests)
│   ├── store.ts                      # In-memory data store
│   ├── types.ts                      # Shared TypeScript types
│   ├── routes/
│   │   ├── portfolios.ts             # Portfolio CRUD + returns endpoint
│   │   └── transactions.ts           # Transaction CRUD
│   ├── services/
│   │   └── priceService.ts           # CSV price loader and lookup
│   └── calculations/
│       └── returns.ts                # MWR / IRR calculation (core logic)
├── tests/
│   ├── returns.test.ts               # Unit tests — calculation layer
│   ├── api.test.ts                   # Integration tests — all API endpoints
│   └── mwr-verification.test.ts      # MWR verified against Simply Wall St (real ASX prices)
└── data/
    └── prices.csv                    # ASX price dataset
```

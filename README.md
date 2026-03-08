# Portfolio API

A TypeScript REST API for managing investment portfolios and calculating money-weighted returns (MWR) on ASX-listed securities.

---

## Getting Started

### Prerequisites

- Node.js >= 18
- npm

### Install

```bash
npm install
```

### Price Data

The returns endpoint requires the ASX price dataset placed at `data/prices.csv`. The file is tab-separated with the following columns (among others):

```
TICKER_SYMBOL    PRICING_DATE                PRICE_CLOSE
ORG              2026-02-04 00:00:00+00      11.12
```

The price service reads `TICKER_SYMBOL`, `PRICING_DATE` (date portion only), and `PRICE_CLOSE` (AUD). Column order does not matter — headers are resolved by name.

The entire file is loaded into memory on startup. This is a deliberate shortcut for the scope of this challenge — see [Shortcuts Taken](#shortcuts-taken) for the production alternative.

### Run

```bash
npm run dev
```

Server starts at `http://localhost:3000`.

### Test

```bash
npm test
```

---

## API Reference

### Portfolios

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/portfolios` | Create a portfolio |
| `GET` | `/portfolios` | List all portfolios |
| `GET` | `/portfolios/:id` | Get a portfolio |
| `DELETE` | `/portfolios/:id` | Delete a portfolio and its transactions |

**Create portfolio request body:**
```json
{
  "name": "My ASX Portfolio",
  "currency": "AUD"
}
```

### Transactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/portfolios/:id/transactions` | Add a transaction |
| `GET` | `/portfolios/:id/transactions` | List transactions (filterable) |
| `DELETE` | `/portfolios/:id/transactions/:txId` | Remove a transaction |

**Add transaction request body:**
```json
{
  "type": "buy",
  "ticker": "CBA",
  "date": "2023-01-10",
  "amount": 10,
  "price": 97.50,
  "currency": "AUD"
}
```

**List transactions query params:** `?from=YYYY-MM-DD&to=YYYY-MM-DD&ticker=CBA`

### Returns

```
GET /portfolios/:id/returns?from=YYYY-MM-DD&to=YYYY-MM-DD
```

**Response:**
```json
{
  "portfolioId": "abc-123",
  "from": "2023-01-01",
  "to": "2023-12-31",
  "mwr": 0.1243,
  "beginningValue": 10000.00,
  "endingValue": 11800.00,
  "netCashFlow": -500.00
}
```

`mwr` is the annualised money-weighted return as a decimal (e.g. `0.1243` = 12.43%).

---

## Return Calculation

The money-weighted return (MWR) is calculated as the **Internal Rate of Return (IRR)** of all portfolio cash flows over the period:

- **t = 0**: Beginning portfolio value is treated as an outflow (the cost to hold the portfolio entering the period)
- **Mid-period**: Each buy is a negative cash flow (capital deployed), each sell is a positive cash flow (capital returned)
- **t = end**: Ending portfolio value is treated as an inflow (notional liquidation)

The IRR is solved numerically using **Newton-Raphson** with actual/365 day-count convention, giving an annualised rate.

```
NPV = Σ [ CF_i / (1 + r)^(t_i / 365) ] = 0
```

MWR reflects the impact of the timing and size of cash flows — larger investments made before strong performance periods are rewarded more than those made before weak ones.

---

## Shortcuts Taken

These are intentional simplifications given the scope of the challenge.

### Storage
**Current:** In-memory `Map` — data is lost on restart.

**Production:** A relational database (PostgreSQL) with separate `portfolios` and `transactions` tables. Transactions should be append-only with no updates to preserve a full audit trail. Indexes on `(portfolio_id, date)` for efficient range queries.

### Currency
**Current:** All prices and transaction values are assumed to be in AUD. No FX conversion is applied.

**Production:** Each price record and transaction would carry a currency code. A FX rate service (e.g. RBA rates or a vendor feed) would convert all values to the portfolio's base currency before calculating holdings value.

### Price Lookup & Date Range
**Current:** CSV loaded entirely into memory at startup. `getPriceOnOrBefore` does a simple day-by-day lookback of up to 7 days to handle weekends. Portfolio values can only be calculated for dates within the dataset range (2025-10-29 to 2026-02-04) — passing a date outside this range will return a missing prices error. There is no concept of a "current" price.

**Production:** A live market data feed would provide current prices, removing the dependency on a static date range. A time-series database (e.g. TimescaleDB) with a proper ASX trading calendar would handle holiday-aware lookback. Prices would be fetched on demand with a cache layer (Redis) rather than held in memory.

### IRR Solver
**Current:** Newton-Raphson with a fixed initial guess of 10%. Can fail to converge for unusual cash flow patterns (e.g. multiple sign changes).

**Production:** A hybrid approach — Newton-Raphson with a bisection fallback over a bounded interval. Multiple sign changes in cash flows (non-conventional) can produce multiple IRR solutions; these cases would require a modified IRR (MIRR) or explicit handling.

### Authentication & Authorisation
**Current:** No auth. Any caller can read or modify any portfolio.

**Production:** JWT-based auth with user ownership of portfolios. Role-based access for read-only vs. read-write operations.

### Validation
**Current:** Basic field presence and type checks on request bodies.

**Production:** A schema validation library (e.g. Zod) for strict input validation, including date format, positive amounts, and known ticker symbols.

### Pagination
**Current:** `GET /portfolios/:id/transactions` returns all records.

**Production:** Cursor-based pagination to handle portfolios with large transaction histories.

---

## Future Implementations

- **Time-weighted return (TWR):** Sub-period linking using daily valuations. More appropriate for benchmarking portfolio managers against an index since it eliminates the effect of external cash flows.
- **Multi-currency portfolios:** Aggregate holdings across currencies with live or end-of-day FX rates.
- **Benchmarking:** Compare portfolio MWR against an index (e.g. ASX 200) over the same period.
- **Unrealised / realised P&L breakdown:** Split return attribution between open positions and closed trades.
- **Dividends:** Dividends are out of scope — the provided dataset contains no dividend data and the transaction spec defines only buy/sell. If dividends were included, cash dividends would be treated as positive mid-period cash flows in the MWR calculation (increasing the numerator), and DRP (dividend reinvestment) would be modelled as a synthetic buy transaction at the ex-dividend price.
- **Corporate actions:** Handle stock splits and rights issues in the holdings calculation.
- **Streaming price updates:** WebSocket feed to update holdings value in real time.

---

## Use of AI

Claude Code (Anthropic) was used throughout this challenge as a development assistant. Specifically:

- **Project scaffolding:** Generated the initial Express project structure, `tsconfig.json`, and `package.json` based on a description of the requirements.
- **IRR solver:** Used AI to produce the Newton-Raphson implementation and verify the cash flow sign conventions against the MWR definition. The logic was reviewed and tested manually to confirm correctness.
- **Test generation:** AI drafted the initial unit and integration tests, which were then extended and refined — particularly the return calculation scenarios using real DDR prices from the dataset.
- **Dataset parsing:** When the real ASX CSV was provided, AI identified the column structure and updated the price service parser accordingly.
- **Code review:** Used AI to identify and remove unused imports and dead code (e.g. an unreachable route handler left over from a refactor).

The core design decisions — API structure, choice of MWR over TWR, Modified Dietz vs IRR, and the separation of calculation logic from the HTTP layer — were made independently and then validated through conversation with the AI.

---

## Project Structure

```
portfolio-api/
├── src/
│   ├── index.ts                      # Server entry point (starts Express)
│   ├── app.ts                        # Express app setup (importable for tests)
│   ├── store.ts                      # In-memory data store
│   ├── types.ts                      # Shared TypeScript types
│   ├── routes/
│   │   ├── portfolios.ts             # Portfolio CRUD + returns endpoint
│   │   └── transactions.ts           # Transaction CRUD routes
│   ├── services/
│   │   └── priceService.ts           # CSV price loader and lookup
│   └── calculations/
│       └── returns.ts                # MWR / IRR calculation (core logic)
├── tests/
│   ├── returns.test.ts               # Unit tests for calculation layer
│   ├── api.test.ts                   # Integration tests for all API endpoints
│   └── mwr-verification.test.ts     # MWR verified against Simply Wall St using real ASX prices
└── data/
    └── prices.csv                    # ASX price data (not committed)
```

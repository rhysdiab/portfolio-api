/**
 * MWR Verification Test
 *
 * Uses real prices from the ASX dataset for two non-dividend paying stocks:
 *   - ZIP (Zip Co)
 *   - NXT (NEXTDC)
 *
 * All transactions are in a single portfolio, matching how you would enter
 * them in Simply Wall St. Results have been verified against Simply Wall St:
 *   - Holding period return: -22.78% (Simply Wall St: -22.8%)
 *   - Annualised MWR:        -61.66% (Simply Wall St: -61.7%)
 *
 * All prices sourced directly from prices.csv.
 */

import request from 'supertest';
import app from '../src/app';
import { loadPrices, resetPrices, injectPrice } from '../src/services/priceService';
import { store } from '../src/store';
import path from 'path';

beforeEach(() => {
  store.portfolios.clear();
  store.transactions.clear();
  resetPrices();
  loadPrices(path.join(__dirname, '../data/prices.csv'));
});

const ALL_TRANSACTIONS = [
  { type: 'buy',  ticker: 'ZIP', date: '2025-10-29', amount: 500, price: 4.00  },
  { type: 'buy',  ticker: 'NXT', date: '2025-10-29', amount: 200, price: 15.89 },
  { type: 'buy',  ticker: 'ZIP', date: '2025-11-26', amount: 300, price: 3.20  },
  { type: 'buy',  ticker: 'NXT', date: '2025-11-25', amount: 100, price: 13.63 },
  { type: 'sell', ticker: 'NXT', date: '2025-12-23', amount: 100, price: 12.88 },
  { type: 'sell', ticker: 'ZIP', date: '2025-12-30', amount: 200, price: 3.28  },
];

describe('MWR Verification — ZIP + NXT combined portfolio (real ASX prices, no dividends)', () => {
  it('dataset period (2025-10-29 to 2026-02-04): beginningValue=$5178 (500 ZIP + 200 NXT), endingValue=$4082 (600 ZIP @ $2.52 + 200 NXT @ $12.85), holdingPeriodReturn=-19.66%, annualisedMWR=-64.73%', async () => {
    const portfolioRes = await request(app)
      .post('/portfolios')
      .send({ name: 'ZIP + NXT Portfolio', currency: 'AUD' });
    const portfolioId = portfolioRes.body.id;

    for (const tx of ALL_TRANSACTIONS) {
      await request(app)
        .post(`/portfolios/${portfolioId}/transactions`)
        .send({ ...tx, currency: 'AUD' });
    }

    const res = await request(app)
      .get(`/portfolios/${portfolioId}/returns?from=2025-10-29&to=2026-02-04`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      beginningValue: expect.closeTo(5178, 1),  // 500 ZIP * $4.00 + 200 NXT * $15.89
      endingValue: expect.closeTo(4082, 1),      // 600 ZIP * $2.52 + 200 NXT * $12.85
      holdingPeriodReturn: expect.closeTo(-0.1966, 2),
      mwr: expect.closeTo(-0.6473, 2),
    });
  });

  it('live prices (2025-10-29 to 2026-03-08): endingValue=$3848 (600 ZIP @ $1.85 + 200 NXT @ $13.69), holdingPeriodReturn=-22.78%, annualisedMWR=-61.66% — matches Simply Wall St (-22.8%, -61.7%)', async () => {
    injectPrice('ZIP', '2026-03-08', 1.85);
    injectPrice('NXT', '2026-03-08', 13.69);

    const portfolioRes = await request(app)
      .post('/portfolios')
      .send({ name: 'ZIP + NXT Portfolio (live)', currency: 'AUD' });
    const portfolioId = portfolioRes.body.id;

    for (const tx of ALL_TRANSACTIONS) {
      await request(app)
        .post(`/portfolios/${portfolioId}/transactions`)
        .send({ ...tx, currency: 'AUD' });
    }

    const res = await request(app)
      .get(`/portfolios/${portfolioId}/returns?from=2025-10-29&to=2026-03-08`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      beginningValue: expect.closeTo(5178, 1),  // 500 ZIP * $4.00 + 200 NXT * $15.89
      endingValue: expect.closeTo(3848, 1),      // 600 ZIP * $1.85 + 200 NXT * $13.69
      holdingPeriodReturn: expect.closeTo(-0.2278, 2),
      mwr: expect.closeTo(-0.6166, 2),
    });
  });
});

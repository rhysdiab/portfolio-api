import request from 'supertest';
import app from '../src/app';
import { setPriceMap, resetPrices } from '../src/services/priceService';
import { store } from '../src/store';

beforeEach(() => {
  store.portfolios.clear();
  store.transactions.clear();
  resetPrices();
});

describe('Portfolios', () => {
  it('POST /portfolios — creates a portfolio and returns it with an id', async () => {
    const res = await request(app)
      .post('/portfolios')
      .send({ name: 'Dicker Data', currency: 'AUD' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Dicker Data', currency: 'AUD' });
    expect(res.body.id).toBeDefined();
  });

  it('GET /portfolios — returns all created portfolios', async () => {
    await request(app).post('/portfolios').send({ name: 'Portfolio A', currency: 'AUD' });
    await request(app).post('/portfolios').send({ name: 'Portfolio B', currency: 'AUD' });

    const res = await request(app).get('/portfolios');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(['Portfolio A', 'Portfolio B'])
    );
  });

  it('DELETE /portfolios/:id — deletes the portfolio and cascades to its transactions', async () => {
    const portfolioRes = await request(app)
      .post('/portfolios')
      .send({ name: 'To Delete', currency: 'AUD' });
    const portfolioId = portfolioRes.body.id;

    await request(app)
      .post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'buy', ticker: 'DDR', date: '2025-10-29', amount: 100, price: 10.51 });

    await request(app).delete(`/portfolios/${portfolioId}`);

    const getRes = await request(app).get(`/portfolios/${portfolioId}`);
    expect(getRes.status).toBe(404);

    // Transactions should also be gone
    expect(store.getTransactionsForPortfolio(portfolioId)).toHaveLength(0);
  });
});

describe('Transactions', () => {
  it('POST /portfolios/:id/transactions — records a buy transaction with correct fields', async () => {
    const portfolioRes = await request(app)
      .post('/portfolios')
      .send({ name: 'Dicker Data', currency: 'AUD' });
    const portfolioId = portfolioRes.body.id;

    const res = await request(app)
      .post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'buy', ticker: 'DDR', date: '2025-10-29', amount: 100, price: 10.51 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'buy',
      ticker: 'DDR',
      date: '2025-10-29',
      amount: 100,
      price: 10.51,
      currency: 'AUD',
    });
  });

  it('GET /portfolios/:id/transactions — lists all transactions for a portfolio', async () => {
    const portfolioRes = await request(app)
      .post('/portfolios')
      .send({ name: 'Dicker Data', currency: 'AUD' });
    const portfolioId = portfolioRes.body.id;

    await request(app).post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'buy', ticker: 'DDR', date: '2025-10-29', amount: 100, price: 10.51 });
    await request(app).post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'sell', ticker: 'DDR', date: '2026-02-04', amount: 50, price: 9.89 });

    const res = await request(app).get(`/portfolios/${portfolioId}/transactions`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /portfolios/:id/transactions?ticker=DDR — filters transactions by ticker', async () => {
    const portfolioRes = await request(app)
      .post('/portfolios')
      .send({ name: 'Mixed', currency: 'AUD' });
    const portfolioId = portfolioRes.body.id;

    await request(app).post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'buy', ticker: 'DDR', date: '2025-10-29', amount: 100, price: 10.51 });
    await request(app).post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'buy', ticker: 'CBA', date: '2025-10-29', amount: 10, price: 150.00 });

    const res = await request(app).get(`/portfolios/${portfolioId}/transactions?ticker=DDR`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].ticker).toBe('DDR');
  });

  it('DELETE /portfolios/:id/transactions/:txId — removes the transaction', async () => {
    const portfolioRes = await request(app)
      .post('/portfolios')
      .send({ name: 'Dicker Data', currency: 'AUD' });
    const portfolioId = portfolioRes.body.id;

    const txRes = await request(app)
      .post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'buy', ticker: 'DDR', date: '2025-10-29', amount: 100, price: 10.51 });

    const deleteRes = await request(app)
      .delete(`/portfolios/${portfolioId}/transactions/${txRes.body.id}`);
    expect(deleteRes.status).toBe(204);

    const listRes = await request(app).get(`/portfolios/${portfolioId}/transactions`);
    expect(listRes.body).toHaveLength(0);
  });
});

describe('Returns', () => {
  it('buy-and-hold DDR: beginningValue=$1051, endingValue=$989, holdingPeriodReturn=-5.9%, annualisedMWR=-20.26%', async () => {
    setPriceMap({ DDR: { '2025-10-29': 10.51, '2026-02-04': 9.89 } });

    const portfolioRes = await request(app)
      .post('/portfolios')
      .send({ name: 'Dicker Data', currency: 'AUD' });
    const portfolioId = portfolioRes.body.id;

    await request(app).post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'buy', ticker: 'DDR', date: '2025-10-29', amount: 100, price: 10.51 });

    const res = await request(app)
      .get(`/portfolios/${portfolioId}/returns?from=2025-10-29&to=2026-02-04`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      beginningValue: expect.closeTo(1051, 2),
      endingValue: expect.closeTo(989, 2),
      holdingPeriodReturn: expect.closeTo(-0.059, 2),
      mwr: expect.closeTo(-0.2026, 2),
    });
  });

  it('mid-period top-up: buying 50 more DDR at $10.80 increases exposure before price falls, endingValue=$1483.50, MWR worse than buy-and-hold', async () => {
    setPriceMap({ DDR: { '2025-10-29': 10.51, '2025-12-01': 10.80, '2026-02-04': 9.89 } });

    const portfolioRes = await request(app)
      .post('/portfolios')
      .send({ name: 'DDR Averaged Down', currency: 'AUD' });
    const portfolioId = portfolioRes.body.id;

    await request(app).post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'buy', ticker: 'DDR', date: '2025-10-29', amount: 100, price: 10.51 });
    await request(app).post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'buy', ticker: 'DDR', date: '2025-12-01', amount: 50, price: 10.80 });

    const res = await request(app)
      .get(`/portfolios/${portfolioId}/returns?from=2025-10-29&to=2026-02-04`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      endingValue: expect.closeTo(1483.5, 1),
      mwr: expect.closeTo(-0.2551, 2),
    });
  });

  it('partial sell mid-period: selling 50 DDR at $10.20 returns capital, reducing exposure to price decline', async () => {
    setPriceMap({ DDR: { '2025-10-29': 10.51, '2025-12-15': 10.20, '2026-02-04': 9.89 } });

    const portfolioRes = await request(app)
      .post('/portfolios')
      .send({ name: 'DDR Partial Exit', currency: 'AUD' });
    const portfolioId = portfolioRes.body.id;

    await request(app).post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'buy', ticker: 'DDR', date: '2025-10-29', amount: 100, price: 10.51 });
    await request(app).post(`/portfolios/${portfolioId}/transactions`)
      .send({ type: 'sell', ticker: 'DDR', date: '2025-12-15', amount: 50, price: 10.20 });

    const res = await request(app)
      .get(`/portfolios/${portfolioId}/returns?from=2025-10-29&to=2026-02-04`);

    expect(res.status).toBe(200);
    // 50 remaining shares * $9.89 = $494.50
    expect(res.body.endingValue).toBeCloseTo(494.5, 1);
    expect(res.body.netCashFlow).toBeCloseTo(510, 0); // sell proceeds
  });

  it('returns 400 when from or to query params are missing', async () => {
    const portfolioRes = await request(app)
      .post('/portfolios')
      .send({ name: 'Test', currency: 'AUD' });

    const res = await request(app)
      .get(`/portfolios/${portfolioRes.body.id}/returns?from=2025-10-29`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('returns 404 for a non-existent portfolio', async () => {
    const res = await request(app)
      .get('/portfolios/non-existent-id/returns?from=2025-10-29&to=2026-02-04');

    expect(res.status).toBe(404);
  });
});

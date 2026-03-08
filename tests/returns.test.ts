import { calculateMWR, getHoldings, getPortfolioValue, solveIRR } from '../src/calculations/returns';
import { setPriceMap, resetPrices } from '../src/services/priceService';
import { Transaction } from '../src/types';

beforeEach(() => {
  resetPrices();
});

// ---------------------------------------------------------------------------
// solveIRR
// ---------------------------------------------------------------------------

describe('solveIRR', () => {
  it('returns ~10% for a simple annual investment that grows 10%', () => {
    // Invest 1000 today, receive 1100 in 365 days
    const cashFlows = [
      { days: 0, amount: -1000 },
      { days: 365, amount: 1100 },
    ];
    const irr = solveIRR(cashFlows);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(0.1, 4);
  });

  it('returns 0% when ending value equals beginning value with no flows', () => {
    const cashFlows = [
      { days: 0, amount: -1000 },
      { days: 365, amount: 1000 },
    ];
    const irr = solveIRR(cashFlows);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(0.0, 4);
  });

  it('returns a negative rate when the portfolio loses value', () => {
    const cashFlows = [
      { days: 0, amount: -1000 },
      { days: 365, amount: 800 },
    ];
    const irr = solveIRR(cashFlows);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(-0.2, 4);
  });

  it('handles a 6-month period correctly', () => {
    // ~20% annualised over 6 months means ending value ≈ 1000 * (1.2)^(182.5/365) ≈ 1096.6
    const cashFlows = [
      { days: 0, amount: -1000 },
      { days: 182, amount: 1095 },
    ];
    const irr = solveIRR(cashFlows);
    expect(irr).not.toBeNull();
    expect(irr!).toBeGreaterThan(0.18);
    expect(irr!).toBeLessThan(0.22);
  });
});

// ---------------------------------------------------------------------------
// getHoldings
// ---------------------------------------------------------------------------

describe('getHoldings', () => {
  const txs: Transaction[] = [
    { id: '1', portfolioId: 'p1', type: 'buy', ticker: 'CBA', date: '2023-01-10', amount: 100, price: 100, currency: 'AUD' },
    { id: '2', portfolioId: 'p1', type: 'buy', ticker: 'BHP', date: '2023-02-01', amount: 50, price: 40, currency: 'AUD' },
    { id: '3', portfolioId: 'p1', type: 'sell', ticker: 'CBA', date: '2023-03-15', amount: 40, price: 110, currency: 'AUD' },
  ];

  it('returns correct holdings as of a date before any sells', () => {
    const h = getHoldings(txs, '2023-02-28');
    expect(h['CBA']).toBe(100);
    expect(h['BHP']).toBe(50);
  });

  it('applies sells correctly', () => {
    const h = getHoldings(txs, '2023-12-31');
    expect(h['CBA']).toBe(60); // 100 - 40
    expect(h['BHP']).toBe(50);
  });

  it('excludes transactions after the asOfDate', () => {
    const h = getHoldings(txs, '2023-01-31');
    expect(h['CBA']).toBe(100);
    expect(h['BHP']).toBeUndefined(); // purchased on 2023-02-01
  });

  it('removes ticker when fully sold', () => {
    const fullSell: Transaction[] = [
      { id: '1', portfolioId: 'p1', type: 'buy', ticker: 'ANZ', date: '2023-01-01', amount: 50, price: 20, currency: 'AUD' },
      { id: '2', portfolioId: 'p1', type: 'sell', ticker: 'ANZ', date: '2023-06-01', amount: 50, price: 25, currency: 'AUD' },
    ];
    const h = getHoldings(fullSell, '2023-12-31');
    expect(h['ANZ']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getPortfolioValue
// ---------------------------------------------------------------------------

describe('getPortfolioValue', () => {
  it('calculates correct value from holdings and prices', () => {
    setPriceMap({
      CBA: { '2023-06-30': 100 },
      BHP: { '2023-06-30': 40 },
    });
    const value = getPortfolioValue({ CBA: 10, BHP: 25 }, '2023-06-30');
    expect(value).toBe(10 * 100 + 25 * 40); // 2000
  });

  it('returns null when a price is missing', () => {
    setPriceMap({ CBA: { '2023-06-30': 100 } });
    const value = getPortfolioValue({ CBA: 10, BHP: 25 }, '2023-06-30');
    expect(value).toBeNull();
  });

  it('returns 0 for empty holdings', () => {
    setPriceMap({});
    const value = getPortfolioValue({}, '2023-06-30');
    expect(value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMWR — integration-style tests
// ---------------------------------------------------------------------------

describe('calculateMWR', () => {
  it('returns ~0% MWR when portfolio value is unchanged and no cash flows', () => {
    setPriceMap({
      CBA: {
        '2023-01-01': 100,
        '2023-12-31': 100,
      },
    });

    const txs: Transaction[] = [
      { id: '1', portfolioId: 'p1', type: 'buy', ticker: 'CBA', date: '2023-01-01', amount: 10, price: 100, currency: 'AUD' },
    ];

    const result = calculateMWR(txs, '2023-01-01', '2023-12-31', 'p1');
    expect(result.mwr).toBeCloseTo(0, 3);
  });

  it('returns ~10% annualised MWR for a simple buy-and-hold that grows 10% over a year', () => {
    setPriceMap({
      CBA: {
        '2023-01-01': 100,
        '2023-12-31': 110,
      },
    });

    const txs: Transaction[] = [
      { id: '1', portfolioId: 'p1', type: 'buy', ticker: 'CBA', date: '2023-01-01', amount: 10, price: 100, currency: 'AUD' },
    ];

    // beginningValue = 10 * 100 = 1000, endingValue = 10 * 110 = 1100
    const result = calculateMWR(txs, '2023-01-01', '2023-12-31', 'p1');
    expect(result.mwr).toBeCloseTo(0.1, 3);
    expect(result.beginningValue).toBe(1000);
    expect(result.endingValue).toBe(1100);
  });

  it('accounts for a mid-period buy correctly', () => {
    // CBA: start 100, mid 105, end 110
    setPriceMap({
      CBA: {
        '2023-01-01': 100,
        '2023-07-02': 105, // used for lookback when price needed on that date
        '2023-12-31': 110,
      },
    });

    const txs: Transaction[] = [
      // Initial 10 shares at start
      { id: '1', portfolioId: 'p1', type: 'buy', ticker: 'CBA', date: '2023-01-01', amount: 10, price: 100, currency: 'AUD' },
      // Buy 5 more shares mid-year at 105
      { id: '2', portfolioId: 'p1', type: 'buy', ticker: 'CBA', date: '2023-07-02', amount: 5, price: 105, currency: 'AUD' },
    ];

    const result = calculateMWR(txs, '2023-01-01', '2023-12-31', 'p1');
    // 15 shares at end * 110 = 1650, started with 10 * 100 = 1000
    expect(result.beginningValue).toBe(1000);
    expect(result.endingValue).toBe(1650);
    // MWR should reflect that more capital was deployed at a higher price mid-year
    expect(result.mwr).toBeGreaterThan(0);
  });

  it('handles a partial sell during the period', () => {
    setPriceMap({
      CBA: {
        '2023-01-01': 100,
        '2023-12-31': 120,
      },
    });

    const txs: Transaction[] = [
      { id: '1', portfolioId: 'p1', type: 'buy', ticker: 'CBA', date: '2022-06-01', amount: 20, price: 90, currency: 'AUD' },
      { id: '2', portfolioId: 'p1', type: 'sell', ticker: 'CBA', date: '2023-06-01', amount: 5, price: 110, currency: 'AUD' },
    ];

    const result = calculateMWR(txs, '2023-01-01', '2023-12-31', 'p1');
    // Beginning: 20 shares * 100 = 2000
    // Sell 5 during period: +550 inflow
    // End: 15 shares * 120 = 1800
    expect(result.beginningValue).toBe(2000);
    expect(result.endingValue).toBe(1800);
    expect(result.mwr).toBeGreaterThan(0); // sold at 110, ends at 120 on remaining
  });

  it('throws when from >= to', () => {
    setPriceMap({ CBA: { '2023-01-01': 100 } });
    const txs: Transaction[] = [];
    expect(() => calculateMWR(txs, '2023-06-01', '2023-01-01', 'p1')).toThrow();
    expect(() => calculateMWR(txs, '2023-01-01', '2023-01-01', 'p1')).toThrow();
  });

  it('throws when a price is unavailable', () => {
    setPriceMap({}); // no prices
    const txs: Transaction[] = [
      { id: '1', portfolioId: 'p1', type: 'buy', ticker: 'CBA', date: '2023-01-01', amount: 10, price: 100, currency: 'AUD' },
    ];
    expect(() => calculateMWR(txs, '2023-01-01', '2023-12-31', 'p1')).toThrow(/missing prices/);
  });
});

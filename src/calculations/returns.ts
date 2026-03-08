import { Transaction, ReturnResult } from '../types';
import { getPriceOnOrBefore } from '../services/priceService';

const DAYS_IN_YEAR = 365;
const IRR_MAX_ITERATIONS = 1000;
const IRR_TOLERANCE = 1e-8;

/**
 * Calculate portfolio holdings (ticker -> units) from a list of transactions
 * up to and including a given date.
 */
export function getHoldings(
  transactions: Transaction[],
  asOfDate: string
): Record<string, number> {
  const holdings: Record<string, number> = {};

  for (const tx of transactions) {
    if (tx.date > asOfDate) continue;

    if (!holdings[tx.ticker]) holdings[tx.ticker] = 0;

    if (tx.type === 'buy') {
      holdings[tx.ticker] += tx.amount;
    } else {
      holdings[tx.ticker] -= tx.amount;
    }
  }

  // Remove zero or negative holdings (fully sold positions)
  for (const ticker of Object.keys(holdings)) {
    if (holdings[ticker] <= 0) delete holdings[ticker];
  }

  return holdings;
}

/**
 * Calculate the market value of a set of holdings at a given date.
 * Returns null if any price is unavailable.
 */
export function getPortfolioValue(
  holdings: Record<string, number>,
  date: string
): number | null {
  let total = 0;

  for (const [ticker, units] of Object.entries(holdings)) {
    const price = getPriceOnOrBefore(ticker, date);
    if (price === undefined) return null;
    total += units * price;
  }

  return total;
}

/**
 * Net Present Value of a series of cash flows at rate r.
 * Each cash flow has a date; t=0 is the anchor date.
 * Time is measured in years (actual/365).
 */
function npv(cashFlows: Array<{ days: number; amount: number }>, r: number): number {
  return cashFlows.reduce((sum, cf) => {
    const t = cf.days / DAYS_IN_YEAR;
    return sum + cf.amount / Math.pow(1 + r, t);
  }, 0);
}

function npvDerivative(
  cashFlows: Array<{ days: number; amount: number }>,
  r: number
): number {
  return cashFlows.reduce((sum, cf) => {
    const t = cf.days / DAYS_IN_YEAR;
    return sum - (t * cf.amount) / Math.pow(1 + r, t + 1);
  }, 0);
}

/**
 * Solve for IRR using Newton-Raphson with a bisection fallback.
 * Returns the annualised rate or null if it does not converge.
 */
export function solveIRR(
  cashFlows: Array<{ days: number; amount: number }>
): number | null {
  // Initial guess: 10%
  let r = 0.1;

  for (let i = 0; i < IRR_MAX_ITERATIONS; i++) {
    const f = npv(cashFlows, r);
    const df = npvDerivative(cashFlows, r);

    if (Math.abs(df) < 1e-12) break;

    const rNext = r - f / df;

    if (Math.abs(rNext - r) < IRR_TOLERANCE) return rNext;

    // Guard against divergence — clamp to a reasonable range
    r = Math.max(-0.9999, Math.min(rNext, 100));
  }

  return null;
}

/**
 * Calculate the Money-Weighted Return (MWR) for a portfolio over a given period.
 *
 * The MWR is the IRR of all portfolio cash flows:
 *   - Beginning portfolio value (negative — treated as an initial investment)
 *   - Each buy/sell transaction during the period
 *     (buy = negative cash flow, sell = positive cash flow)
 *   - Ending portfolio value (positive — treated as a liquidation)
 *
 * All cash flows are dated relative to `from` and time is in fractional years (actual/365).
 *
 * @param transactions - All transactions for the portfolio (any date range)
 * @param from         - Start of the return period (inclusive), YYYY-MM-DD
 * @param to           - End of the return period (inclusive), YYYY-MM-DD
 * @param portfolioId  - Used for labelling the result
 * @returns ReturnResult with annualised MWR, or throws if prices are unavailable
 */
export function calculateMWR(
  transactions: Transaction[],
  from: string,
  to: string,
  portfolioId: string
): ReturnResult {
  if (from >= to) {
    throw new Error(`'from' date (${from}) must be before 'to' date (${to})`);
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  const periodDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);

  // Holdings and market value at start of period
  const holdingsAtStart = getHoldings(transactions, from);
  const beginningValue = getPortfolioValue(holdingsAtStart, from);
  if (beginningValue === null) {
    throw new Error(`Cannot determine portfolio value at start date ${from} — missing prices`);
  }

  // Holdings and market value at end of period
  const holdingsAtEnd = getHoldings(transactions, to);
  const endingValue = getPortfolioValue(holdingsAtEnd, to);
  if (endingValue === null) {
    throw new Error(`Cannot determine portfolio value at end date ${to} — missing prices`);
  }

  // Transactions that occur strictly within the period (after from, up to and including to)
  const inPeriod = transactions.filter((tx) => tx.date > from && tx.date <= to);

  // Build cash flow array (days from `from`)
  const cashFlows: Array<{ days: number; amount: number }> = [];

  // t=0: beginning value is an outflow (we "pay" it to hold the portfolio)
  cashFlows.push({ days: 0, amount: -beginningValue });

  let netCashFlow = 0;
  for (const tx of inPeriod) {
    const txDate = new Date(tx.date);
    const days = (txDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    const value = tx.amount * tx.price;

    // Buy = money leaves the investor (negative), sell = money returns (positive)
    const cfAmount = tx.type === 'sell' ? value : -value;
    cashFlows.push({ days, amount: cfAmount });
    netCashFlow += cfAmount;
  }

  // t=end: ending value is an inflow (we "receive" it on liquidation)
  cashFlows.push({ days: periodDays, amount: endingValue });

  const irr = solveIRR(cashFlows);
  if (irr === null) {
    throw new Error('IRR did not converge — check that the portfolio has valid cash flows');
  }

  // Holding period return: (endingValue + inflows - outflows - beginningValue) / beginningValue
  const totalInflows = endingValue + inPeriod
    .filter((tx) => tx.type === 'sell')
    .reduce((sum, tx) => sum + tx.amount * tx.price, 0);
  const totalOutflows = beginningValue + inPeriod
    .filter((tx) => tx.type === 'buy')
    .reduce((sum, tx) => sum + tx.amount * tx.price, 0);
  const holdingPeriodReturn = (totalInflows - totalOutflows) / totalOutflows;

  // Annualise: the IRR from solveIRR is already annualised (actual/365 discounting)
  return {
    portfolioId,
    from,
    to,
    mwr: irr,
    holdingPeriodReturn,
    beginningValue,
    endingValue,
    netCashFlow,
  };
}

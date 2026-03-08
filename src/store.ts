/**
 * In-memory store.
 *
 * Shortcut: a production implementation would use a relational database
 * (e.g. PostgreSQL) with tables for portfolios and transactions, indexed
 * on portfolioId and date. Transactions should be append-only (no updates)
 * to preserve an audit trail.
 */
import { Portfolio, Transaction } from './types';

const portfolios = new Map<string, Portfolio>();
const transactions = new Map<string, Transaction>();

export const store = {
  portfolios,
  transactions,

  getTransactionsForPortfolio(portfolioId: string): Transaction[] {
    return Array.from(transactions.values()).filter(
      (t) => t.portfolioId === portfolioId
    );
  },
};

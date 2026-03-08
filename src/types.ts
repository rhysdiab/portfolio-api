export type TransactionType = 'buy' | 'sell';

export interface Transaction {
  id: string;
  portfolioId: string;
  type: TransactionType;
  ticker: string;
  date: string; // ISO date string YYYY-MM-DD
  amount: number; // number of units
  price: number; // price per unit in transaction currency
  currency: string; // e.g. "AUD"
}

export interface Portfolio {
  id: string;
  name: string;
  currency: string; // base currency, e.g. "AUD"
  createdAt: string;
}

// Map of ticker -> date -> closing price
export type PriceMap = Record<string, Record<string, number>>;

export interface ReturnResult {
  portfolioId: string;
  from: string;
  to: string;
  mwr: number; // annualised money-weighted return as a decimal, e.g. 0.12 = 12%
  holdingPeriodReturn: number; // raw return over the period, not annualised, e.g. 0.059 = 5.9%
  beginningValue: number;
  endingValue: number;
  netCashFlow: number;
}

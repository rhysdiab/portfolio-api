import * as fs from 'fs';
import * as path from 'path';
import { PriceMap } from '../types';

/**
 * Price service backed by the ASX dataset (tab-separated).
 *
 * Expected columns (amongst others):
 *   TICKER_SYMBOL   PRICING_DATE                PRICE_CLOSE
 *   ORG             2026-02-04 00:00:00+00      11.12
 *
 * Shortcut: currently loads the entire file into memory on startup.
 * A production implementation would use a time-series database (e.g. TimescaleDB)
 * or a dedicated market data service with caching.
 *
 * Currency handling shortcut: PRICE_CLOSE (AUD) is used directly.
 * Production would store currency per price record and apply FX conversion
 * when calculating portfolio value in the portfolio's base currency.
 */

let priceMap: PriceMap = {};
let loaded = false;

export function loadPrices(csvPath?: string): void {
  const filePath = csvPath ?? path.join(__dirname, '../../data/prices.csv');

  if (!fs.existsSync(filePath)) {
    console.warn(`Price file not found at ${filePath}. Using empty price map.`);
    loaded = true;
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  // Parse header to find column indices — makes parsing resilient to column reordering
  const headers = lines[0].split(',').map((h) => h.trim());
  const tickerIdx = headers.indexOf('TICKER_SYMBOL');
  const dateIdx = headers.indexOf('PRICING_DATE');
  const closeIdx = headers.indexOf('PRICE_CLOSE');

  if (tickerIdx === -1 || dateIdx === -1 || closeIdx === -1) {
    throw new Error(
      `prices.csv is missing required columns. Expected TICKER_SYMBOL, PRICING_DATE, PRICE_CLOSE. Found: ${headers.join(', ')}`
    );
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length <= Math.max(tickerIdx, dateIdx, closeIdx)) continue;

    const ticker = cols[tickerIdx].trim();
    // PRICING_DATE is "2026-02-04 00:00:00+00" — take the date portion only
    const date = cols[dateIdx].trim().split(' ')[0];
    const close = parseFloat(cols[closeIdx].trim());

    if (!ticker || !date || isNaN(close)) continue;

    if (!priceMap[ticker]) priceMap[ticker] = {};
    priceMap[ticker][date] = close;
  }

  loaded = true;
}

export function getPrice(ticker: string, date: string): number | undefined {
  if (!loaded) loadPrices();
  return priceMap[ticker]?.[date];
}

/**
 * Returns the closest available price on or before the given date.
 * Looks back up to maxLookbackDays to handle weekends/public holidays.
 */
export function getPriceOnOrBefore(
  ticker: string,
  date: string,
  maxLookbackDays = 7
): number | undefined {
  if (!loaded) loadPrices();

  const d = new Date(date);
  for (let i = 0; i <= maxLookbackDays; i++) {
    const candidate = new Date(d);
    candidate.setDate(d.getDate() - i);
    const key = candidate.toISOString().split('T')[0];
    const price = priceMap[ticker]?.[key];
    if (price !== undefined) return price;
  }
  return undefined;
}

/** Inject a price map directly — used in tests to avoid file I/O */
export function setPriceMap(map: PriceMap): void {
  priceMap = map;
  loaded = true;
}

/** Inject a single price on top of an already-loaded price map — used in tests to add live prices */
export function injectPrice(ticker: string, date: string, price: number): void {
  if (!priceMap[ticker]) priceMap[ticker] = {};
  priceMap[ticker][date] = price;
}

export function resetPrices(): void {
  priceMap = {};
  loaded = false;
}

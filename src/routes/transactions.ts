import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { store } from '../store';
import { Transaction } from '../types';

const router = Router({ mergeParams: true });

// POST /portfolios/:portfolioId/transactions
router.post('/', (req: Request, res: Response) => {
  const { portfolioId } = req.params;

  if (!store.portfolios.has(portfolioId)) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  const { type, ticker, date, amount, price, currency = 'AUD' } = req.body;

  if (!type || !ticker || !date || amount == null || price == null) {
    return res.status(400).json({ error: 'type, ticker, date, amount and price are required' });
  }

  if (type !== 'buy' && type !== 'sell') {
    return res.status(400).json({ error: 'type must be "buy" or "sell"' });
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  if (typeof price !== 'number' || price < 0) {
    return res.status(400).json({ error: 'price must be a non-negative number' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
  }

  const transaction: Transaction = {
    id: uuidv4(),
    portfolioId,
    type,
    ticker: ticker.toUpperCase(),
    date,
    amount,
    price,
    currency,
  };

  store.transactions.set(transaction.id, transaction);
  return res.status(201).json(transaction);
});

// GET /portfolios/:portfolioId/transactions
router.get('/', (req: Request, res: Response) => {
  const { portfolioId } = req.params;

  if (!store.portfolios.has(portfolioId)) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  let txs = store.getTransactionsForPortfolio(portfolioId);

  // Optional filters
  const { from, to, ticker } = req.query;
  if (from) txs = txs.filter((t) => t.date >= (from as string));
  if (to) txs = txs.filter((t) => t.date <= (to as string));
  if (ticker) txs = txs.filter((t) => t.ticker === (ticker as string).toUpperCase());

  return res.json(txs);
});

// DELETE /portfolios/:portfolioId/transactions/:txId
router.delete('/:txId', (req: Request, res: Response) => {
  const { portfolioId, txId } = req.params;

  const tx = store.transactions.get(txId);
  if (!tx || tx.portfolioId !== portfolioId) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  store.transactions.delete(txId);
  return res.status(204).send();
});

export default router;

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { store } from '../store';
import { Portfolio } from '../types';
import { calculateMWR } from '../calculations/returns';

const router = Router();

// POST /portfolios
router.post('/', (req: Request, res: Response) => {
  const { name, currency = 'AUD' } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }

  const portfolio: Portfolio = {
    id: uuidv4(),
    name,
    currency,
    createdAt: new Date().toISOString(),
  };

  store.portfolios.set(portfolio.id, portfolio);
  return res.status(201).json(portfolio);
});

// GET /portfolios
router.get('/', (_req: Request, res: Response) => {
  return res.json(Array.from(store.portfolios.values()));
});

// GET /portfolios/:id
router.get('/:id', (req: Request, res: Response) => {
  const portfolio = store.portfolios.get(req.params.id);
  if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });

  return res.json(portfolio);
});

// DELETE /portfolios/:id
router.delete('/:id', (req: Request, res: Response) => {
  if (!store.portfolios.has(req.params.id)) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  store.portfolios.delete(req.params.id);

  // Cascade delete transactions
  for (const [id, tx] of store.transactions) {
    if (tx.portfolioId === req.params.id) store.transactions.delete(id);
  }

  return res.status(204).send();
});

// GET /portfolios/:id/returns?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/:id/returns', (req: Request, res: Response) => {
  const portfolio = store.portfolios.get(req.params.id);
  if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });

  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to query params are required (YYYY-MM-DD)' });
  }

  try {
    const txs = store.getTransactionsForPortfolio(req.params.id);
    const result = calculateMWR(txs, from as string, to as string, req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(422).json({ error: (err as Error).message });
  }
});

export default router;

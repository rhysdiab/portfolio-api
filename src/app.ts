import express from 'express';
import portfolioRoutes from './routes/portfolios';
import transactionRoutes from './routes/transactions';

const app = express();
app.use(express.json());

app.use('/portfolios', portfolioRoutes);
app.use('/portfolios/:portfolioId/transactions', transactionRoutes);

export default app;

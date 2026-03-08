import app from './app';
import { loadPrices } from './services/priceService';

loadPrices();

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Portfolio API running on port ${PORT}`);
});

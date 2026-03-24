const express = require('express');
const cors = require('cors');
const { getUSDCToFiatRates, getXLMToUSDCPath } = require('./services/priceFeedService');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    project: 'LeaseFlow Protocol', 
    status: 'Active',
    contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4'
  });
});

/**
 * Get current USDC to Fiat exchange rates.
 * Query params: currencies (comma-separated list of fiat currency codes, e.g., 'ngn,eur')
 */
app.get('/api/price-feed', async (req, res) => {
  try {
    const { currencies } = req.query;
    const currencyList = currencies ? currencies.split(',') : ['ngn', 'eur', 'usd'];
    const rates = await getUSDCToFiatRates(currencyList);
    res.json({ 
      success: true, 
      rates,
      base_currency: 'USDC' 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

/**
 * Calculate the best path for XLM to USDC payment.
 * Query params: amount (destination USDC amount)
 */
app.get('/api/calculate-path-payment', async (req, res) => {
  try {
    const { amount } = req.query;
    if (!amount) {
      return res.status(400).json({ 
        success: false, 
        message: 'Destination amount is required.' 
      });
    }

    const pathDetails = await getXLMToUSDCPath(amount);
    res.json({ 
      success: true, 
      ...pathDetails 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
  });
}

module.exports = app;

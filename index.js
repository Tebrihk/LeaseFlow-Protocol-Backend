const express = require('express');
const cors = require('cors');
const { TenantCreditScoreAggregator } = require('./tenantCreditScoreAggregator');
const app = express();
const port = 3000;
const creditScoreAggregator = new TenantCreditScoreAggregator();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    project: 'LeaseFlow Protocol', 
    status: 'Active',
    contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4'
  });
});

app.post('/tenant-credit-score', (req, res) => {
  try {
    const { tenantId, metrics = {}, cacheTtlSeconds } = req.body || {};
    const result = creditScoreAggregator.getOrCompute(tenantId, metrics, cacheTtlSeconds);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/tenant-credit-score/:tenantId', (req, res) => {
  const cached = creditScoreAggregator.getCached(req.params.tenantId);
  if (!cached) {
    return res.status(404).json({ error: 'No cached score found for tenant' });
  }
  return res.status(200).json(cached);
});

app.post('/tenant-credit-score/share-token', (req, res) => {
  try {
    const { tenantId, tokenTtlSeconds } = req.body || {};
    const result = creditScoreAggregator.generateShareToken(tenantId, tokenTtlSeconds);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/tenant-credit-score/verify-token', (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      throw new Error('token is required');
    }
    const payload = creditScoreAggregator.verifyShareToken(token);
    res.status(200).json({ valid: true, payload });
  } catch (error) {
    res.status(400).json({ valid: false, error: error.message });
  }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
  });
}

module.exports = app;

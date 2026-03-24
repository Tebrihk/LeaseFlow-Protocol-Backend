const express = require('express');
const cors = require('cors');
const AvailabilityService = require('./services/availabilityService');
const AutoReclaimWorker = require('./services/autoReclaimWorker');

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
  const availabilityService = new AvailabilityService();

  availabilityService.initialize().then(() => {
    app.locals.availabilityService = availabilityService;
    app.listen(port, () => {
      console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
      console.log('Availability Service started');
    });
  }).catch(error => {
    console.error('Failed to initialize Availability Service:', error);
app.get('/status', (req, res) => {
  res.json({
    auto_reclaim_worker: 'Active',
    schedule: 'Every 10 minutes',
    last_check: new Date().toISOString()
  });
});

if (require.main === module) {
  const autoReclaimWorker = new AutoReclaimWorker();

  autoReclaimWorker.initialize().then(() => {
    autoReclaimWorker.start();
    app.listen(port, () => {
      console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
      console.log('Auto-Reclaim Worker started');
    });
  }).catch(error => {
    console.error('Failed to initialize Auto-Reclaim Worker:', error);
    process.exit(1);
  });
}

const availabilityService = new AvailabilityService();
module.exports = app;

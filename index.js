const express = require('express');
const cors = require('cors');
const AutoReclaimWorker = require('./services/autoReclaimWorker');

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

module.exports = app;

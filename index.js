require('dotenv').config();

const express = require('express');
const cors = require('cors');
const {
  createSecurityDepositLockService,
  requireLockedSecurityDeposit,
} = require('./services/securityDepositLock');

const port = process.env.PORT || 3000;

function createApp({ securityDepositService } = {}) {
  const app = express();
  const depositGatekeeper =
    securityDepositService ?? createSecurityDepositLockService();

  app.use(cors());
  app.use(express.json());

  app.get('/', (req, res) => {
    res.json({
      project: 'LeaseFlow Protocol',
      status: 'Active',
      contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4',
    });
  });

  app.post(
    '/move-in/generate-digital-key',
    requireLockedSecurityDeposit({
      action: 'Generate Digital Key',
      service: depositGatekeeper,
    }),
    (req, res) => {
      res.status(200).json({
        action: 'Generate Digital Key',
        allowed: true,
        message:
          'Security deposit verified. Digital key generation is authorized.',
        verification: req.securityDepositVerification,
      });
    },
  );

  app.post(
    '/move-in/release-address',
    requireLockedSecurityDeposit({
      action: 'Release Address',
      service: depositGatekeeper,
    }),
    (req, res) => {
      res.status(200).json({
        action: 'Release Address',
        allowed: true,
        message: 'Security deposit verified. Address release is authorized.',
        verification: req.securityDepositVerification,
      });
    },
  );

  return app;
}

const app = createApp();

if (require.main === module) {
  app.listen(port, () => {
    console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
  });
}

module.exports = app;
module.exports.app = app;
module.exports.createApp = createApp;

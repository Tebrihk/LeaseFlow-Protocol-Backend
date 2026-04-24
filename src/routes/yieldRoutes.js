const express = require('express');
const { YieldController } = require('../controllers/yieldController');

/**
 * Create yield analytics routes
 * @param {object} database - Database instance
 * @param {object} redisClient - Redis client instance (optional)
 * @returns {express.Router} Express router with yield routes
 */
function createYieldRoutes(database, redisClient = null) {
  const router = express.Router();
  const yieldController = new YieldController(database, redisClient);

  // GET /api/v1/users/:pubkey/yield-history
  // Returns aggregated yield earnings by month and asset
  router.get('/users/:pubkey/yield-history', (req, res) => {
    yieldController.getYieldHistory(req, res);
  });

  // GET /api/v1/users/:pubkey/yield-summary
  // Returns total yield earnings summary
  router.get('/users/:pubkey/yield-summary', (req, res) => {
    yieldController.getYieldSummary(req, res);
  });

  // GET /api/v1/yield/verify/:leaseId/:txHash
  // Verify yield aggregation for testing/reconciliation
  router.get('/yield/verify/:leaseId/:txHash', (req, res) => {
    yieldController.verifyYieldAggregation(req, res);
  });

  return router;
}

module.exports = { createYieldRoutes };

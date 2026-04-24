const { YieldService } = require('../services/yieldService');

/**
 * YieldController - Handles yield analytics endpoints
 */
class YieldController {
  constructor(database, redisClient = null) {
    this.yieldService = new YieldService(database, redisClient);
  }

  /**
   * GET /api/v1/users/:pubkey/yield-history
   * Returns aggregated yield earnings by month and asset
   */
  async getYieldHistory(req, res) {
    try {
      const { pubkey } = req.params;
      const { start_date, end_date, format } = req.query;

      // Validate pubkey format (basic Stellar address validation)
      if (!pubkey || typeof pubkey !== 'string' || pubkey.length < 56) {
        return res.status(400).json({
          success: false,
          error: 'Invalid public key format'
        });
      }

      // Parse date parameters
      let startDate = null;
      let endDate = null;

      if (start_date) {
        startDate = new Date(start_date);
        if (isNaN(startDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: 'Invalid start_date format. Use ISO date format (YYYY-MM-DD)'
          });
        }
        startDate = startDate.toISOString().split('T')[0]; // Convert to YYYY-MM-DD
      }

      if (end_date) {
        endDate = new Date(end_date);
        if (isNaN(endDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: 'Invalid end_date format. Use ISO date format (YYYY-MM-DD)'
          });
        }
        endDate = endDate.toISOString().split('T')[0]; // Convert to YYYY-MM-DD
      }

      // Get yield history
      const history = await this.yieldService.getYieldHistoryByPubkey(pubkey, startDate, endDate);

      // Get total earnings summary
      const totals = await this.yieldService.getTotalYieldEarningsByPubkey(pubkey);

      // Format response based on query parameter
      let response;
      if (format === 'summary') {
        response = {
          success: true,
          data: {
            pubkey,
            period: {
              start_date: startDate || 'all_time',
              end_date: endDate || 'all_time'
            },
            summary: totals,
            monthly_breakdown: history
          }
        };
      } else {
        // Default detailed format
        response = {
          success: true,
          data: {
            pubkey,
            period: {
              start_date: startDate || 'all_time',
              end_date: endDate || 'all_time'
            },
            history: history,
            summary: totals
          }
        };
      }

      res.json(response);

    } catch (error) {
      console.error('[YieldController] Error in getYieldHistory:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * GET /api/v1/users/:pubkey/yield-summary
   * Returns total yield earnings summary
   */
  async getYieldSummary(req, res) {
    try {
      const { pubkey } = req.params;

      // Validate pubkey format
      if (!pubkey || typeof pubkey !== 'string' || pubkey.length < 56) {
        return res.status(400).json({
          success: false,
          error: 'Invalid public key format'
        });
      }

      const totals = await this.yieldService.getTotalYieldEarningsByPubkey(pubkey);

      res.json({
        success: true,
        data: {
          pubkey,
          summary: totals
        }
      });

    } catch (error) {
      console.error('[YieldController] Error in getYieldSummary:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * GET /api/v1/yield/verify/:leaseId/:txHash
   * Verify yield aggregation for testing/reconciliation
   */
  async verifyYieldAggregation(req, res) {
    try {
      const { leaseId, txHash } = req.params;

      if (!leaseId || !txHash) {
        return res.status(400).json({
          success: false,
          error: 'leaseId and txHash are required'
        });
      }

      const verification = this.yieldService.verifyYieldAggregation(leaseId, txHash);

      res.json({
        success: true,
        data: {
          leaseId,
          txHash,
          verification
        }
      });

    } catch (error) {
      console.error('[YieldController] Error in verifyYieldAggregation:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }
}

module.exports = { YieldController };

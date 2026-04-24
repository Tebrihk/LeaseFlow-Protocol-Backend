const { PriceCacheService } = require('./priceCacheService');

/**
 * YieldService - Handles EscrowYieldHarvested events and fiat equivalent calculations
 */
class YieldService {
  constructor(database, redisClient = null) {
    this.database = database;
    this.redisClient = redisClient;
    this.priceCacheService = new PriceCacheService(redisClient);
  }

  /**
   * Process EscrowYieldHarvested event and split earnings between lessor and lessee
   */
  async processYieldHarvestEvent(eventData) {
    const {
      lease_id,
      harvest_tx_hash,
      asset_code,
      asset_issuer,
      total_yield_stroops,
      lessor_pubkey,
      lessee_pubkey,
      harvested_at,
      // Split ratios (can be configured, default 50/50)
      lessor_split_ratio = 0.5,
      lessee_split_ratio = 0.5
    } = eventData;

    try {
      // Convert stroops to decimal (1 stroop = 0.0000001 XLM)
      const totalYieldDecimal = total_yield_stroops / 10000000;
      
      // Calculate splits
      const lessorStroops = Math.floor(total_yield_stroops * lessor_split_ratio);
      const lesseeStroops = total_yield_stroops - lessorStroops; // Ensure no rounding loss
      
      const lessorDecimal = lessorStroops / 10000000;
      const lesseeDecimal = lesseeStroops / 10000000;

      // Get fiat equivalent at harvest time
      const fiatData = await this.calculateFiatEquivalent(asset_code, totalYieldDecimal, harvested_at);

      // Insert records for both parties
      const lessorEarnings = await this.database.insertYieldEarningsLessor({
        leaseId: lease_id,
        lessorPubkey: lessor_pubkey,
        harvestTxHash: harvest_tx_hash,
        assetCode: asset_code,
        assetIssuer: asset_issuer,
        amountStroops: lessorStroops,
        amountDecimal: lessorDecimal,
        fiatEquivalent: fiatData.lessorFiatEquivalent,
        fiatCurrency: fiatData.currency,
        priceAtHarvest: fiatData.price,
        harvestedAt: harvested_at
      });

      const lesseeEarnings = await this.database.insertYieldEarningsLessee({
        leaseId: lease_id,
        lesseePubkey: lessee_pubkey,
        harvestTxHash: harvest_tx_hash,
        assetCode: asset_code,
        assetIssuer: asset_issuer,
        amountStroops: lesseeStroops,
        amountDecimal: lesseeDecimal,
        fiatEquivalent: fiatData.lesseeFiatEquivalent,
        fiatCurrency: fiatData.currency,
        priceAtHarvest: fiatData.price,
        harvestedAt: harvested_at
      });

      // Invalidate cache for affected users
      await this.invalidateYieldCache(lessor_pubkey);
      await this.invalidateYieldCache(lessee_pubkey);

      return {
        success: true,
        lessorEarnings,
        lesseeEarnings,
        totalProcessed: total_yield_stroops,
        fiatData
      };

    } catch (error) {
      console.error('[YieldService] Error processing yield harvest event:', error);
      throw new Error(`Failed to process yield harvest: ${error.message}`);
    }
  }

  /**
   * Calculate fiat equivalent value at the exact time of harvest
   */
  async calculateFiatEquivalent(assetCode, amount, harvestTime) {
    try {
      const currency = 'usd'; // Default to USD, can be made configurable
      
      // Get price data using PriceCacheService for accurate historical pricing
      const priceData = await this.priceCacheService.calculateFiatEquivalent(
        assetCode, 
        amount, 
        harvestTime, 
        currency
      );
      
      const price = priceData.price || 0;
      const lessorFiatEquivalent = price * amount * 0.5; // Lessors get 50%
      const lesseeFiatEquivalent = price * amount * 0.5;  // Lessees get 50%
      
      return {
        currency,
        price,
        lessorFiatEquivalent,
        lesseeFiatEquivalent,
        priceSource: priceData.source,
        timestamp: harvestTime
      };

    } catch (error) {
      console.error('[YieldService] Error calculating fiat equivalent:', error);
      return {
        currency: 'usd',
        price: 0,
        lessorFiatEquivalent: 0,
        lesseeFiatEquivalent: 0,
        priceSource: 'error',
        timestamp: harvestTime
      };
    }
  }

  /**
   * Get yield history with Redis caching
   */
  async getYieldHistoryByPubkey(pubkey, startDate = null, endDate = null) {
    const cacheKey = `yield_history:${pubkey}:${startDate || 'all'}:${endDate || 'all'}`;
    
    // Try cache first
    if (this.redisClient) {
      try {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (error) {
        console.warn('[YieldService] Redis cache read failed:', error.message);
      }
    }

    // Get from database
    const history = this.database.getYieldHistoryByPubkey(pubkey, startDate, endDate);

    // Cache the result for 5 minutes (300 seconds)
    if (this.redisClient && history.length > 0) {
      try {
        await this.redisClient.setex(cacheKey, 300, JSON.stringify(history));
      } catch (error) {
        console.warn('[YieldService] Redis cache write failed:', error.message);
      }
    }

    return history;
  }

  /**
   * Get total yield earnings with caching
   */
  async getTotalYieldEarningsByPubkey(pubkey) {
    const cacheKey = `yield_total:${pubkey}`;
    
    // Try cache first
    if (this.redisClient) {
      try {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (error) {
        console.warn('[YieldService] Redis cache read failed:', error.message);
      }
    }

    // Get from database
    const totals = this.database.getTotalYieldEarningsByPubkey(pubkey);

    // Cache the result for 10 minutes (600 seconds)
    if (this.redisClient) {
      try {
        await this.redisClient.setex(cacheKey, 600, JSON.stringify(totals));
      } catch (error) {
        console.warn('[YieldService] Redis cache write failed:', error.message);
      }
    }

    return totals;
  }

  /**
   * Invalidate yield cache for a user
   */
  async invalidateYieldCache(pubkey) {
    if (!this.redisClient) return;

    try {
      // Delete all cache keys for this user
      const pattern = `yield_*:${pubkey}:*`;
      const keys = await this.redisClient.keys(pattern);
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
      }
    } catch (error) {
      console.warn('[YieldService] Cache invalidation failed:', error.message);
    }
  }

  /**
   * Verify yield aggregation for testing/reconciliation
   */
  verifyYieldAggregation(leaseId, harvestTxHash) {
    return this.database.verifyYieldAggregation(leaseId, harvestTxHash);
  }
}

module.exports = { YieldService };

const { getUSDCToFiatRates } = require('../../services/priceFeedService');

/**
 * PriceCacheService - Caches and manages price data for fiat equivalent calculations
 */
class PriceCacheService {
  constructor(redisClient = null) {
    this.redisClient = redisClient;
    this.cacheTTL = {
      current: 300, // 5 minutes for current prices
      historical: 86400 // 24 hours for historical prices
    };
  }

  /**
   * Get price data for an asset at a specific time
   * Uses cache for current prices, fetches historical data when needed
   */
  async getPriceAtTime(assetCode, timestamp, currency = 'usd') {
    try {
      const cacheKey = this.getPriceCacheKey(assetCode, currency, timestamp);
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      // Get price data
      let priceData;
      const now = new Date();
      const targetTime = new Date(timestamp);
      
      // If requesting current price (within 5 minutes), use real-time data
      const timeDiff = Math.abs(now - targetTime) / (1000 * 60); // Difference in minutes
      
      if (timeDiff <= 5) {
        priceData = await this.getCurrentPrice(assetCode, currency);
      } else {
        priceData = await this.getHistoricalPrice(assetCode, timestamp, currency);
      }

      // Cache the result
      if (this.redisClient && priceData) {
        const ttl = timeDiff <= 5 ? this.cacheTTL.current : this.cacheTTL.historical;
        await this.redisClient.setex(cacheKey, ttl, JSON.stringify(priceData));
      }

      return priceData;

    } catch (error) {
      console.error('[PriceCacheService] Error getting price at time:', error);
      return {
        assetCode,
        currency,
        price: 0,
        timestamp,
        source: 'error',
        error: error.message
      };
    }
  }

  /**
   * Get current price for an asset
   */
  async getCurrentPrice(assetCode, currency = 'usd') {
    try {
      if (assetCode === 'XLM') {
        // For XLM, we'd typically use a price oracle like CoinGecko
        // For now, using a mock implementation
        const xlmToUsdRate = 0.1; // Mock rate - replace with real API call
        return {
          assetCode,
          currency,
          price: currency === 'usd' ? xlmToUsdRate : xlmToUsdRate, // Simplified
          timestamp: new Date().toISOString(),
          source: 'current_api'
        };
      } else if (assetCode === 'USDC') {
        // USDC is pegged to USD
        return {
          assetCode,
          currency,
          price: 1.0,
          timestamp: new Date().toISOString(),
          source: 'pegged'
        };
      } else {
        // For other assets, implement additional price fetching
        console.warn(`[PriceCacheService] No current price data available for ${assetCode}`);
        return {
          assetCode,
          currency,
          price: 0,
          timestamp: new Date().toISOString(),
          source: 'unavailable'
        };
      }
    } catch (error) {
      console.error('[PriceCacheService] Error getting current price:', error);
      throw error;
    }
  }

  /**
   * Get historical price for an asset at a specific timestamp
   */
  async getHistoricalPrice(assetCode, timestamp, currency = 'usd') {
    try {
      // In a production environment, you'd use a historical price API like:
      // - CoinGecko Pro API for historical prices
      // - CoinMarketCap historical data
      // - Chainlink Price Feeds for on-chain historical data
      
      // For now, we'll use current price as approximation
      // In production, this should be replaced with actual historical data
      console.warn(`[PriceCacheService] Using current price as approximation for historical ${assetCode} price at ${timestamp}`);
      
      const currentPrice = await this.getCurrentPrice(assetCode, currency);
      
      return {
        ...currentPrice,
        timestamp,
        source: 'historical_approximation',
        note: 'Using current price as approximation - replace with historical API in production'
      };

    } catch (error) {
      console.error('[PriceCacheService] Error getting historical price:', error);
      throw error;
    }
  }

  /**
   * Calculate fiat equivalent for an amount at a specific time
   */
  async calculateFiatEquivalent(assetCode, amount, timestamp, currency = 'usd') {
    try {
      const priceData = await this.getPriceAtTime(assetCode, timestamp, currency);
      const fiatEquivalent = amount * priceData.price;

      return {
        ...priceData,
        amount,
        fiatEquivalent,
        calculatedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('[PriceCacheService] Error calculating fiat equivalent:', error);
      return {
        assetCode,
        currency,
        amount,
        fiatEquivalent: 0,
        price: 0,
        timestamp,
        source: 'error',
        error: error.message
      };
    }
  }

  /**
   * Batch calculate fiat equivalents for multiple transactions
   */
  async batchCalculateFiatEquivalent(transactions) {
    const results = [];
    
    for (const tx of transactions) {
      const result = await this.calculateFiatEquivalent(
        tx.asset_code,
        tx.amount_decimal,
        tx.harvested_at,
        tx.fiat_currency || 'usd'
      );
      results.push({
        ...tx,
        fiatData: result
      });
    }

    return results;
  }

  /**
   * Generate cache key for price data
   */
  getPriceCacheKey(assetCode, currency, timestamp) {
    const date = new Date(timestamp);
    const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD format
    return `price:${assetCode}:${currency}:${dateKey}`;
  }

  /**
   * Invalidate price cache for an asset
   */
  async invalidatePriceCache(assetCode, currency = 'usd') {
    if (!this.redisClient) return;

    try {
      const pattern = `price:${assetCode}:${currency}:*`;
      const keys = await this.redisClient.keys(pattern);
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
        console.log(`[PriceCacheService] Invalidated ${keys.length} price cache entries for ${assetCode}/${currency}`);
      }
    } catch (error) {
      console.error('[PriceCacheService] Cache invalidation failed:', error.message);
    }
  }

  /**
   * Get price statistics for an asset over a time period
   */
  async getPriceStatistics(assetCode, startDate, endDate, currency = 'usd') {
    // This would be implemented with historical price data analysis
    // For now, return basic structure
    return {
      assetCode,
      currency,
      period: { startDate, endDate },
      statistics: {
        high: 0,
        low: 0,
        average: 0,
        volatility: 0
      },
      note: 'Price statistics not yet implemented - requires historical price database'
    };
  }
}

module.exports = { PriceCacheService };

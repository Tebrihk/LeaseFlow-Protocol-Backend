const { create } = require('ipfs-http-client');
const Redis = require('ioredis');

/**
 * RWA Metadata Service for handling IPFS-based asset metadata
 * Provides caching and security sanitization for IPFS payloads
 */
class RWAMetadataService {
  constructor(redisService, config = {}) {
    this.redisService = redisService;
    this.config = {
      ipfsNodeUrl: config.ipfsNodeUrl || process.env.IPFS_NODE_URL || '/ip4/127.0.0.1/tcp/5001',
      cacheTTL: config.cacheTTL || 3600, // 1 hour default
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 30000, // 30 seconds
      ...config
    };
    
    // Initialize IPFS client
    this.ipfsClient = create({
      url: this.config.ipfsNodeUrl,
      timeout: this.config.timeout,
    });
  }

  /**
   * Fetch and cache IPFS metadata for an asset
   * @param {string} cid - IPFS Content Identifier
   * @param {string} assetId - Asset ID for cache key
   * @returns {Promise<Object>} Sanitized metadata object
   */
  async getAssetMetadata(cid, assetId) {
    if (!cid) {
      throw new Error('IPFS CID is required');
    }

    // Check cache first
    const cacheKey = `rwa_metadata:${assetId}:${cid}`;
    const cached = await this.getCachedMetadata(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Fetch from IPFS
      const rawData = await this.fetchFromIPFS(cid);
      
      // Sanitize and validate the data
      const sanitizedData = this.sanitizeMetadata(rawData);
      
      // Cache the result
      await this.cacheMetadata(cacheKey, sanitizedData);
      
      return sanitizedData;
    } catch (error) {
      console.error(`[RWA Metadata] Failed to fetch metadata for CID ${cid}:`, error);
      throw new Error(`Failed to fetch IPFS metadata: ${error.message}`);
    }
  }

  /**
   * Fetch raw data from IPFS with retry logic
   * @param {string} cid - IPFS Content Identifier
   * @returns {Promise<Buffer>} Raw IPFS data
   */
  async fetchFromIPFS(cid) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const chunks = [];
        for await (const chunk of this.ipfsClient.cat(cid)) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      } catch (error) {
        lastError = error;
        console.warn(`[RWA Metadata] IPFS fetch attempt ${attempt} failed:`, error.message);
        
        if (attempt < this.config.maxRetries) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Sanitize IPFS metadata to prevent XSS and ensure data integrity
   * @param {Buffer} rawData - Raw IPFS data
   * @returns {Object} Sanitized metadata object
   */
  sanitizeMetadata(rawData) {
    try {
      // Parse JSON
      const metadata = JSON.parse(rawData.toString());
      
      if (!metadata || typeof metadata !== 'object') {
        throw new Error('Invalid metadata format');
      }

      // Sanitize string fields to prevent XSS
      const sanitized = {
        assetCondition: this.sanitizeAssetCondition(metadata.assetCondition),
        geolocation: this.sanitizeGeolocation(metadata.geolocation),
        insuranceStatus: this.sanitizeInsuranceStatus(metadata.insuranceStatus),
        imageUrls: this.sanitizeImageUrls(metadata.imageUrls || []),
        physicalTraits: this.sanitizePhysicalTraits(metadata.physicalTraits),
        // Preserve other metadata fields with sanitization
        ...this.sanitizeGenericFields(metadata)
      };

      return sanitized;
    } catch (error) {
      console.error('[RWA Metadata] Sanitization failed:', error);
      // Return safe default structure
      return this.getDefaultMetadata();
    }
  }

  /**
   * Sanitize asset condition data
   * @param {Object} condition - Raw condition data
   * @returns {Object} Sanitized condition data
   */
  sanitizeAssetCondition(condition) {
    if (!condition || typeof condition !== 'object') {
      return null;
    }

    return {
      overall: this.sanitizeEnum(condition.overall, ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']) || 'FAIR',
      structural: this.sanitizeEnum(condition.structural, ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']),
      mechanical: this.sanitizeEnum(condition.mechanical, ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']),
      cosmetic: this.sanitizeEnum(condition.cosmetic, ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']),
      lastInspectedAt: this.sanitizeTimestamp(condition.lastInspectedAt),
      inspectionReportUrl: this.sanitizeUrl(condition.inspectionReportUrl)
    };
  }

  /**
   * Sanitize geolocation data
   * @param {Object} geo - Raw geolocation data
   * @returns {Object} Sanitized geolocation data
   */
  sanitizeGeolocation(geo) {
    if (!geo || typeof geo !== 'object') {
      return null;
    }

    const lat = parseFloat(geo.latitude);
    const lng = parseFloat(geo.longitude);
    
    // Validate coordinates
    if (isNaN(lat) || isNaN(lng) || 
        lat < -90 || lat > 90 || 
        lng < -180 || lng > 180) {
      return null;
    }

    return {
      latitude: lat,
      longitude: lng,
      address: this.sanitizeString(geo.address),
      city: this.sanitizeString(geo.city),
      state: this.sanitizeString(geo.state),
      postalCode: this.sanitizeString(geo.postalCode),
      country: this.sanitizeString(geo.country) || 'Unknown',
      accuracyRadiusMeters: Math.max(0, parseFloat(geo.accuracyRadiusMeters) || 0)
    };
  }

  /**
   * Sanitize insurance status data
   * @param {Object} insurance - Raw insurance data
   * @returns {Object} Sanitized insurance data
   */
  sanitizeInsuranceStatus(insurance) {
    if (!insurance || typeof insurance !== 'object') {
      return { insured: false };
    }

    return {
      insured: Boolean(insurance.insured),
      provider: this.sanitizeString(insurance.provider),
      policyNumber: this.sanitizeString(insurance.policyNumber),
      coverageAmount: this.sanitizeStroops(insurance.coverageAmount),
      validUntil: this.sanitizeTimestamp(insurance.validUntil),
      claimHistory: Array.isArray(insurance.claimHistory) 
        ? insurance.claimHistory.map(claim => this.sanitizeInsuranceClaim(claim)).filter(Boolean)
        : []
    };
  }

  /**
   * Sanitize insurance claim data
   * @param {Object} claim - Raw claim data
   * @returns {Object} Sanitized claim data
   */
  sanitizeInsuranceClaim(claim) {
    if (!claim || typeof claim !== 'object') {
      return null;
    }

    return {
      id: this.sanitizeString(claim.id) || `claim_${Date.now()}`,
      claimDate: this.sanitizeTimestamp(claim.claimDate) || new Date().toISOString(),
      amount: this.sanitizeStroops(claim.amount) || '0',
      reason: this.sanitizeString(claim.reason) || 'Unknown',
      status: this.sanitizeEnum(claim.status, ['PENDING', 'APPROVED', 'REJECTED', 'PAID']) || 'PENDING',
      resolvedAt: this.sanitizeTimestamp(claim.resolvedAt)
    };
  }

  /**
   * Sanitize physical traits data
   * @param {Object} traits - Raw physical traits data
   * @returns {Object} Sanitized physical traits data
   */
  sanitizePhysicalTraits(traits) {
    if (!traits || typeof traits !== 'object') {
      return null;
    }

    return {
      yearManufactured: Math.max(1900, Math.min(2100, parseInt(traits.yearManufactured) || 2020)),
      make: this.sanitizeString(traits.make),
      model: this.sanitizeString(traits.model),
      serialNumber: this.sanitizeString(traits.serialNumber),
      dimensions: this.sanitizeDimensions(traits.dimensions),
      weight: Math.max(0, parseFloat(traits.weight) || 0),
      color: this.sanitizeString(traits.color),
      materials: Array.isArray(traits.materials) 
        ? traits.materials.map(m => this.sanitizeString(m)).filter(Boolean)
        : [],
      features: Array.isArray(traits.features) 
        ? traits.features.map(f => this.sanitizeString(f)).filter(Boolean)
        : []
    };
  }

  /**
   * Sanitize dimensions data
   * @param {Object} dimensions - Raw dimensions data
   * @returns {Object} Sanitized dimensions data
   */
  sanitizeDimensions(dimensions) {
    if (!dimensions || typeof dimensions !== 'object') {
      return null;
    }

    return {
      length: Math.max(0, parseFloat(dimensions.length) || 0),
      width: Math.max(0, parseFloat(dimensions.width) || 0),
      height: Math.max(0, parseFloat(dimensions.height) || 0),
      unit: this.sanitizeString(dimensions.unit) || 'cm'
    };
  }

  /**
   * Sanitize array of image URLs
   * @param {Array} urls - Raw URL array
   * @returns {Array} Sanitized URL array
   */
  sanitizeImageUrls(urls) {
    if (!Array.isArray(urls)) {
      return [];
    }

    return urls
      .filter(url => typeof url === 'string')
      .map(url => this.sanitizeUrl(url))
      .filter(url => url && this.isValidImageUrl(url))
      .slice(0, 20); // Limit to 20 images
  }

  /**
   * Validate if URL is a proper image URL
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid image URL
   */
  isValidImageUrl(url) {
    try {
      const urlObj = new URL(url);
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      const pathname = urlObj.pathname.toLowerCase();
      return imageExtensions.some(ext => pathname.endsWith(ext)) || 
             pathname.includes('/image/') ||
             url.includes('ipfs.io') || // Allow IPFS image URLs
             url.includes('ipfs.');
    } catch {
      return false;
    }
  }

  /**
   * Sanitize generic metadata fields
   * @param {Object} metadata - Raw metadata
   * @returns {Object} Sanitized generic fields
   */
  sanitizeGenericFields(metadata) {
    const sanitized = {};
    
    // Only include known safe fields
    const safeFields = ['description', 'title', 'category', 'subcategory', 'tags'];
    
    for (const field of safeFields) {
      if (metadata[field] !== undefined) {
        sanitized[field] = this.sanitizeString(metadata[field]);
      }
    }
    
    return sanitized;
  }

  /**
   * Sanitize string to prevent XSS
   * @param {string} str - String to sanitize
   * @returns {string} Sanitized string
   */
  sanitizeString(str) {
    if (typeof str !== 'string') {
      return '';
    }
    
    return str
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .trim()
      .substring(0, 1000); // Limit length
  }

  /**
   * Sanitize URL
   * @param {string} url - URL to sanitize
   * @returns {string|null} Sanitized URL or null if invalid
   */
  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }
    
    try {
      const urlObj = new URL(url.trim());
      // Only allow http, https, and ipfs protocols
      if (!['http:', 'https:', 'ipfs:'].includes(urlObj.protocol)) {
        return null;
      }
      return urlObj.toString();
    } catch {
      return null;
    }
  }

  /**
   * Sanitize enum value against allowed values
   * @param {string} value - Value to check
   * @param {Array} allowedValues - Allowed enum values
   * @returns {string|null} Sanitized value or null
   */
  sanitizeEnum(value, allowedValues) {
    if (typeof value !== 'string') {
      return null;
    }
    
    const upperValue = value.toUpperCase().trim();
    return allowedValues.includes(upperValue) ? upperValue : null;
  }

  /**
   * Sanitize timestamp
   * @param {string} timestamp - Timestamp to sanitize
   * @returns {string|null} ISO timestamp or null
   */
  sanitizeTimestamp(timestamp) {
    if (!timestamp) return null;
    
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date.toISOString();
    } catch {
      return null;
    }
  }

  /**
   * Sanitize stroops amount
   * @param {string|number} amount - Amount to sanitize
   * @returns {string} Sanitized stroops amount
   */
  sanitizeStroops(amount) {
    if (typeof amount === 'number') {
      return Math.max(0, amount).toString();
    }
    
    if (typeof amount === 'string') {
      const cleaned = amount.replace(/[^0-9]/g, '');
      return cleaned || '0';
    }
    
    return '0';
  }

  /**
   * Get cached metadata from Redis
   * @param {string} cacheKey - Cache key
   * @returns {Promise<Object|null>} Cached metadata or null
   */
  async getCachedMetadata(cacheKey) {
    try {
      const redis = await this.redisService.getWorkingClient();
      const cached = await redis.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.warn('[RWA Metadata] Cache read failed:', error.message);
      return null;
    }
  }

  /**
   * Cache metadata in Redis
   * @param {string} cacheKey - Cache key
   * @param {Object} metadata - Metadata to cache
   */
  async cacheMetadata(cacheKey, metadata) {
    try {
      const redis = await this.redisService.getWorkingClient();
      await redis.setex(cacheKey, this.config.cacheTTL, JSON.stringify(metadata));
    } catch (error) {
      console.warn('[RWA Metadata] Cache write failed:', error.message);
    }
  }

  /**
   * Get default metadata structure for fallback
   * @returns {Object} Default metadata
   */
  getDefaultMetadata() {
    return {
      assetCondition: {
        overall: 'FAIR'
      },
      geolocation: null,
      insuranceStatus: {
        insured: false
      },
      imageUrls: [],
      physicalTraits: null
    };
  }

  /**
   * Clear cache for a specific asset
   * @param {string} assetId - Asset ID
   */
  async clearAssetCache(assetId) {
    try {
      const redis = await this.redisService.getWorkingClient();
      const pattern = `rwa_metadata:${assetId}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.warn('[RWA Metadata] Cache clear failed:', error.message);
    }
  }
}

module.exports = { RWAMetadataService };

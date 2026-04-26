const { RWAMetadataService } = require('../services/rwaMetadataService');
const Redis = require('ioredis-mock');

describe('RWAMetadataService', () => {
  let rwaService;
  let mockRedisService;
  let mockIpfsClient;

  beforeEach(() => {
    mockRedisService = {
      getWorkingClient: jest.fn().mockResolvedValue(new Redis()),
    };

    // Mock IPFS client
    mockIpfsClient = {
      cat: jest.fn(),
    };

    // Mock the IPFS client creation
    jest.doMock('ipfs-http-client', () => ({
      create: jest.fn().mockReturnValue(mockIpfsClient),
    }));

    rwaService = new RWAMetadataService(mockRedisService, {
      cacheTTL: 300,
      maxRetries: 2,
      timeout: 5000,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('getAssetMetadata', () => {
    const testCid = 'QmTest123';
    const testAssetId = 'asset-123';
    const validMetadata = {
      assetCondition: {
        overall: 'GOOD',
        structural: 'EXCELLENT',
        mechanical: 'GOOD',
        cosmetic: 'FAIR',
        lastInspectedAt: '2024-01-15T10:00:00Z',
        inspectionReportUrl: 'https://example.com/report.pdf'
      },
      geolocation: {
        latitude: 40.7128,
        longitude: -74.0060,
        address: '123 Main St',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
        country: 'USA',
        accuracyRadiusMeters: 10
      },
      insuranceStatus: {
        insured: true,
        provider: 'Safe Insurance Co',
        policyNumber: 'POL-123456',
        coverageAmount: '100000000', // 1000 USD in stroops
        validUntil: '2024-12-31T23:59:59Z',
        claimHistory: [
          {
            id: 'claim-1',
            claimDate: '2023-06-15T10:00:00Z',
            amount: '50000',
            reason: 'Water damage',
            status: 'PAID',
            resolvedAt: '2023-06-20T10:00:00Z'
          }
        ]
      },
      imageUrls: [
        'https://example.com/image1.jpg',
        'https://example.com/image2.png',
        'ipfs://QmImage123'
      ],
      physicalTraits: {
        yearManufactured: 2020,
        make: 'Tesla',
        model: 'Model 3',
        serialNumber: 'VIN123456789',
        dimensions: {
          length: 469.4,
          width: 184.9,
          height: 144.3,
          unit: 'cm'
        },
        weight: 1611,
        color: 'Red',
        materials: ['Steel', 'Aluminum', 'Glass'],
        features: ['Autopilot', 'Premium Audio']
      }
    };

    it('should fetch and cache metadata successfully', async () => {
      // Mock IPFS response
      const mockChunks = [Buffer.from(JSON.stringify(validMetadata))];
      mockIpfsClient.cat.mockImplementation(async function* () {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      });

      const result = await rwaService.getAssetMetadata(testCid, testAssetId);

      expect(result).toEqual(validMetadata);
      expect(mockIpfsClient.cat).toHaveBeenCalledWith(testCid);
      expect(mockRedisService.getWorkingClient).toHaveBeenCalled();
    });

    it('should return cached metadata on subsequent calls', async () => {
      const mockRedis = new Redis();
      mockRedisService.getWorkingClient.mockResolvedValue(mockRedis);

      // Set cache
      await mockRedis.setex(`rwa_metadata:${testAssetId}:${testCid}`, 300, JSON.stringify(validMetadata));

      const result = await rwaService.getAssetMetadata(testCid, testAssetId);

      expect(result).toEqual(validMetadata);
      expect(mockIpfsClient.cat).not.toHaveBeenCalled();
    });

    it('should throw error when CID is missing', async () => {
      await expect(rwaService.getAssetMetadata('', testAssetId))
        .rejects.toThrow('IPFS CID is required');
    });

    it('should handle IPFS fetch errors with retries', async () => {
      mockIpfsClient.cat.mockRejectedValue(new Error('IPFS connection failed'));

      await expect(rwaService.getAssetMetadata(testCid, testAssetId))
        .rejects.toThrow('Failed to fetch IPFS metadata');

      expect(mockIpfsClient.cat).toHaveBeenCalledTimes(3); // 3 retries
    });

    it('should return default metadata for invalid JSON', async () => {
      const mockChunks = [Buffer.from('invalid json')];
      mockIpfsClient.cat.mockImplementation(async function* () {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      });

      const result = await rwaService.getAssetMetadata(testCid, testAssetId);

      expect(result).toEqual(rwaService.getDefaultMetadata());
    });
  });

  describe('sanitizeMetadata', () => {
    it('should sanitize malicious script tags', () => {
      const maliciousMetadata = {
        assetCondition: {
          overall: 'GOOD',
          inspectionReportUrl: 'javascript:alert("xss")'
        },
        geolocation: {
          latitude: 40.7128,
          longitude: -74.0060,
          address: '<script>alert("xss")</script>Main St',
          country: 'USA'
        },
        imageUrls: [
          'https://example.com/image.jpg',
          'javascript:alert("xss")',
          'data:text/html,<script>alert("xss")</script>'
        ]
      };

      const result = rwaService.sanitizeMetadata(Buffer.from(JSON.stringify(maliciousMetadata)));

      expect(result.assetCondition.inspectionReportUrl).toBeNull();
      expect(result.geolocation.address).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;Main St');
      expect(result.imageUrls).toEqual(['https://example.com/image.jpg']);
    });

    it('should validate coordinates', () => {
      const invalidGeo = {
        latitude: 'invalid',
        longitude: 200, // Invalid longitude
        country: 'USA'
      };

      const result = rwaService.sanitizeGeolocation(invalidGeo);

      expect(result).toBeNull();
    });

    it('should limit image URLs to 20 items', () => {
      const manyImages = {
        imageUrls: Array.from({ length: 25 }, (_, i) => `https://example.com/image${i}.jpg`)
      };

      const result = rwaService.sanitizeImageUrls(manyImages.imageUrls);

      expect(result).toHaveLength(20);
    });

    it('should sanitize stroops amounts', () => {
      expect(rwaService.sanitizeStroops('1000000')).toBe('1000000');
      expect(rwaService.sanitizeStroops(1000000)).toBe('1000000');
      expect(rwaService.sanitizeStroops('abc')).toBe('0');
      expect(rwaService.sanitizeStroops(-1000)).toBe('0');
    });

    it('should validate enum values', () => {
      expect(rwaService.sanitizeEnum('good', ['EXCELLENT', 'GOOD', 'FAIR'])).toBe('GOOD');
      expect(rwaService.sanitizeEnum('invalid', ['EXCELLENT', 'GOOD', 'FAIR'])).toBeNull();
      expect(rwaService.sanitizeEnum('', ['EXCELLENT', 'GOOD', 'FAIR'])).toBeNull();
    });
  });

  describe('cache operations', () => {
    it('should clear cache for specific asset', async () => {
      const mockRedis = new Redis();
      mockRedisService.getWorkingClient.mockResolvedValue(mockRedis);

      // Set some cache entries
      await mockRedis.set('rwa_metadata:asset123:cid1', 'data1');
      await mockRedis.set('rwa_metadata:asset123:cid2', 'data2');
      await mockRedis.set('rwa_metadata:asset456:cid1', 'data3');

      await rwaService.clearAssetCache('asset123');

      const keys = await mockRedis.keys('*');
      expect(keys).toContain('rwa_metadata:asset456:cid1');
      expect(keys).not.toContain('rwa_metadata:asset123:cid1');
      expect(keys).not.toContain('rwa_metadata:asset123:cid2');
    });
  });

  describe('URL validation', () => {
    it('should validate image URLs', () => {
      const validUrls = [
        'https://example.com/image.jpg',
        'https://example.com/image.png',
        'https://ipfs.io/ipfs/QmTest123',
        'https://gateway.ipfs.io/ipfs/QmTest123'
      ];

      const invalidUrls = [
        'javascript:alert("xss")',
        'data:text/html,<script>alert("xss")</script>',
        'ftp://example.com/image.jpg',
        'not-a-url'
      ];

      validUrls.forEach(url => {
        expect(rwaService.isValidImageUrl(url)).toBe(true);
      });

      invalidUrls.forEach(url => {
        expect(rwaService.isValidImageUrl(url)).toBe(false);
      });
    });
  });
});

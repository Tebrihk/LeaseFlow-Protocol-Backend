const { buildSubgraphSchema } = require('@apollo/subgraph');
const { readFileSync } = require('fs');
const path = require('path');

describe('Apollo Federation Implementation', () => {
  let schema;
  let mockDataSources;
  let mockUser;

  beforeEach(() => {
    // Load the schema
    const typeDefs = readFileSync(path.join(__dirname, '../graphql/schema.graphql'), 'utf8');
    
    // Mock resolvers
    const resolvers = {
      Query: {
        actor: jest.fn(),
        asset: jest.fn(),
        lease: jest.fn(),
      },
      // Federation reference resolvers
      Actor: {
        __resolveReference: jest.fn(),
      },
      Asset: {
        __resolveReference: jest.fn(),
        assetCondition: jest.fn(),
        geolocation: jest.fn(),
        insuranceStatus: jest.fn(),
        imageUrls: jest.fn(),
        physicalTraits: jest.fn(),
      },
      Lease: {
        __resolveReference: jest.fn(),
        asset: jest.fn(),
      },
    };

    // Build subgraph schema
    schema = buildSubgraphSchema({
      typeDefs,
      resolvers,
    });

    // Mock data sources
    mockDataSources = {
      actors: {
        getActorById: jest.fn(),
      },
      assets: {
        getAssetById: jest.fn(),
      },
      leases: {
        getLeaseById: jest.fn(),
      },
    };

    mockUser = {
      id: 'user-123',
      role: 'LESSOR',
    };
  });

  describe('Schema Federation Keys', () => {
    it('should have @key directives on core entities', () => {
      const actorType = schema.getType('Actor');
      const assetType = schema.getType('Asset');
      const leaseType = schema.getType('Lease');

      // Check that federation extensions exist
      expect(actorType.extensions).toBeDefined();
      expect(assetType.extensions).toBeDefined();
      expect(leaseType.extensions).toBeDefined();

      // Check that @key directives are present
      expect(actorType.extensions.federation).toBeDefined();
      expect(assetType.extensions.federation).toBeDefined();
      expect(leaseType.extensions.federation).toBeDefined();
    });

    it('should have correct key fields for entities', () => {
      const actorType = schema.getType('Actor');
      const assetType = schema.getType('Asset');
      const leaseType = schema.getType('Lease');

      // Verify key fields
      expect(actorType.extensions.federation.keys).toEqual([
        { fields: 'id' }
      ]);
      expect(assetType.extensions.federation.keys).toEqual([
        { fields: 'id' }
      ]);
      expect(leaseType.extensions.federation.keys).toEqual([
        { fields: 'id' }
      ]);
    });
  });

  describe('Reference Resolvers', () => {
    it('should resolve Actor references correctly', async () => {
      const mockActor = {
        id: 'actor-123',
        publicKey: 'GB123...',
        role: 'LESSOR',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      mockDataSources.actors.getActorById.mockResolvedValue(mockActor);

      const resolver = schema.getType('Actor').extensions.federation.resolveReference;
      const result = await resolver(
        { id: 'actor-123' },
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(mockDataSources.actors.getActorById).toHaveBeenCalledWith('actor-123', mockUser);
      expect(result).toEqual(mockActor);
    });

    it('should resolve Asset references correctly', async () => {
      const mockAsset = {
        id: 'asset-123',
        lessorId: 'lessor-123',
        type: 'VEHICLE',
        address: '123 Main St',
        status: 'AVAILABLE',
        ipfsMetadataCid: 'QmTest123',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      mockDataSources.assets.getAssetById.mockResolvedValue(mockAsset);

      const resolver = schema.getType('Asset').extensions.federation.resolveReference;
      const result = await resolver(
        { id: 'asset-123' },
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(mockDataSources.assets.getAssetById).toHaveBeenCalledWith('asset-123', mockUser);
      expect(result).toEqual(mockAsset);
    });

    it('should resolve Lease references correctly', async () => {
      const mockLease = {
        id: 'lease-123',
        landlordId: 'landlord-123',
        tenantId: 'tenant-123',
        lessorId: 'lessor-123',
        assetId: 'asset-123',
        status: 'ACTIVE',
        rentAmount: '100000000', // 1000 USD in stroops
        currency: 'USDC',
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T23:59:59Z',
        renewable: true,
        disputed: false,
        paymentStatus: 'PAID',
        sanctionsStatus: 'CLEAN',
        sanctionsViolationCount: 0,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      mockDataSources.leases.getLeaseById.mockResolvedValue(mockLease);

      const resolver = schema.getType('Lease').extensions.federation.resolveReference;
      const result = await resolver(
        { id: 'lease-123' },
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(mockDataSources.leases.getLeaseById).toHaveBeenCalledWith('lease-123', mockUser);
      expect(result).toEqual(mockLease);
    });
  });

  describe('RWA Metadata Federation', () => {
    it('should resolve RWA metadata through federation', async () => {
      const mockAsset = {
        id: 'asset-123',
        ipfsMetadataCid: 'QmTest123',
      };

      const mockRWAMetadata = {
        assetCondition: {
          overall: 'GOOD',
          structural: 'EXCELLENT',
          mechanical: 'GOOD',
          cosmetic: 'FAIR',
        },
        geolocation: {
          latitude: 40.7128,
          longitude: -74.0060,
          address: '123 Main St',
          city: 'New York',
          country: 'USA',
        },
        insuranceStatus: {
          insured: true,
          provider: 'Safe Insurance Co',
          coverageAmount: '100000000',
        },
        imageUrls: ['https://example.com/image1.jpg'],
        physicalTraits: {
          yearManufactured: 2020,
          make: 'Tesla',
          model: 'Model 3',
        },
      };

      // Mock the RWA metadata service
      jest.doMock('../services/rwaMetadataService', () => ({
        RWAMetadataService: jest.fn().mockImplementation(() => ({
          getAssetMetadata: jest.fn().mockResolvedValue(mockRWAMetadata),
        })),
      }));

      const { RWAMetadataService } = require('../services/rwaMetadataService');
      const rwaService = new RWAMetadataService();

      // Test asset condition resolver
      const assetConditionResolver = schema.getType('Asset').getFields().assetCondition.resolve;
      const assetCondition = await assetConditionResolver(
        mockAsset,
        {},
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(assetCondition).toEqual(mockRWAMetadata.assetCondition);

      // Test geolocation resolver
      const geolocationResolver = schema.getType('Asset').getFields().geolocation.resolve;
      const geolocation = await geolocationResolver(
        mockAsset,
        {},
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(geolocation).toEqual(mockRWAMetadata.geolocation);

      // Test insurance status resolver
      const insuranceResolver = schema.getType('Asset').getFields().insuranceStatus.resolve;
      const insuranceStatus = await insuranceResolver(
        mockAsset,
        {},
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(insuranceStatus).toEqual(mockRWAMetadata.insuranceStatus);

      // Test image URLs resolver
      const imageUrlsResolver = schema.getType('Asset').getFields().imageUrls.resolve;
      const imageUrls = await imageUrlsResolver(
        mockAsset,
        {},
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(imageUrls).toEqual(mockRWAMetadata.imageUrls);

      // Test physical traits resolver
      const physicalTraitsResolver = schema.getType('Asset').getFields().physicalTraits.resolve;
      const physicalTraits = await physicalTraitsResolver(
        mockAsset,
        {},
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(physicalTraits).toEqual(mockRWAMetadata.physicalTraits);
    });

    it('should handle missing IPFS metadata gracefully', async () => {
      const mockAsset = {
        id: 'asset-123',
        ipfsMetadataCid: null, // No CID
      };

      // Test asset condition resolver with no CID
      const assetConditionResolver = schema.getType('Asset').getFields().assetCondition.resolve;
      const assetCondition = await assetConditionResolver(
        mockAsset,
        {},
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(assetCondition).toBeNull();

      // Test image URLs resolver with no CID
      const imageUrlsResolver = schema.getType('Asset').getFields().imageUrls.resolve;
      const imageUrls = await imageUrlsResolver(
        mockAsset,
        {},
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(imageUrls).toEqual([]);
    });

    it('should handle IPFS service errors gracefully', async () => {
      const mockAsset = {
        id: 'asset-123',
        ipfsMetadataCid: 'QmTest123',
      };

      // Mock RWA service error
      jest.doMock('../services/rwaMetadataService', () => ({
        RWAMetadataService: jest.fn().mockImplementation(() => ({
          getAssetMetadata: jest.fn().mockRejectedValue(new Error('IPFS fetch failed')),
        })),
      }));

      const { RWAMetadataService } = require('../services/rwaMetadataService');
      const rwaService = new RWAMetadataService();

      // Test asset condition resolver with error
      const assetConditionResolver = schema.getType('Asset').getFields().assetCondition.resolve;
      const assetCondition = await assetConditionResolver(
        mockAsset,
        {},
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(assetCondition).toBeNull();

      // Test insurance status resolver with error (should return default)
      const insuranceResolver = schema.getType('Asset').getFields().insuranceStatus.resolve;
      const insuranceStatus = await insuranceResolver(
        mockAsset,
        {},
        { dataSources: mockDataSources, user: mockUser }
      );

      expect(insuranceStatus).toEqual({ insured: false });
    });
  });

  describe('Schema Validation', () => {
    it('should include all RWA metadata types', () => {
      const assetConditionType = schema.getType('AssetCondition');
      const geolocationType = schema.getType('Geolocation');
      const insuranceStatusType = schema.getType('InsuranceStatus');
      const physicalTraitsType = schema.getType('PhysicalTraits');
      const dimensionsType = schema.getType('Dimensions');

      expect(assetConditionType).toBeDefined();
      expect(geolocationType).toBeDefined();
      expect(insuranceStatusType).toBeDefined();
      expect(physicalTraitsType).toBeDefined();
      expect(dimensionsType).toBeDefined();
    });

    it('should have correct field types for RWA metadata', () => {
      const assetType = schema.getType('Asset');
      const fields = assetType.getFields();

      expect(fields.assetCondition.type).toBeDefined();
      expect(fields.geolocation.type).toBeDefined();
      expect(fields.insuranceStatus.type).toBeDefined();
      expect(fields.imageUrls.type).toBeDefined();
      expect(fields.ipfsMetadataCid.type).toBeDefined();
      expect(fields.rwaTokenId.type).toBeDefined();
      expect(fields.physicalTraits.type).toBeDefined();
    });

    it('should have required enums for RWA metadata', () => {
      const conditionRatingEnum = schema.getType('ConditionRating');
      const claimStatusEnum = schema.getType('ClaimStatus');

      expect(conditionRatingEnum).toBeDefined();
      expect(claimStatusEnum).toBeDefined();

      const conditionRatingValues = conditionRatingEnum.getValues();
      expect(conditionRatingValues).toContainEqual({ name: 'EXCELLENT', value: 'EXCELLENT' });
      expect(conditionRatingValues).toContainEqual({ name: 'GOOD', value: 'GOOD' });
      expect(conditionRatingValues).toContainEqual({ name: 'FAIR', value: 'FAIR' });
      expect(conditionRatingValues).toContainEqual({ name: 'POOR', value: 'POOR' });
      expect(conditionRatingValues).toContainEqual({ name: 'DAMAGED', value: 'DAMAGED' });
    });
  });
});

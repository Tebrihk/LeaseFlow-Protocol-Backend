const request = require('supertest');
const { createApp } = require('../../index');
const { AppDatabase } = require('../db/appDatabase');

describe('Yield Analytics API Endpoints', () => {
  let app;
  let database;
  let testPubkey = 'GBB2X7LJ5NHY6DUZ7YK5L3FQX2Z2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q';

  beforeAll(async () => {
    // Initialize test database
    database = new AppDatabase(':memory:');
    
    // Create app with test dependencies
    app = createApp({ 
      config: {
        database: { filename: ':memory:' },
        redis: { host: 'localhost', port: 6379 },
        port: 3001
      },
      database 
    });

    // Insert test data
    await setupTestData();
  });

  afterAll(async () => {
    // Clean up
    if (database.db) {
      database.db.close();
    }
  });

  async function setupTestData() {
    // Insert test yield earnings
    await database.insertYieldEarningsLessor({
      leaseId: 'test-lease-1',
      lessorPubkey: testPubkey,
      harvestTxHash: 'tx-hash-1',
      assetCode: 'XLM',
      amountStroops: 50000000, // 5 XLM
      amountDecimal: 5.0,
      fiatEquivalent: 0.5,
      fiatCurrency: 'usd',
      priceAtHarvest: 0.1,
      harvestedAt: '2024-01-15T10:30:00Z'
    });

    await database.insertYieldEarningsLessee({
      leaseId: 'test-lease-2',
      lesseePubkey: testPubkey,
      harvestTxHash: 'tx-hash-2',
      assetCode: 'USDC',
      amountStroops: 2000000, // 0.2 USDC
      amountDecimal: 0.2,
      fiatEquivalent: 0.2,
      fiatCurrency: 'usd',
      priceAtHarvest: 1.0,
      harvestedAt: '2024-02-15T10:30:00Z'
    });
  }

  describe('GET /api/v1/users/:pubkey/yield-history', () => {
    test('should return yield history for valid pubkey', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testPubkey}/yield-history`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pubkey).toBe(testPubkey);
      expect(response.body.data.history).toBeDefined();
      expect(response.body.data.summary).toBeDefined();
      expect(Array.isArray(response.body.data.history)).toBe(true);
    });

    test('should return yield history with date filters', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testPubkey}/yield-history`)
        .query({ 
          start_date: '2024-01-01', 
          end_date: '2024-01-31' 
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.period.start_date).toBe('2024-01-01');
      expect(response.body.data.period.end_date).toBe('2024-01-31');
      
      // Should only include January data
      const januaryData = response.body.data.history.filter(item => item.month === '2024-01');
      expect(januaryData.length).toBeGreaterThan(0);
    });

    test('should return summary format when requested', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testPubkey}/yield-history`)
        .query({ format: 'summary' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.monthly_breakdown).toBeDefined();
      expect(response.body.data.summary).toBeDefined();
    });

    test('should reject invalid pubkey format', async () => {
      const response = await request(app)
        .get('/api/v1/users/invalid-pubkey/yield-history')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid public key format');
    });

    test('should reject invalid date format', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testPubkey}/yield-history`)
        .query({ start_date: 'invalid-date' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid start_date format. Use ISO date format (YYYY-MM-DD)');
    });

    test('should handle empty history gracefully', async () => {
      const emptyPubkey = 'GAB2X7LJ5NHY6DUZ7YK5L3FQX2Z2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q';
      
      const response = await request(app)
        .get(`/api/v1/users/${emptyPubkey}/yield-history`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.history).toEqual([]);
      expect(response.body.data.summary.lessor.total_amount).toBe(0);
      expect(response.body.data.summary.lessee.total_amount).toBe(0);
    });
  });

  describe('GET /api/v1/users/:pubkey/yield-summary', () => {
    test('should return total yield summary', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testPubkey}/yield-summary`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pubkey).toBe(testPubkey);
      expect(response.body.data.summary).toBeDefined();
      expect(response.body.data.summary.lessor).toBeDefined();
      expect(response.body.data.summary.lessee).toBeDefined();
      expect(response.body.data.summary.combined).toBeDefined();
    });

    test('should reject invalid pubkey for summary', async () => {
      const response = await request(app)
        .get('/api/v1/users/short/yield-summary')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid public key format');
    });
  });

  describe('GET /api/v1/yield/verify/:leaseId/:txHash', () => {
    test('should verify yield aggregation', async () => {
      const response = await request(app)
        .get('/api/v1/yield/verify/test-lease-1/tx-hash-1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.leaseId).toBe('test-lease-1');
      expect(response.body.data.txHash).toBe('tx-hash-1');
      expect(response.body.data.verification).toBeDefined();
      expect(response.body.data.verification.lessor).toBeDefined();
      expect(response.body.data.verification.lessee).toBeDefined();
      expect(response.body.data.verification.combined).toBeDefined();
    });

    test('should handle missing lease/tx combination', async () => {
      const response = await request(app)
        .get('/api/v1/yield/verify/non-existent/tx-missing')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.verification.lessor.total_stroops).toBe(0);
      expect(response.body.data.verification.lessee.total_stroops).toBe(0);
      expect(response.body.data.verification.combined.total_stroops).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle database connection errors', async () => {
      // Create app with broken database
      const brokenApp = createApp({ 
        config: { database: { filename: '/invalid/path/database.sqlite' } }
      });

      const response = await request(brokenApp)
        .get(`/api/v1/users/${testPubkey}/yield-history`)
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Internal server error');
    });

    test('should handle malformed request parameters', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testPubkey}/yield-history`)
        .query({ start_date: '2024-13-01' }) // Invalid month
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Performance and Caching', () => {
    test('should respond quickly for large datasets', async () => {
      // Insert more test data
      for (let i = 0; i < 100; i++) {
        await database.insertYieldEarningsLessor({
          leaseId: `test-lease-perf-${i}`,
          lessorPubkey: testPubkey,
          harvestTxHash: `tx-perf-${i}`,
          assetCode: 'XLM',
          amountStroops: 1000000,
          amountDecimal: 0.1,
          fiatEquivalent: 0.01,
          harvestedAt: `2024-${String(i % 12 + 1).padStart(2, '0')}-15T10:30:00Z`
        });
      }

      const startTime = Date.now();
      const response = await request(app)
        .get(`/api/v1/users/${testPubkey}/yield-history`)
        .expect(200);
      const endTime = Date.now();

      expect(response.body.success).toBe(true);
      expect(endTime - startTime).toBeLessThan(1000); // Should respond within 1 second
    });
  });
});

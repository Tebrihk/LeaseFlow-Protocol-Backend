const request = require('supertest');
const app = require('../index');

describe('LeaseFlow Backend API', () => {
  it('should return 200 and project details on GET /', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toEqual({
      project: 'LeaseFlow Protocol',
      status: 'Active',
      contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4'
    });
  });

  it('should compute and cache tenant credit score', async () => {
    const payload = {
      tenantId: 'tenant-123',
      metrics: {
        onTimePayments: 9,
        totalPayments: 10,
        completedLeases: 3,
        totalLeases: 4,
        successfulDepositReturns: 2,
        totalDepositReturns: 2
      }
    };

    const first = await request(app).post('/tenant-credit-score').send(payload);
    expect(first.status).toBe(200);
    expect(first.body.tenantId).toBe('tenant-123');
    expect(first.body.cached).toBe(false);
    expect(first.body.score).toBe(781);
    expect(first.body.breakdown).toEqual({
      onTimePayments: 90,
      leaseCompletion: 75,
      successfulDepositReturns: 100
    });
    expect(typeof first.body.expiresAt).toBe('string');

    const second = await request(app).post('/tenant-credit-score').send(payload);
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.score).toBe(781);
  });

  it('should return cached score for tenant id', async () => {
    const response = await request(app).get('/tenant-credit-score/tenant-123');
    expect(response.status).toBe(200);
    expect(response.body.tenantId).toBe('tenant-123');
    expect(response.body.score).toBe(781);
  });

  it('should generate and verify a signed share token', async () => {
    const tokenResponse = await request(app)
      .post('/tenant-credit-score/share-token')
      .send({ tenantId: 'tenant-123' });

    expect(tokenResponse.status).toBe(200);
    expect(typeof tokenResponse.body.token).toBe('string');
    expect(tokenResponse.body.payload.tenantId).toBe('tenant-123');
    expect(tokenResponse.body.payload.score).toBe(781);

    const verifyResponse = await request(app)
      .post('/tenant-credit-score/verify-token')
      .send({ token: tokenResponse.body.token });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.valid).toBe(true);
    expect(verifyResponse.body.payload.tenantId).toBe('tenant-123');
    expect(verifyResponse.body.payload.score).toBe(781);
  });
});

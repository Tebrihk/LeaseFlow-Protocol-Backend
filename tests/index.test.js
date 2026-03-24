const request = require('supertest');
const app = require('../index');

describe('LeaseFlow Backend API', () => {
  it('should return 200 and project details on GET /', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toMatchObject({
      project: 'LeaseFlow Protocol Backend',
      status: 'Operational',
      version: '1.0.0'
    });
    expect(response.body.endpoints).toBeDefined();
    expect(response.body.endpoints.upload_lease).toBe('POST /api/leases/upload');
  });
});

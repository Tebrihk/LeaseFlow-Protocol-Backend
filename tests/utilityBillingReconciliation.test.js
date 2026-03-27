'use strict';

const express = require('express');
const request = require('supertest');
const { AppDatabase } = require('../src/db/appDatabase');
const { createPaymentRoutes } = require('../src/routes/paymentRoutes');

describe('Utility Billing Reconciliation (Issue #14)', () => {
  let db;
  let app;

  beforeEach(() => {
    db = new AppDatabase(':memory:');
    db.seedLease({
      id: 'lease-utility-1',
      landlordId: 'landlord-1',
      tenantId: 'tenant-1',
      status: 'active',
      rentAmount: 1000,
      currency: 'USDC',
      startDate: '2025-01-01',
      endDate: '2026-01-01',
      renewable: true,
      disputed: false,
    });

    app = express();
    app.use(express.json());
    app.use('/api', createPaymentRoutes(db));
  });

  test('landlord utility upload calculates tenant share and updates upcoming payment total', async () => {
    const uploadResponse = await request(app)
      .post('/api/leases/lease-utility-1/utility-bills')
      .send({
        landlord_id: 'landlord-1',
        bill_amount: 200,
        tenant_share_ratio: 0.5,
        billing_cycle: '2026-03',
        currency: 'USDC',
      });

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.success).toBe(true);
    expect(uploadResponse.body.utility_bill.tenantShareAmount).toBe(100);
    expect(uploadResponse.body.upcoming_payment_total).toBe(1100);

    const upcomingResponse = await request(app).get('/api/leases/lease-utility-1/upcoming-payment');

    expect(upcomingResponse.status).toBe(200);
    expect(upcomingResponse.body.success).toBe(true);
    expect(upcomingResponse.body.base_rent_amount).toBe(1000);
    expect(upcomingResponse.body.utility_share_total).toBe(100);
    expect(upcomingResponse.body.upcoming_payment_total).toBe(1100);
    expect(upcomingResponse.body.tenant_approval_required).toBe(true);
  });

  test('rejects utility bill upload when caller is not the lease landlord', async () => {
    const response = await request(app)
      .post('/api/leases/lease-utility-1/utility-bills')
      .send({
        landlord_id: 'landlord-2',
        bill_amount: 200,
        tenant_share_ratio: 0.5,
        billing_cycle: '2026-03',
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });
});

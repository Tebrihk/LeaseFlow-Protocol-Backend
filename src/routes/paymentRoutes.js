/**
 * Payment history API routes.
 *
 * GET  /api/leases/:leaseId/payments          — full payment history for a lease
 * GET  /api/leases/:leaseId/payment-status    — current payment status for a lease
 * GET  /api/tenants/:tenantAccountId/payments — all payments for a Stellar account
 */

const express = require('express');

/**
 * @param {import('../db/appDatabase').AppDatabase} database
 * @returns {import('express').Router}
 */
function createPaymentRoutes(database) {
  const router = express.Router();

  /**
   * GET /api/leases/:leaseId/payments
   * Returns the full recorded payment history for a specific lease.
   */
  router.get('/leases/:leaseId/payments', (req, res) => {
    const { leaseId } = req.params;

    if (!leaseId || !leaseId.trim()) {
      return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    try {
      const payments = database.listPaymentsByLeaseId(leaseId.trim());
      return res.status(200).json({
        success: true,
        lease_id: leaseId.trim(),
        count: payments.length,
        payments,
      });
    } catch (err) {
      console.error('[PaymentRoutes] Error listing payments:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch payment history' });
    }
  });

  /**
   * GET /api/leases/:leaseId/payment-status
   * Returns the current payment status and last payment timestamp for a lease.
   */
  router.get('/leases/:leaseId/payment-status', (req, res) => {
    const { leaseId } = req.params;

    if (!leaseId || !leaseId.trim()) {
      return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    try {
      const lease = database.getLeaseById(leaseId.trim());
      if (!lease) {
        return res.status(404).json({ success: false, error: 'Lease not found' });
      }

      return res.status(200).json({
        success: true,
        lease_id: lease.id,
        tenant_id: lease.tenantId,
        tenant_account_id: lease.tenantAccountId ?? null,
        payment_status: lease.paymentStatus ?? 'pending',
        last_payment_at: lease.lastPaymentAt ?? null,
      });
    } catch (err) {
      console.error('[PaymentRoutes] Error fetching payment status:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch payment status' });
    }
  });

  /**
   * GET /api/tenants/:tenantAccountId/payments
   * Returns all recorded payments for a specific Stellar account (tenant).
   */
  router.get('/tenants/:tenantAccountId/payments', (req, res) => {
    const { tenantAccountId } = req.params;

    if (!tenantAccountId || !tenantAccountId.trim()) {
      return res.status(400).json({ success: false, error: 'tenantAccountId is required' });
    }

    try {
      const payments = database.listPaymentsByTenantAccount(tenantAccountId.trim());
      return res.status(200).json({
        success: true,
        tenant_account_id: tenantAccountId.trim(),
        count: payments.length,
        payments,
      });
    } catch (err) {
      console.error('[PaymentRoutes] Error listing tenant payments:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch tenant payments' });
    }
  });

  return router;
}

module.exports = { createPaymentRoutes };

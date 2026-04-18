'use strict';

const express = require('express');
const router  = express.Router();
const config  = require('../config');
const db      = require('../db/database');
const { generateVoucher }              = require('../services/voucher');
const { sendSms, buildVoucherMessage } = require('../services/sms');
const { authenticateAdmin }            = require('../middleware/auth');
const { validateAdminVoucher }         = require('../middleware/validate');
const { sha256 }                       = require('../utils/crypto');
const logger                           = require('../utils/logger');

// All admin routes require Bearer token
router.use(authenticateAdmin);

/**
 * GET /admin/stats
 * Overall payment + revenue summary.
 */
router.get('/stats', (req, res) => {
  const stats = db.getStats();
  res.json(stats);
});

/**
 * GET /admin/payments?limit=50&offset=0
 * Paginated payment history.
 */
router.get('/payments', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? '50', 10), 200);
  const offset = parseInt(req.query.offset ?? '0', 10);
  const payments = db.listPayments({ limit, offset });
  res.json({ payments, limit, offset });
});

/**
 * POST /admin/voucher
 * Manually issue a voucher for a customer (edge case / complaint resolution).
 *
 * Body: { phone, amount, reason? }
 */
router.post('/voucher', validateAdminVoucher, async (req, res) => {
  const { phone, amount, reason } = req.body;

  const durationMin = config.pricingMap[amount];
  if (!durationMin) {
    return res.status(422).json({
      error: 'Unrecognized amount',
      accepted: Object.keys(config.pricingMap).map(Number),
    });
  }

  // Synthetic dedup key for manually issued vouchers
  const dedupKey = `manual:${sha256(`${phone}:${amount}:${Date.now()}`)}`;

  const insertResult = db.insertPaymentAtomic({
    dedupKey,
    phone,
    amount,
    rawSms:  `MANUAL:${reason ?? 'no reason provided'}`,
    smsHash: dedupKey,
  });

  const paymentId = insertResult.paymentId;

  let voucher;
  try {
    voucher = await generateVoucher({ durationMin, phone, paymentId });
  } catch (err) {
    logger.error({ err }, 'Admin voucher generation failed');
    db.markPaymentFailed(paymentId);
    return res.status(500).json({ error: 'Voucher generation failed' });
  }

  db.insertVoucher({
    paymentId,
    username:    voucher.username,
    password:    voucher.password,
    durationMin: voucher.durationMin,
    phone,
    expiresAt:   voucher.expiresAt,
  });
  db.markPaymentCompleted(paymentId);

  // SMS is optional on admin issue
  const message = buildVoucherMessage(voucher.username, voucher.password, voucher.durationMin);
  sendSms(phone, message);

  logger.info({ phone, amount, username: voucher.username }, 'Admin voucher issued');

  return res.status(201).json({ voucher });
});

module.exports = router;

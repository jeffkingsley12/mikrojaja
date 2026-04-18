'use strict';

const express   = require('express');
const router    = express.Router();
const config    = require('../config');
const db        = require('../db/database');
const { generateVoucher }                = require('../services/voucher');
const { sendSms, buildVoucherMessage }   = require('../services/sms');
const { authenticateDevice }             = require('../middleware/auth');
const { validatePayment }                = require('../middleware/validate');
const { sha256 }                         = require('../utils/crypto');
const logger                             = require('../utils/logger');

/**
 * POST /api/payment/airtel
 *
 * Receives a parsed Airtel Money SMS from the Android gateway.
 * Idempotent: re-delivering the same payment returns the existing voucher.
 *
 * Request body:
 *   { amount: number, phone: string, raw_sms: string, txn_id?: string }
 *
 * Headers:
 *   X-Timestamp: unix seconds
 *   X-Signature: HMAC-SHA256(secret, "{ts}:{amount}:{phone}")
 */
router.post(
  '/airtel',
  authenticateDevice,
  validatePayment,
  async (req, res) => {
    const { amount, phone, raw_sms, txn_id } = req.body;

    // ── Build deduplication key ─────────────────────────────────────────
    // Transaction ID is preferred (explicit, stable).
    // Fall back to SHA-256 of normalized SMS body.
    const smsHash  = sha256(raw_sms.trim().toLowerCase());
    const dedupKey = txn_id || smsHash;

    const reqLogger = logger.child({ dedupKey, phone, amount });
    reqLogger.info('Payment received');

    // ── Validate amount is in pricing map ──────────────────────────────
    const durationMin = config.pricingMap[amount];
    if (!durationMin) {
      reqLogger.warn('Unrecognized payment amount');
      return res.status(422).json({
        error: 'Unrecognized amount',
        amount,
        accepted: Object.keys(config.pricingMap).map(Number),
      });
    }

    // ── Atomic insert (UNIQUE constraint prevents double-processing) ────
    let insertResult;
    try {
      insertResult = db.insertPaymentAtomic({ dedupKey, phone, amount, rawSms: raw_sms, smsHash });
    } catch (err) {
      reqLogger.error({ err }, 'DB insert error');
      db.logError('payment_insert', err, { dedupKey, phone, amount });
      return res.status(500).json({ error: 'Internal error — payment logged for review' });
    }

    // ── Duplicate: return existing voucher (idempotent) ─────────────────
    if (!insertResult.inserted) {
      const existing = insertResult.existing;
      reqLogger.info('Duplicate payment — returning existing voucher');

      if (existing.status === 'completed' && existing.username) {
        return res.json({
          duplicate: true,
          voucher: {
            username:    existing.username,
            password:    existing.password,
            durationMin: existing.duration_min,
          },
        });
      }

      // Payment exists but voucher generation previously failed — retry below
      reqLogger.warn('Previous attempt failed — retrying voucher generation');
    }

    const paymentId = insertResult.paymentId
      ?? insertResult.existing?.id;  // retry path

    // ── Generate and provision voucher ──────────────────────────────────
    let voucher;
    try {
      voucher = await generateVoucher({ durationMin, phone, paymentId });
    } catch (err) {
      reqLogger.error({ err }, 'Voucher generation failed');
      db.markPaymentFailed(paymentId);
      db.logError('voucher_generation', err, { paymentId, phone, amount });
      return res.status(500).json({ error: 'Voucher generation failed — support will contact you' });
    }

    // ── Persist voucher record ──────────────────────────────────────────
    try {
      db.insertVoucher({
        paymentId,
        username:    voucher.username,
        password:    voucher.password,
        durationMin: voucher.durationMin,
        phone,
        expiresAt:   voucher.expiresAt,
      });
      db.markPaymentCompleted(paymentId);
    } catch (err) {
      // Voucher may already exist (retry path) — not fatal
      reqLogger.warn({ err }, 'Voucher insert conflict — may be retry');
    }

    // ── Send voucher SMS (non-blocking — never fail the response) ───────
    const message = buildVoucherMessage(voucher.username, voucher.password, voucher.durationMin);
    sendSms(phone, message).then(sent => {
      if (!sent) reqLogger.warn('SMS delivery failed — voucher still valid');
    });

    reqLogger.info({ username: voucher.username }, 'Payment processed successfully');

    return res.status(201).json({
      success: true,
      voucher: {
        username:    voucher.username,
        password:    voucher.password,
        durationMin: voucher.durationMin,
        expiresAt:   voucher.expiresAt,
      },
    });
  },
);

module.exports = router;

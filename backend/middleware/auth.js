'use strict';

const config = require('../config');
const { computeHmac, timingSafeEqual } = require('../utils/crypto');
const logger = require('../utils/logger');

/**
 * Middleware: authenticate Android device requests via HMAC-SHA256.
 *
 * Android must send:
 *   X-Timestamp : Unix seconds (string)
 *   X-Signature : HMAC-SHA256( secret, "{timestamp}:{amount}:{phone}" )
 *
 * Rejects:
 *  - missing headers
 *  - timestamp outside ±WINDOW seconds (anti-replay)
 *  - invalid HMAC (wrong secret or tampered body)
 */
function authenticateDevice(req, res, next) {
  const timestamp = req.headers['x-timestamp'];
  const signature = req.headers['x-signature'];

  if (!timestamp || !signature) {
    logger.warn({ ip: req.ip }, 'Auth rejected: missing headers');
    return res.status(401).json({ error: 'Missing authentication headers' });
  }

  // ── Anti-replay: reject stale requests ───────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const ts  = parseInt(timestamp, 10);

  if (isNaN(ts) || Math.abs(now - ts) > config.security.timestampWindowSecs) {
    logger.warn({ ts, now, ip: req.ip }, 'Auth rejected: stale timestamp');
    return res.status(401).json({ error: 'Request expired or clock skew too large' });
  }

  // ── HMAC verification ─────────────────────────────────────────────────
  // Signed payload = timestamp + amount + phone (must match Android implementation)
  const amount = String(req.body?.amount ?? '');
  const phone  = String(req.body?.phone  ?? '');
  const signedPayload = `${timestamp}:${amount}:${phone}`;

  const expected = computeHmac(config.security.apiSecret, signedPayload);

  if (!timingSafeEqual(expected, signature)) {
    logger.warn({ ip: req.ip, phone }, 'Auth rejected: invalid signature');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  next();
}

/**
 * Middleware: authenticate admin endpoints via Bearer token.
 */
function authenticateAdmin(req, res, next) {
  const auth = req.headers['authorization'] ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!token || !timingSafeEqual(
    Buffer.from(token).toString('hex'),
    Buffer.from(config.security.adminToken).toString('hex'),
  )) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = { authenticateDevice, authenticateAdmin };

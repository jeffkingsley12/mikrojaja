'use strict';

const crypto = require('crypto');

/**
 * Compute HMAC-SHA256 of data using secret.
 * @param {string} secret
 * @param {string} data
 * @returns {string} hex digest
 */
function computeHmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Timing-safe comparison of two strings.
 * Returns true if equal; prevents timing attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Both buffers must be the same byte length for timingSafeEqual
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * SHA-256 hash of a string. Used for SMS dedup fallback.
 * @param {string} input
 * @returns {string} hex digest
 */
function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Generate a cryptographically random alphanumeric string.
 * @param {number} length
 * @returns {string}
 */
function randomAlphanumeric(length) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 confusion
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map(b => chars[b % chars.length])
    .join('');
}

module.exports = { computeHmac, timingSafeEqual, sha256, randomAlphanumeric };

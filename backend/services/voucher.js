'use strict';

const { RouterOSAPI } = require('node-routeros');
const config = require('../config');
const { randomAlphanumeric } = require('../utils/crypto');
const logger = require('../utils/logger');

/**
 * Generate a unique 8-char username and 8-char password pair.
 * Format: USR-XXXXXXXX / PWD-XXXXXXXX
 */
function generateCredentials() {
  return {
    username: `USR-${randomAlphanumeric(8)}`,
    password: `${randomAlphanumeric(8)}`,
  };
}

/**
 * Connect to MikroTik and create a hotspot user with the given credentials.
 *
 * Profile must be pre-created on the router (e.g. "1hr", "3hr", "24hr").
 * Falls back to creating a user with a limit-uptime parameter.
 *
 * @param {string} username
 * @param {string} password
 * @param {number} durationMin
 * @param {string} phone       - stored as comment on router for tracing
 * @returns {Promise<void>}
 */
async function createMikrotikUser(username, password, durationMin, phone) {
  const api = new RouterOSAPI({
    host:     config.mikrotik.host,
    port:     config.mikrotik.port,
    user:     config.mikrotik.user,
    password: config.mikrotik.pass,
    timeout:  10,              // 10 second connection timeout
  });

  try {
    await api.connect();

    // Format duration as MikroTik time string: "1d2h3m"
    const limitUptime = minutesToMikrotikTime(durationMin);

    await api.write('/ip/hotspot/user/add', [
      `=name=${username}`,
      `=password=${password}`,
      `=server=${config.mikrotik.hotspotServer}`,
      `=limit-uptime=${limitUptime}`,
      `=comment=phone:${phone}`,
    ]);

    logger.info({ username, durationMin, phone }, 'MikroTik user created');
  } finally {
    api.close();
  }
}

/**
 * Convert minutes to MikroTik time string format.
 * e.g. 90 → "1h30m", 1440 → "1d"
 */
function minutesToMikrotikTime(minutes) {
  const days  = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins  = minutes % 60;

  let result = '';
  if (days  > 0) result += `${days}d`;
  if (hours > 0) result += `${hours}h`;
  if (mins  > 0) result += `${mins}m`;
  return result || '0m';
}

/**
 * Top-level voucher generation — generates credentials and provisions
 * them on MikroTik. Returns the credentials for saving + SMS delivery.
 *
 * @param {object} opts
 * @param {number} opts.durationMin
 * @param {string} opts.phone
 * @param {number} opts.paymentId
 * @returns {Promise<{ username: string, password: string, durationMin: number, expiresAt: string }>}
 */
async function generateVoucher({ durationMin, phone, paymentId }) {
  const { username, password } = generateCredentials();

  const expiresAt = new Date(
    Date.now() + durationMin * 60 * 1000
  ).toISOString();

  // Attempt MikroTik provisioning — if it fails we store the voucher
  // and can re-provision manually; payment is not lost.
  try {
    await createMikrotikUser(username, password, durationMin, phone);
  } catch (err) {
    logger.error({ err, username, paymentId }, 'MikroTik provisioning failed — voucher saved for manual retry');
    // Do NOT rethrow — voucher data is still returned and persisted in DB.
    // Admin dashboard will show "pending MikroTik" vouchers.
  }

  return { username, password, durationMin, expiresAt };
}

module.exports = { generateVoucher };

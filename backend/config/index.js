'use strict';

require('dotenv').config();

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key, defaultValue) {
  return process.env[key] ?? defaultValue;
}

module.exports = {
  server: {
    port: parseInt(optional('PORT', '3000'), 10),
    env: optional('NODE_ENV', 'development'),
  },

  security: {
    apiSecret: required('API_SECRET'),
    timestampWindowSecs: parseInt(optional('REQUEST_TIMESTAMP_WINDOW_SECS', '300'), 10),
    adminToken: required('ADMIN_TOKEN'),
  },

  db: {
    path: optional('DB_PATH', './data/vouchers.db'),
  },

  mikrotik: {
    host: required('MIKROTIK_HOST'),
    port: parseInt(optional('MIKROTIK_PORT', '8728'), 10),
    user: required('MIKROTIK_USER'),
    pass: required('MIKROTIK_PASS'),
    hotspotServer: optional('MIKROTIK_HOTSPOT_SERVER', 'hotspot1'),
  },

  sms: {
    apiKey: optional('AT_API_KEY', ''),
    username: optional('AT_USERNAME', 'sandbox'),
    senderId: optional('AT_SENDER_ID', 'VoucherSMS'),
  },

  rateLimit: {
    windowMs: parseInt(optional('RATE_LIMIT_WINDOW_MS', '60000'), 10),
    max: parseInt(optional('RATE_LIMIT_MAX_REQUESTS', '30'), 10),
  },

  /**
   * Payment amount (UGX) → hotspot duration (minutes)
   * Modify here without touching any other code.
   */
  pricingMap: {
    500:  60,      // 1 hour
    1000: 180,     // 3 hours
    2000: 1440,    // 24 hours
    5000: 4320,    // 3 days
    10000: 10080,  // 7 days
  },
};

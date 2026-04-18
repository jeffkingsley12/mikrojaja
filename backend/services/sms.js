'use strict';

const https = require('https');
const querystring = require('querystring');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Send SMS via Africa's Talking REST API.
 * Does NOT throw — SMS delivery failure must never block payment confirmation.
 *
 * @param {string} phone       - recipient in E.164 or local format
 * @param {string} message     - SMS body (max 160 chars for single SMS)
 * @returns {Promise<boolean>} - true if delivered, false on any error
 */
async function sendSms(phone, message) {
  const normalizedPhone = normalizePhone(phone);

  const postData = querystring.stringify({
    username: config.sms.username,
    to:       normalizedPhone,
    message:  message.slice(0, 459),    // AT max per concatenated SMS
    from:     config.sms.senderId || undefined,
  });

  const options = {
    hostname: 'api.africastalking.com',
    path:     '/version1/messaging',
    method:   'POST',
    headers: {
      'apiKey':         config.sms.apiKey,
      'Content-Type':   'application/x-www-form-urlencoded',
      'Accept':         'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
    timeout: 15_000,
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const recipient = parsed?.SMSMessageData?.Recipients?.[0];
          const status    = recipient?.status ?? 'unknown';
          const cost      = recipient?.cost   ?? 'unknown';

          if (res.statusCode === 201) {
            logger.info({ phone: normalizedPhone, status, cost }, 'SMS sent');
            resolve(true);
          } else {
            logger.warn({ phone: normalizedPhone, status, body }, 'SMS delivery issue');
            resolve(false);
          }
        } catch (err) {
          logger.error({ err, body }, 'SMS response parse error');
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      logger.error({ err, phone: normalizedPhone }, 'SMS request error');
      resolve(false);
    });

    req.on('timeout', () => {
      logger.error({ phone: normalizedPhone }, 'SMS request timed out');
      req.destroy();
      resolve(false);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Build a voucher delivery message.
 */
function buildVoucherMessage(username, password, durationMin) {
  const humanDuration = formatDuration(durationMin);
  return (
    `Your WiFi voucher is ready!\n` +
    `Username: ${username}\n` +
    `Password: ${password}\n` +
    `Duration: ${humanDuration}\n` +
    `Connect to WiFi and enter above at the login page.`
  );
}

function formatDuration(minutes) {
  if (minutes >= 1440) return `${minutes / 1440} day(s)`;
  if (minutes >= 60)   return `${minutes / 60} hour(s)`;
  return `${minutes} minute(s)`;
}

function normalizePhone(phone) {
  phone = phone.trim().replace(/\s+/g, '');
  if (phone.startsWith('+')) return phone;
  if (phone.startsWith('256')) return `+${phone}`;
  if (phone.startsWith('0')) return `+256${phone.slice(1)}`;
  return `+256${phone}`;
}

module.exports = { sendSms, buildVoucherMessage };

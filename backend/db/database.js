'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');
const logger = require('../utils/logger');

let _db = null;

function getDb() {
  if (_db) return _db;

  // Ensure data directory exists
  const dbDir = path.dirname(path.resolve(config.db.path));
  fs.mkdirSync(dbDir, { recursive: true });

  _db = new Database(config.db.path, {
    // Verbose logging only in dev
    verbose: config.server.env === 'development'
      ? (msg) => logger.debug({ sql: msg }, 'SQL')
      : null,
  });

  // Performance + durability settings
  _db.pragma('journal_mode = WAL');       // concurrent reads during writes
  _db.pragma('synchronous = NORMAL');     // safe with WAL
  _db.pragma('foreign_keys = ON');
  _db.pragma('temp_store = MEMORY');
  _db.pragma('cache_size = -8000');       // 8 MB page cache

  migrate(_db);

  logger.info({ path: config.db.path }, 'Database ready');
  return _db;
}

function migrate(db) {
  db.exec(`
    -- ── Payments ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS payments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      dedup_key   TEXT    NOT NULL,          -- txn_id preferred; sms_hash fallback
      phone       TEXT    NOT NULL,
      amount      INTEGER NOT NULL,
      raw_sms     TEXT    NOT NULL,
      sms_hash    TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending',  -- pending | completed | failed
      created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      completed_at TEXT,

      CONSTRAINT uq_dedup_key UNIQUE (dedup_key)
    );

    CREATE INDEX IF NOT EXISTS idx_payments_phone     ON payments(phone);
    CREATE INDEX IF NOT EXISTS idx_payments_status    ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_payments_created   ON payments(created_at);

    -- ── Vouchers ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS vouchers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id   INTEGER NOT NULL REFERENCES payments(id),
      username     TEXT    NOT NULL UNIQUE,
      password     TEXT    NOT NULL,
      duration_min INTEGER NOT NULL,
      phone        TEXT    NOT NULL,
      used         INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      expires_at   TEXT,

      CONSTRAINT uq_voucher_username UNIQUE (username)
    );

    CREATE INDEX IF NOT EXISTS idx_vouchers_phone      ON vouchers(phone);
    CREATE INDEX IF NOT EXISTS idx_vouchers_payment    ON vouchers(payment_id);

    -- ── Error log ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS error_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      context    TEXT,
      error      TEXT,
      payload    TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}

// ── Prepared statement cache ───────────────────────────────────────────────

let _stmts = null;
function stmts() {
  if (_stmts) return _stmts;
  const db = getDb();

  _stmts = {
    insertPayment: db.prepare(`
      INSERT INTO payments (dedup_key, phone, amount, raw_sms, sms_hash)
      VALUES (@dedupKey, @phone, @amount, @rawSms, @smsHash)
    `),

    findPaymentByDedupKey: db.prepare(`
      SELECT p.*, v.username, v.password, v.duration_min
      FROM payments p
      LEFT JOIN vouchers v ON v.payment_id = p.id
      WHERE p.dedup_key = ?
    `),

    markPaymentCompleted: db.prepare(`
      UPDATE payments
      SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?
    `),

    markPaymentFailed: db.prepare(`
      UPDATE payments
      SET status = 'failed'
      WHERE id = ?
    `),

    insertVoucher: db.prepare(`
      INSERT INTO vouchers (payment_id, username, password, duration_min, phone, expires_at)
      VALUES (@paymentId, @username, @password, @durationMin, @phone, @expiresAt)
    `),

    logError: db.prepare(`
      INSERT INTO error_log (context, error, payload)
      VALUES (?, ?, ?)
    `),

    listPayments: db.prepare(`
      SELECT p.*, v.username, v.duration_min
      FROM payments p
      LEFT JOIN vouchers v ON v.payment_id = p.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `),

    getStats: db.prepare(`
      SELECT
        COUNT(*) AS total_payments,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
        SUM(amount) AS total_ugx
      FROM payments
      WHERE status = 'completed'
    `),
  };

  return _stmts;
}

/**
 * Atomically insert a payment record.
 * Returns { inserted: true, paymentId } on success.
 * Returns { inserted: false, existing } when dedupKey already exists.
 */
function insertPaymentAtomic(opts) {
  const db = getDb();
  const s = stmts();

  // Use a transaction so we can do insert-or-select atomically
  const run = db.transaction(() => {
    try {
      const result = s.insertPayment.run({
        dedupKey: opts.dedupKey,
        phone:    opts.phone,
        amount:   opts.amount,
        rawSms:   opts.rawSms,
        smsHash:  opts.smsHash,
      });
      return { inserted: true, paymentId: result.lastInsertRowid };
    } catch (err) {
      // SQLITE_CONSTRAINT_UNIQUE → duplicate
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.message.includes('UNIQUE')) {
        const existing = s.findPaymentByDedupKey.get(opts.dedupKey);
        return { inserted: false, existing };
      }
      throw err;
    }
  });

  return run();
}

function insertVoucher(opts) {
  return stmts().insertVoucher.run(opts);
}

function markPaymentCompleted(paymentId) {
  return stmts().markPaymentCompleted.run(paymentId);
}

function markPaymentFailed(paymentId) {
  return stmts().markPaymentFailed.run(paymentId);
}

function logError(context, error, payload) {
  try {
    stmts().logError.run(
      context,
      String(error),
      payload ? JSON.stringify(payload) : null,
    );
  } catch (_) {
    // Never let error logging crash the process
  }
}

function listPayments({ limit = 50, offset = 0 } = {}) {
  return stmts().listPayments.all(limit, offset);
}

function getStats() {
  return stmts().getStats.get();
}

module.exports = {
  getDb,
  insertPaymentAtomic,
  insertVoucher,
  markPaymentCompleted,
  markPaymentFailed,
  logError,
  listPayments,
  getStats,
};

'use strict';

const express    = require('express');
const rateLimit  = require('express-rate-limit');
const config     = require('./config');
const logger     = require('./utils/logger');
const { getDb }  = require('./db/database');

const paymentRouter = require('./routes/payment');
const adminRouter   = require('./routes/admin');
const healthRouter  = require('./routes/health');

// ── Initialize DB eagerly (migrations run here) ───────────────────────────
getDb();

const app = express();

// ── Trust proxy (needed for correct IP behind nginx/Caddy) ───────────────
app.set('trust proxy', 1);

// ── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '16kb' }));   // reject oversized bodies

// ── Security headers ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.removeHeader('X-Powered-By');
  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs:         config.rateLimit.windowMs,
  max:              config.rateLimit.max,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests, slow down.' },
  skip: (req) => req.path === '/health',  // never rate-limit health checks
});
app.use(limiter);

// ── Request logging ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      method:  req.method,
      path:    req.path,
      status:  res.statusCode,
      ms:      Date.now() - start,
      ip:      req.ip,
    }, 'request');
  });
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/health',        healthRouter);
app.use('/api/payment',   paymentRouter);
app.use('/admin',         adminRouter);

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ──────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────
const server = app.listen(config.server.port, '0.0.0.0', () => {
  logger.info({ port: config.server.port, env: config.server.env }, 'Server started');
});

// ── Graceful shutdown ─────────────────────────────────────────────────────
function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received');
  server.close(() => {
    logger.info('HTTP server closed');
    try { getDb().close(); } catch (_) {}
    process.exit(0);
  });

  // Force exit if shutdown takes too long
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app; // for testing

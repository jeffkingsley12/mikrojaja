'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

router.get('/', (req, res) => {
  try {
    // Lightweight DB probe
    db.getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok', ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: String(err) });
  }
});

module.exports = router;

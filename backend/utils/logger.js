'use strict';

const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.server.env === 'production' ? 'info' : 'debug',
  ...(config.server.env !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    },
  }),
  base: { service: 'airtel-voucher' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;

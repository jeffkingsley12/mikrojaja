'use strict';

const Joi = require('joi');

const paymentSchema = Joi.object({
  // Validated as number — prevents prototype pollution via string keys
  amount: Joi.number().integer().positive().max(10_000_000).required(),

  // Normalized E.164 or local Ugandan format
  phone: Joi.string()
    .pattern(/^\+?[0-9]{9,15}$/)
    .required(),

  raw_sms: Joi.string().min(10).max(1000).required(),

  // Airtel transaction ID — preferred dedup key
  txn_id: Joi.string().alphanum().max(64).optional(),
});

const adminVoucherSchema = Joi.object({
  phone:    Joi.string().pattern(/^\+?[0-9]{9,15}$/).required(),
  amount:   Joi.number().integer().positive().required(),
  reason:   Joi.string().max(200).optional(),
});

/**
 * Factory: returns express middleware that validates req.body against schema.
 */
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,          // return all errors
      stripUnknown: true,         // drop any extra fields
      convert: true,              // coerce types (e.g. "500" → 500)
    });

    if (error) {
      const messages = error.details.map(d => d.message);
      return res.status(400).json({ error: 'Validation failed', details: messages });
    }

    req.body = value; // use sanitized + coerced values downstream
    next();
  };
}

module.exports = {
  validatePayment: validate(paymentSchema),
  validateAdminVoucher: validate(adminVoucherSchema),
};

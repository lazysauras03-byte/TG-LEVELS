/**
 * database/src/index.js
 *
 * Public entry point for the database layer.
 * Import this from backend: const db = require("../../database/src");
 */

const pool          = require("./pool");
const candleStore   = require("./candleStore");
const validationEngine = require("./validationEngine");
const recoveryEngine   = require("./recoveryEngine");
const repairLog        = require("./repairLog");

module.exports = {
  ...pool,
  ...candleStore,
  ...validationEngine,
  ...recoveryEngine,
  ...repairLog,
};

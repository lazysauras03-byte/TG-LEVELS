/**
 * database/src/repairLog.js
 *
 * Audit trail for all repair / refetch operations.
 * Non-critical — errors here are swallowed so they never block a repair.
 */

const { query } = require("./pool");

/**
 * Insert a new repair_log entry and return its id.
 */
async function logRepairStart({ symbol, resolution, trigger }) {
  try {
    const rows = await query(
      `INSERT INTO repair_log (symbol, resolution, trigger, status)
       VALUES ($1, $2, $3, 'running')
       RETURNING id`,
      [symbol, resolution ?? null, trigger]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn("[RepairLog] logRepairStart error:", err.message);
    return null;
  }
}

/**
 * Update an existing repair_log row with the outcome.
 */
async function logRepairFinish(id, { status, detail, deleted = 0, inserted = 0 }) {
  if (!id) return;
  try {
    await query(
      `UPDATE repair_log
       SET finished_at = NOW(),
           status = $2,
           detail = $3,
           candles_deleted  = $4,
           candles_inserted = $5
       WHERE id = $1`,
      [id, status, detail ?? null, deleted, inserted]
    );
  } catch (err) {
    console.warn("[RepairLog] logRepairFinish error:", err.message);
  }
}

/**
 * Fetch the most recent repair entries for a symbol.
 */
async function getRepairHistory(symbol, limit = 20) {
  try {
    return await query(
      `SELECT * FROM repair_log
       WHERE symbol = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [symbol, limit]
    );
  } catch (err) {
    console.warn("[RepairLog] getRepairHistory error:", err.message);
    return [];
  }
}

module.exports = { logRepairStart, logRepairFinish, getRepairHistory };

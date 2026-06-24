/**
 * database/src/pool.js
 *
 * Shared PostgreSQL connection pool.
 * All other DB modules import { pool, query } from here.
 * Reads DATABASE_URL (or individual PG* vars) from environment.
 *
 * FIX: pg driver requires password to be a string, never undefined.
 * When DATABASE_URL is set, pg parses it directly — individual PG* vars
 * are ignored. When DATABASE_URL is missing, individual vars are used.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../backend/.env") });

const { Pool } = require("pg");

// Build connection config carefully — password MUST be a string or pg throws
// "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string"
let poolConfig;

if (process.env.DATABASE_URL) {
  // Use connection string directly — pg handles parsing
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
} else {
  // Build from individual vars — guarantee password is always a string
  poolConfig = {
    host:     process.env.PGHOST     || "localhost",
    port:     parseInt(process.env.PGPORT || "5432"),
    database: process.env.PGDATABASE || "tgg",
    user:     process.env.PGUSER     || "postgres",
    password: String(process.env.PGPASSWORD || ""),  // MUST be string
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  console.error("[DB Pool] Unexpected client error:", err.message);
});

pool.on("connect", () => {
  // Uncomment for debugging:
  // console.log("[DB Pool] New client connected");
});

/**
 * Convenience wrapper: run a parameterized query and return rows.
 */
async function query(text, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Run multiple statements in a single transaction.
 */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verify the connection is alive. Returns true on success, false on failure.
 */
async function healthCheck() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

module.exports = { pool, query, transaction, healthCheck };
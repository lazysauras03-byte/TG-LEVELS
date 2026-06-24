/**
 * database/src/migrate.js
 *
 * Run once to create all tables:
 *   node database/src/migrate.js
 *
 * Safe to re-run (uses IF NOT EXISTS throughout).
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../backend/.env") });

const fs   = require("fs");
const path = require("path");
const { pool } = require("./pool");

async function migrate() {
  const sqlFile = path.resolve(__dirname, "../migrations/001_init.sql");
  if (!fs.existsSync(sqlFile)) {
    console.error("Migration file not found:", sqlFile);
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlFile, "utf8");
  const client = await pool.connect();

  try {
    console.log("[Migrate] Running migration 001_init.sql ...");
    await client.query(sql);
    console.log("[Migrate] ✅  All tables created / verified.");
  } catch (err) {
    console.error("[Migrate] ❌  Migration failed:", err.message);
    console.error(
      "\n  If TimescaleDB is not installed, edit migrations/001_init.sql and remove the\n" +
      "  TimescaleDB-specific lines (CREATE EXTENSION and SELECT create_hypertable(...))\n" +
      "  to run on plain PostgreSQL.\n"
    );
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

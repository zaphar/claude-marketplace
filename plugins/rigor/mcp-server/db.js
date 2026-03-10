import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

let _db = null;

/**
 * Get or initialize the SQLite database.
 * @returns {import("better-sqlite3").Database}
 */
export function getDb() {
  if (_db) return _db;

  const dbPath =
    process.env.RIGOROUS_DEV_DB_PATH ||
    path.join(process.cwd(), ".claude", "rigor.db");

  mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma("journal_mode=WAL");
  db.pragma("foreign_keys=ON");

  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project'")
    .get();

  if (!tableExists) {
    const ddl = readFileSync(SCHEMA_PATH, "utf8");
    db.exec(ddl);
  }

  _db = db;
  return _db;
}

/**
 * Close the database connection.
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

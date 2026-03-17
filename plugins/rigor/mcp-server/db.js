import Database from "better-sqlite3";
import { mkdirSync, existsSync, renameSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "./migrate.js";

let _db = null;

/**
 * Get or initialize the SQLite database.
 * @returns {import("better-sqlite3").Database}
 */
export function getDb(projectRoot) {
  if (_db) return _db;

  const dbPath =
    process.env.RIGOR_DB_PATH ||
    path.join(projectRoot, ".claude", "rigor.db");

  mkdirSync(path.dirname(dbPath), { recursive: true });

  const oldDbPath = path.join(projectRoot, ".claude", "rigorous-dev.db");
  if (!existsSync(dbPath) && existsSync(oldDbPath)) {
    renameSync(oldDbPath, dbPath);
  }

  const db = new Database(dbPath);

  db.pragma("journal_mode=WAL");
  db.pragma("foreign_keys=ON");

  runMigrations(db);

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

import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

/**
 * Parse a migration filename into its version number and name.
 * @param {string} filename - e.g. "001_baseline.sql"
 * @returns {{ version: number, name: string } | null}
 */
export function parseMigrationFile(filename) {
  const match = filename.match(/^(\d{3})_(.+)\.sql$/);
  if (!match) return null;
  return { version: parseInt(match[1], 10), name: match[2] };
}

/**
 * Compute a SHA-256 hex digest of content.
 * @param {string} content
 * @returns {string}
 */
export function computeChecksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Run all pending migrations against the database.
 *
 * 1. Bootstraps the schema_version table if it doesn't exist.
 * 2. Detects pre-migration databases and adopts the baseline without executing it.
 * 3. Verifies checksums of already-applied migrations.
 * 4. Applies pending migrations in version order inside transactions.
 *
 * @param {import("better-sqlite3").Database} db
 */
export function runMigrations(db) {
  // 1. Bootstrap schema_version table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      checksum TEXT NOT NULL
    );
  `);

  // 2. Detect pre-migration databases — project table exists but no schema_version rows
  const projectExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='project'",
    )
    .get();
  const appliedCount = db
    .prepare("SELECT COUNT(*) AS cnt FROM schema_version")
    .get().cnt;

  if (projectExists && appliedCount === 0) {
    // Existing database created before migration system — adopt baseline
    const baselinePath = path.join(MIGRATIONS_DIR, "001_baseline.sql");
    const content = readFileSync(baselinePath, "utf8");
    const checksum = computeChecksum(content);
    db.prepare(
      "INSERT INTO schema_version (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)",
    ).run(1, "baseline", new Date().toISOString(), checksum);
  }

  // 3. Read available migrations from disk, sorted by version
  const files = readdirSync(MIGRATIONS_DIR)
    .map((f) => {
      const parsed = parseMigrationFile(f);
      return parsed ? { ...parsed, filename: f } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);

  // 4. Load all applied migrations for checksum verification
  const applied = new Map();
  for (const row of db
    .prepare("SELECT version, name, checksum FROM schema_version")
    .all()) {
    applied.set(row.version, row);
  }

  // Verify checksums of already-applied migrations
  for (const migration of files) {
    const record = applied.get(migration.version);
    if (!record) continue;

    const content = readFileSync(
      path.join(MIGRATIONS_DIR, migration.filename),
      "utf8",
    );
    const currentChecksum = computeChecksum(content);

    if (currentChecksum !== record.checksum) {
      throw new Error(
        `Migration ${migration.filename} has been modified after being applied. ` +
          `Expected checksum ${record.checksum}, got ${currentChecksum}. ` +
          `Do not modify applied migrations — create a new migration instead.`,
      );
    }
  }

  // 5. Apply pending migrations in version order
  for (const migration of files) {
    if (applied.has(migration.version)) continue;

    const content = readFileSync(
      path.join(MIGRATIONS_DIR, migration.filename),
      "utf8",
    );
    const checksum = computeChecksum(content);

    const applyMigration = db.transaction(() => {
      db.exec(content);
      db.prepare(
        "INSERT INTO schema_version (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)",
      ).run(
        migration.version,
        migration.name,
        new Date().toISOString(),
        checksum,
      );
    });

    applyMigration();
  }
}

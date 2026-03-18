import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { closeDb, getDb } from "../db.js";
import { runMigrations, parseMigrationFile, computeChecksum } from "../migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

/** Count the number of valid migration SQL files on disk. */
function migrationFileCount() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => parseMigrationFile(f) !== null)
    .length;
}

// ───────────────────────────────────────────────────────────────
// parseMigrationFile
// ───────────────────────────────────────────────────────────────

describe("parseMigrationFile", () => {
  it("parses a valid baseline filename", () => {
    const result = parseMigrationFile("001_baseline.sql");
    assert.deepStrictEqual(result, { version: 1, name: "baseline" });
  });

  it("parses a multi-word migration name", () => {
    const result = parseMigrationFile("002_add_user_roles.sql");
    assert.deepStrictEqual(result, { version: 2, name: "add_user_roles" });
  });

  it("parses higher version numbers", () => {
    const result = parseMigrationFile("099_final_cleanup.sql");
    assert.deepStrictEqual(result, { version: 99, name: "final_cleanup" });
  });

  it("returns null for non-SQL files", () => {
    assert.strictEqual(parseMigrationFile("readme.md"), null);
  });

  it("returns null for filenames without zero-padded 3-digit prefix", () => {
    assert.strictEqual(parseMigrationFile("1_short.sql"), null);
  });

  it("returns null for non-numeric prefix", () => {
    assert.strictEqual(parseMigrationFile("abc_name.sql"), null);
  });

  it("returns null for empty string", () => {
    assert.strictEqual(parseMigrationFile(""), null);
  });
});

// ───────────────────────────────────────────────────────────────
// computeChecksum
// ───────────────────────────────────────────────────────────────

describe("computeChecksum", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = computeChecksum("hello world");
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("returns consistent results for the same input", () => {
    const a = computeChecksum("test content");
    const b = computeChecksum("test content");
    assert.strictEqual(a, b);
  });

  it("returns different results for different input", () => {
    const a = computeChecksum("input one");
    const b = computeChecksum("input two");
    assert.notStrictEqual(a, b);
  });
});

// ───────────────────────────────────────────────────────────────
// runMigrations — integration tests
// ───────────────────────────────────────────────────────────────

describe("runMigrations", () => {
  it("applies all migrations to a fresh in-memory database", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode=WAL");
    db.pragma("foreign_keys=ON");

    runMigrations(db);

    const expectedCount = migrationFileCount();

    // schema_version row count matches migration file count
    const rows = db.prepare("SELECT * FROM schema_version ORDER BY version").all();
    assert.strictEqual(rows.length, expectedCount,
      `schema_version should have exactly ${expectedCount} rows (one per migration file)`);

    // Every row has required fields
    for (const row of rows) {
      assert.ok(row.applied_at, `migration ${row.version} should have applied_at`);
      assert.ok(row.checksum, `migration ${row.version} should have checksum`);
    }

    // project table exists (part of baseline DDL)
    const projectTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project'")
      .get();
    assert.ok(projectTable, "project table should exist after migrations");

    // All 43 original tables exist (exclude schema_version and sqlite_sequence which are auto-created)
    const tableCount = db
      .prepare("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name NOT IN ('schema_version', 'sqlite_sequence')")
      .get().cnt;
    assert.strictEqual(tableCount, 43, "should have exactly 43 tables (excluding schema_version and sqlite_sequence)");

    // No leftover _old_ tables from table-recreation migrations
    const oldTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '\\_%' ESCAPE '\\'")
      .all();
    assert.strictEqual(oldTables.length, 0, "no leftover _old_ tables should remain");

    // No stale FK references to renamed tables
    const staleFKs = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%_old_%'")
      .all();
    assert.strictEqual(staleFKs.length, 0,
      `no tables should have stale FK references to _old_ tables, found: ${staleFKs.map(t => t.name).join(", ")}`);

    // FK integrity check passes
    const fkViolations = db.pragma("foreign_key_check");
    assert.strictEqual(fkViolations.length, 0, "no FK violations after migrations");

    db.close();
  });

  it("creates a fully-migrated database successfully", () => {
    process.env.RIGOR_DB_PATH = ":memory:";
    closeDb();
    const db = getDb("/tmp/test-project");

    const expectedCount = migrationFileCount();

    // All migrations were applied
    const rows = db.prepare("SELECT * FROM schema_version ORDER BY version").all();
    assert.strictEqual(rows.length, expectedCount);
    assert.strictEqual(rows[0].version, 1);
    assert.strictEqual(rows[0].name, "baseline");
    assert.ok(rows[0].checksum, "baseline should have a checksum");

    // Every migration has a checksum and applied_at timestamp
    for (const row of rows) {
      assert.ok(row.checksum, `migration ${row.version} should have a checksum`);
      assert.ok(row.applied_at, `migration ${row.version} should have applied_at`);
    }

    // Expected table count — nothing duplicated or missing
    const tableCount = db
      .prepare("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name NOT IN ('schema_version', 'sqlite_sequence')")
      .get().cnt;
    assert.strictEqual(tableCount, 43);

    closeDb();
  });

  it("is idempotent — re-running produces no errors and no duplicate rows", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode=WAL");
    db.pragma("foreign_keys=ON");

    const expectedCount = migrationFileCount();

    runMigrations(db);
    runMigrations(db);

    const rows = db.prepare("SELECT * FROM schema_version").all();
    assert.strictEqual(rows.length, expectedCount, `schema_version should still have exactly ${expectedCount} rows`);

    db.close();
  });

  it("detects checksum tampering on already-applied migrations", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode=WAL");
    db.pragma("foreign_keys=ON");

    runMigrations(db);

    // Tamper with the stored checksum
    db.prepare("UPDATE schema_version SET checksum = 'tampered_bad_checksum' WHERE version = 1").run();

    assert.throws(
      () => runMigrations(db),
      /has been modified after being applied/,
    );

    db.close();
  });

  it("is a no-op when all migrations are already applied", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode=WAL");
    db.pragma("foreign_keys=ON");

    const expectedCount = migrationFileCount();

    runMigrations(db);

    const beforeRows = db.prepare("SELECT * FROM schema_version ORDER BY version").all();
    assert.strictEqual(beforeRows.length, expectedCount);

    // Capture all checksums and timestamps
    const before = beforeRows.map((r) => ({ checksum: r.checksum, applied_at: r.applied_at }));

    // Run again — should be a complete no-op
    runMigrations(db);

    const afterRows = db.prepare("SELECT * FROM schema_version ORDER BY version").all();
    assert.strictEqual(afterRows.length, expectedCount);
    for (let i = 0; i < expectedCount; i++) {
      assert.strictEqual(afterRows[i].checksum, before[i].checksum);
      assert.strictEqual(afterRows[i].applied_at, before[i].applied_at);
    }

    db.close();
  });
});

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeDb, getDb } from "../db.js";
import { runMigrations, parseMigrationFile, computeChecksum } from "../migrate.js";

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
  it("applies baseline to a fresh database", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode=WAL");
    db.pragma("foreign_keys=ON");

    runMigrations(db);

    // schema_version table exists with exactly 1 row
    const rows = db.prepare("SELECT * FROM schema_version").all();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].version, 1);
    assert.strictEqual(rows[0].name, "baseline");
    assert.ok(rows[0].applied_at, "applied_at should be set");
    assert.ok(rows[0].checksum, "checksum should be set");

    // project table exists (part of baseline DDL)
    const projectTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project'")
      .get();
    assert.ok(projectTable, "project table should exist after baseline migration");

    // All 43 original tables exist (exclude schema_version and sqlite_sequence which are auto-created)
    const tableCount = db
      .prepare("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name NOT IN ('schema_version', 'sqlite_sequence')")
      .get().cnt;
    assert.strictEqual(tableCount, 43, "baseline should create exactly 43 tables (excluding schema_version and sqlite_sequence)");

    db.close();
  });

  it("adopts baseline for pre-migration databases without re-executing DDL", () => {
    // Step 1: Create a fully-migrated DB via getDb (which calls runMigrations)
    process.env.RIGOR_DB_PATH = ":memory:";
    closeDb();
    const db = getDb("/tmp/test-project");

    // Verify baseline was applied
    const beforeRows = db.prepare("SELECT * FROM schema_version").all();
    assert.strictEqual(beforeRows.length, 1);

    // Step 2: Simulate a pre-migration database by clearing schema_version
    // but keeping all tables intact (as if the DB existed before the migration system)
    db.prepare("DELETE FROM schema_version").run();
    const afterDelete = db.prepare("SELECT COUNT(*) AS cnt FROM schema_version").get().cnt;
    assert.strictEqual(afterDelete, 0, "schema_version should be empty after DELETE");

    // project table still exists (simulating pre-migration state)
    const projectExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project'")
      .get();
    assert.ok(projectExists, "project table should still exist");

    // Step 3: Run migrations again — should adopt, not re-execute
    runMigrations(db);

    // schema_version should have 1 row with version=1 adopted
    const adopted = db.prepare("SELECT * FROM schema_version").all();
    assert.strictEqual(adopted.length, 1);
    assert.strictEqual(adopted[0].version, 1);
    assert.strictEqual(adopted[0].name, "baseline");
    assert.ok(adopted[0].checksum, "adopted baseline should have a checksum");

    // Tables still at 43 — nothing was duplicated or broken
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

    runMigrations(db);
    runMigrations(db);

    const rows = db.prepare("SELECT * FROM schema_version").all();
    assert.strictEqual(rows.length, 1, "schema_version should still have exactly 1 row");
    assert.strictEqual(rows[0].version, 1);

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

    runMigrations(db);

    const beforeRows = db.prepare("SELECT * FROM schema_version").all();
    const beforeChecksum = beforeRows[0].checksum;
    const beforeAppliedAt = beforeRows[0].applied_at;

    // Run again — should be a complete no-op
    runMigrations(db);

    const afterRows = db.prepare("SELECT * FROM schema_version").all();
    assert.strictEqual(afterRows.length, 1);
    assert.strictEqual(afterRows[0].checksum, beforeChecksum);
    assert.strictEqual(afterRows[0].applied_at, beforeAppliedAt);

    db.close();
  });
});

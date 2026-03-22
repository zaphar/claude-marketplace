import { closeDb, getDb } from "../db.js";
import { PHASES } from "../write-tools.js";

/**
 * Reset the singleton to a fresh in-memory database with schema applied.
 * Call at the start of each test (or in beforeEach) for isolation.
 * @returns {import("better-sqlite3").Database}
 */
export function freshDb() {
  process.env.RIGOR_DB_PATH = ":memory:";
  closeDb();
  return getDb("/tmp/test-project");
}

/**
 * Seed a minimal iteration with one revision so entity inserts have valid FKs.
 * Returns { iteration_id, phase_id, revision_id } for the requirements phase.
 */
export function seedIteration(db) {
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO project (id, project_name, created_at, updated_at)
     VALUES (1, 'test-project', ?, ?)`
  ).run(now, now);

  const iter = db.prepare(
    `INSERT INTO iteration (status, created_at) VALUES ('active', ?)`
  ).run(now);
  const iteration_id = iter.lastInsertRowid;

  const phases = PHASES;
  const insertPhase = db.prepare(
    "INSERT INTO phase (iteration_id, name, status) VALUES (?, ?, 'pending')"
  );
  for (const name of phases) {
    insertPhase.run(iteration_id, name);
  }

  const reqPhase = db.prepare(
    "SELECT id FROM phase WHERE iteration_id = ? AND name = 'requirements'"
  ).get(iteration_id);

  db.prepare(
    "UPDATE phase SET status = 'in_progress', started_at = ? WHERE id = ?"
  ).run(now, reqPhase.id);

  const rev = db.prepare(
    `INSERT INTO revision (phase_id, producer_agent, created_at, status)
     VALUES (?, 'test-producer', ?, 'draft')`
  ).run(reqPhase.id, now);

  return {
    iteration_id: Number(iteration_id),
    phase_id: Number(reqPhase.id),
    revision_id: Number(rev.lastInsertRowid),
  };
}

/**
 * Get the phase_id for a named phase within an iteration.
 */
export function getPhaseId(db, iteration_id, phase_name) {
  const row = db.prepare(
    "SELECT id FROM phase WHERE iteration_id = ? AND name = ?"
  ).get(iteration_id, phase_name);
  if (!row) throw new Error(`Phase ${phase_name} not found in iteration ${iteration_id}`);
  return Number(row.id);
}

/**
 * Create a revision for a specific phase.
 */
export function seedRevision(db, phase_id) {
  const now = new Date().toISOString();
  const rev = db.prepare(
    `INSERT INTO revision (phase_id, producer_agent, created_at, status)
     VALUES (?, 'test-producer', ?, 'draft')`
  ).run(phase_id, now);
  return Number(rev.lastInsertRowid);
}

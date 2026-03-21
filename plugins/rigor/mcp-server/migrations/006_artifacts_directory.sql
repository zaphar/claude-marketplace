-- Migration 006: Add artifacts_directory to project table
-- 
-- Stores the root directory for all SDLC file artifacts, relative to project root.
-- Default: docs/sdlc
--
-- For existing projects, artifacts_directory defaults to 'docs/sdlc' but existing 
-- files remain at their old locations. Run /rigor:organize-artifacts to migrate.
ALTER TABLE project ADD COLUMN artifacts_directory TEXT NOT NULL DEFAULT 'docs/sdlc';

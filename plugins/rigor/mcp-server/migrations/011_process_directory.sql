-- Add process_directory column to project table.
-- Splits ephemeral workflow artifacts (planning, qa, briefs, code-review) from
-- persistent deliverable artifacts (architecture, ux, product-docs, conventions).
--
-- For NEW projects the default is '.sdlc'.
-- For EXISTING projects we derive it from the current artifacts_directory so that
-- files already on disk remain reachable (e.g. 'docs/sdlc' → 'docs/sdlc/process').
-- The user can later run /rigor:organize-artifacts to relocate files and update
-- the stored value.

ALTER TABLE project ADD COLUMN process_directory TEXT NOT NULL DEFAULT '.sdlc';

-- Back-fill existing rows: their process files live under artifacts_directory/process/
UPDATE project SET process_directory = artifacts_directory || '/process'
  WHERE artifacts_directory != '.sdlc';

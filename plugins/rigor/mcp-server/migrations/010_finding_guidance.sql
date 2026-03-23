-- Migration 010: Add resolution_guidance to code_review_finding
--
-- Adds an optional TEXT column for human triage guidance on how to resolve
-- a finding.  NULL means no guidance has been recorded yet.

ALTER TABLE code_review_finding ADD COLUMN resolution_guidance TEXT;

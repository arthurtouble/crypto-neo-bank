-- Keep one current customer plan. Archived revisions remain available as audit history.
CREATE UNIQUE INDEX IF NOT EXISTS income_allocation_one_current_idx
  ON income_allocation_plans(subject_reference)
  WHERE status != 'archived';

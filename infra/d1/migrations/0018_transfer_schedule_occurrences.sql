-- Schedules are customer instructions and occurrences are approval reminders.
-- Neither table authorizes a wallet signature, payment, or provider mandate.
ALTER TABLE transfer_schedules ADD COLUMN time_zone TEXT;
ALTER TABLE transfer_schedules ADD COLUMN anchor_local TEXT;

CREATE TABLE IF NOT EXISTS schedule_occurrences (
  occurrence_id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  subject_reference TEXT NOT NULL,
  due_at TEXT NOT NULL,
  reminder_state TEXT NOT NULL DEFAULT 'due' CHECK (reminder_state IN ('due','review_opened','dismissed')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE(schedule_id, due_at),
  FOREIGN KEY (schedule_id) REFERENCES transfer_schedules(schedule_id),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);
CREATE INDEX IF NOT EXISTS schedule_occurrences_subject_due_idx ON schedule_occurrences(subject_reference, due_at DESC);

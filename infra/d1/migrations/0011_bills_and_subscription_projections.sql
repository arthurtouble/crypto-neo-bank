-- Reminder plans and disposable provider observations. Neither table authorizes payment.

CREATE TABLE IF NOT EXISTS bill_reminder_plans (
  bill_id TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('housing','utilities','communications','insurance','subscriptions','taxes','other')),
  expected_amount TEXT,
  currency TEXT NOT NULL CHECK (currency IN ('USD','EUR','GBP')),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly','quarterly','yearly')),
  next_due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paused','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);
CREATE INDEX IF NOT EXISTS bill_reminder_subject_idx ON bill_reminder_plans(subject_reference, status, next_due_date);

CREATE TABLE IF NOT EXISTS subscription_projections (
  subscription_reference TEXT PRIMARY KEY,
  subject_reference TEXT NOT NULL,
  provider TEXT NOT NULL,
  merchant_name TEXT NOT NULL,
  category TEXT,
  expected_amount TEXT,
  currency TEXT,
  cadence TEXT,
  next_expected_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('observed','cancelled','ended','uncertain')),
  observed_at TEXT NOT NULL,
  UNIQUE(subject_reference, provider, subscription_reference),
  FOREIGN KEY (subject_reference) REFERENCES subject_profiles(subject_reference)
);
CREATE INDEX IF NOT EXISTS subscription_subject_idx ON subscription_projections(subject_reference, status, next_expected_at);


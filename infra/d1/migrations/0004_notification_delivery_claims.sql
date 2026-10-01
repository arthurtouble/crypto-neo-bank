-- A delivery run claims a notice before it emails or pushes it (apps/web/src/lib/notifications/deliver.ts), so two runs
-- that overlap (the cron and a request's background delivery) never send it twice. A claim lapses on its own if the run
-- that took it stops, and the next run retries the notice.
ALTER TABLE notifications ADD COLUMN delivery_claimed_until TEXT;

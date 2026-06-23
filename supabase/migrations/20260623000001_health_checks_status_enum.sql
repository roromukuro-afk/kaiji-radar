-- health_checks.status が 'key_missing' / 'checking' を受け付けるよう CHECK 制約を拡張
ALTER TABLE health_checks
  DROP CONSTRAINT IF EXISTS health_checks_status_check;

ALTER TABLE health_checks
  ADD CONSTRAINT health_checks_status_check
    CHECK (status IN ('ok', 'failed', 'degraded', 'checking', 'key_missing'));

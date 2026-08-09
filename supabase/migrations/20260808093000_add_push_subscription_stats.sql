-- 端末別のPush通知成功・失敗を正確に追跡できるようにする。
-- 従来はnotification_history(記事×購読ごとのログ)はあったが、購読(端末)側に
-- 集計値がなく「どの端末が壊れているか」を一覧できなかった。
alter table push_subscriptions add column if not exists last_success_at timestamptz;
alter table push_subscriptions add column if not exists last_failure_at timestamptz;
alter table push_subscriptions add column if not exists consecutive_failures integer not null default 0;

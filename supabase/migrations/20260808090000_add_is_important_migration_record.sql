-- articles.is_important はマイグレーション履歴外で本番DBに直接追加されていた
-- (2026-08-08監査で確認)。実カラムと同一定義でIF NOT EXISTSにより安全に
-- マイグレーション履歴へ記録する(既存カラムがあれば no-op)。
alter table articles add column if not exists is_important boolean not null default false;
comment on column articles.is_important is '★重要バッジ表示用の二値フラグ。3段階のimportance列とは別軸(旧実装、後方互換のため維持)。';

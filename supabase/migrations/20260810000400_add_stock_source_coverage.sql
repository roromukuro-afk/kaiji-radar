-- 銘柄別情報源カバレッジ(新規実装5)。
-- 銘柄×情報源ごとに「設定済みか・最終確認・最終成功・連続失敗・直近エラー」を記録する。
-- 企業IRページ(stock_ir_sources)は既に同等の粒度で自前追跡しているため対象外とし、
-- 表示側(API/画面)で両テーブルを合成して「official」の状態として見せる。
create table if not exists stock_source_coverage (
  stock_id uuid not null references stocks(id) on delete cascade,
  source_type text not null,
  is_configured boolean not null default true,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (stock_id, source_type)
);
create index if not exists idx_stock_source_coverage_source on stock_source_coverage(source_type);

alter table stock_source_coverage enable row level security;
create policy "owner_only" on stock_source_coverage for all to authenticated using (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d') with check (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d');

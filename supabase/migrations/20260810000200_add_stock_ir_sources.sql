-- 企業IRページ直接監視(新規実装2)。
-- RSSを提供していない企業のIR/ニュース一覧ページを巡回対象として登録する。
-- known_urlsは前回巡回で確認できた全リンクを保持し、次回巡回時の新着差分判定に使う。
create table if not exists stock_ir_sources (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references stocks(id) on delete cascade,
  url text not null,
  enabled boolean not null default false,
  known_urls text[] not null default '{}',
  last_checked_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stock_id, url)
);
create index if not exists idx_stock_ir_sources_stock on stock_ir_sources(stock_id);
create index if not exists idx_stock_ir_sources_enabled on stock_ir_sources(enabled) where enabled = true;

alter table stock_ir_sources enable row level security;
create policy "owner_only" on stock_ir_sources for all to authenticated using (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d') with check (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d');

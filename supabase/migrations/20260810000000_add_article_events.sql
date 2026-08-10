-- 同一事象の記事統合(新規実装1)。
-- 同じ決算・提携・訂正等を1つの「出来事」にまとめ、TDnet/EDINET/公式を代表記事に優先する。
create table if not exists article_events (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid references stocks(id) on delete cascade,
  event_type text,
  representative_article_id uuid references articles(id) on delete set null,
  title text not null,
  occurred_at timestamptz not null,
  member_count integer not null default 1,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_article_events_stock_occurred on article_events(stock_id, occurred_at desc);

-- is_event_representative: 既存16,873件は全てtrue(=grouping導入前と同じ「1記事1行」表示を維持)。
-- 新規にグループへ合流する非代表記事だけfalseになる。
alter table articles add column if not exists event_group_id uuid references article_events(id) on delete set null;
alter table articles add column if not exists is_event_representative boolean not null default true;
create index if not exists idx_articles_event_group on articles(event_group_id);

alter table article_events enable row level security;
create policy "owner_only" on article_events for all to authenticated using (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d') with check (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d');

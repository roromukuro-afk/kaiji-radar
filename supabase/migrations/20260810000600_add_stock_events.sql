-- 開示予定カレンダー(新規実装7)。
-- 決算・株主総会・配当基準日などの予定日を管理する。
-- statusはユーザーが明示的に設定する'scheduled'/'postponed'のみを保持し、
-- 「開示確認済み(linked_article_idが付いた)」「未確認(予定日を過ぎたが未リンク)」
-- は表示側で導出する(二重管理を避けるため)。
create table if not exists stock_events (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references stocks(id) on delete cascade,
  event_type text not null check (event_type in ('earnings', 'agm', 'dividend_record', 'other')),
  title text not null,
  scheduled_date date not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'postponed')),
  linked_article_id uuid references articles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_stock_events_scheduled_date on stock_events(scheduled_date);
create index if not exists idx_stock_events_stock on stock_events(stock_id);

alter table stock_events enable row level security;
create policy "owner_only" on stock_events for all to authenticated using (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d') with check (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d');

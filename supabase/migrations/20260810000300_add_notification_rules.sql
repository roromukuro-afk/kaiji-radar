-- 詳細な通知ルール(新規実装3)。
-- 銘柄・重要度・開示種別・情報源・キーワードを組み合わせた条件で、
-- 「即時通知/保存のみ(通知しない)/通知しない」を判定する。
-- 条件はすべてnull=指定なし(その条件では絞り込まない)。
-- priorityは数値が大きいほど優先。同点なら条件数が多い(より具体的な)方を優先する。
create table if not exists notification_rules (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid references stocks(id) on delete cascade,
  importance text,
  event_type text,
  source_type text,
  keyword text,
  action text not null check (action in ('notify', 'save_only', 'no_notify')),
  priority integer not null default 0,
  is_active boolean not null default true,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_notification_rules_stock on notification_rules(stock_id);
create index if not exists idx_notification_rules_active on notification_rules(is_active) where is_active = true;

alter table notification_rules enable row level security;
create policy "owner_only" on notification_rules for all to authenticated using (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d') with check (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d');

-- どのルールが適用された結果かを記事側にも記録する(通知判定の追跡・検証用)
alter table articles add column if not exists matched_notification_rule_id uuid references notification_rules(id) on delete set null;

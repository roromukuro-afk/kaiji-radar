-- 全情報源の自動取りこぼし回収(新規実装6)。
-- ソースごとに独立した「最終成功時刻」を記録し、特定のソースだけが
-- 連続失敗した場合でもそのソース分だけ遡及取得できるようにする。
create table if not exists source_checkpoints (
  source_type text primary key,
  last_success_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table source_checkpoints enable row level security;
create policy "owner_only" on source_checkpoints for all to authenticated using (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d') with check (auth.uid() = '2852ba86-9fbe-49fe-ae97-06f50d463e5d');

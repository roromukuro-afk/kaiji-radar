-- 本番DBの実スキーマとマイグレーション適用履歴を取得するための診断用関数。
-- supabase_migrations.schema_migrations はPostgRESTに公開されていない内部
-- スキーマのため、SECURITY DEFINER関数経由で読み取る(新規テーブル追加ではない)。
-- 用途: scripts/check-migration-drift.ts (マイグレーションとDBの差分検出)
create or replace function public.get_schema_diagnostics()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'migrations', (
      select coalesce(jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version), '[]'::jsonb)
      from supabase_migrations.schema_migrations
    ),
    'columns', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', table_name, 'column', column_name, 'type', data_type, 'nullable', is_nullable
      ) order by table_name, ordinal_position), '[]'::jsonb)
      from information_schema.columns
      where table_schema = 'public'
    ),
    'tables', (
      select coalesce(jsonb_agg(table_name order by table_name), '[]'::jsonb)
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    )
  );
$$;

revoke all on function public.get_schema_diagnostics() from public;
grant execute on function public.get_schema_diagnostics() to service_role;

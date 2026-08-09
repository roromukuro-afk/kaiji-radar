-- 単一ユーザーアプリのRLSを「認証済みなら誰でも」から「自分のAuth UIDのみ」へ強化。
-- これまではALLOWED_EMAILチェックがアプリ層のみで、DBレイヤーでは認証済み
-- Supabaseユーザーなら誰でも読み書き可能だった(2026-08-08監査で確認)。
-- UIDは roromukuro@gmail.com の唯一の auth.users レコードから採取。
-- workers/*.tsはservice roleキーを使うためRLSの影響を受けず、この変更後も
-- 通常どおり動作する。

do $$
declare
  owner_uid constant uuid := '2852ba86-9fbe-49fe-ae97-06f50d463e5d';
  t text;
begin
  for t in
    select unnest(array[
      'article_stocks','article_updates','articles','backup_logs','exclusion_logs',
      'fetch_jobs','health_checks','noise_rules','notification_history','operation_logs',
      'pdf_documents','push_subscriptions','relevance_feedback','stock_profiles','stocks',
      'system_settings'
    ])
  loop
    execute format('drop policy if exists "authenticated_all" on %I', t);
    execute format(
      'create policy "owner_only" on %I for all to authenticated using (auth.uid() = %L) with check (auth.uid() = %L)',
      t, owner_uid, owner_uid
    );
  end loop;
end $$;

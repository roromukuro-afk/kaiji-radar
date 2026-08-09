-- 2026-08-08監査で確認された未使用テーブルの削除。
-- いずれもコード参照0件・実データ0件を確認済み(relevance_rules/excluded_patterns/
-- stock_profile_historyは元々未使用、stock_keyword_rulesは本セッションでnoise_rulesへ
-- 書き込み・読み込みとも一本化したため不要になった)。
drop table if exists relevance_rules;
drop table if exists excluded_patterns;
drop table if exists stock_profile_history;
drop table if exists stock_keyword_rules;

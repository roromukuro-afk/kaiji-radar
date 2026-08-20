-- SEC EDGAR(米国株の一次情報。TDnet/EDINETの米国版)対応。
-- CIK(Central Index Key)を保持する銘柄のみが取得対象になる。
alter table stocks add column if not exists cik text;

alter table articles drop constraint if exists articles_source_type_check;
alter table articles add constraint articles_source_type_check
  check (source_type = any (array['tdnet','edinet','official','pr_times','jp_news','en_news','sec_edgar']));

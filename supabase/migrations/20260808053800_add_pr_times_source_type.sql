-- PR TIMES を安全ソース(official)から分離し、独立したsource_typeにする。
-- PR TIMESは企業自身が検証したIR情報ではなく誰でも投稿できるプレスリリース配信
-- プラットフォームのため、TDnet/EDINET/企業公式RSSと同じ「絶対に除外しない」扱いは誤り。
alter table articles drop constraint articles_source_type_check;
alter table articles add constraint articles_source_type_check
  check (source_type = any (array['tdnet','edinet','official','pr_times','jp_news','en_news']));

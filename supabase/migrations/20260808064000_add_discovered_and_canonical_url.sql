-- Google Newsのリダイレクトリンクをそのまま source_url に保存していたため、
-- ドメイン除外・有料記事判定が news.google.com に対して働いてしまっていた問題への対応。
-- discovered_url: 最初に見つかった生のリンク(Google Newsのリダイレクトリンク等)
-- canonical_url : トラッキングパラメータ等を除去した正規化URL。重複判定に使用。
alter table articles add column if not exists discovered_url text;
alter table articles add column if not exists canonical_url text;
create index if not exists idx_articles_canonical_url on articles (canonical_url);
comment on column articles.discovered_url is 'RSS等で最初に見つかった生のリンク(Google Newsのリダイレクトリンク等)。source_urlが実記事URLに解決された場合の記録用。';
comment on column articles.canonical_url is 'トラッキングパラメータ等を除去して正規化したURL。異なるトークン/パラメータ違いの同一記事を重複判定するために使用。';

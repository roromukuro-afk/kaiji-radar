-- 代表記事が既に安全ソース(TDnet/EDINET/公式)かどうかを保持し、
-- 昇格判定のたびにarticlesへ問い合わせずに済むようにする。
alter table article_events add column if not exists representative_is_safe_source boolean not null default false;

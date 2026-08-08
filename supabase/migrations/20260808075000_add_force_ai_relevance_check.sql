-- 球団・チーム名と社名が同一の銘柄(ソフトバンク/オリックス等)向けのノイズ対策。
-- quickKeywordMatchは銘柄名(例:「ソフトバンク」)の完全一致だけでrelevance=certainに
-- してしまい、AIによる「同名の別会社/無関係な話題」判定をスキップしてしまう。
-- その結果、除外キーワードルールでカバーしきれない見出しパターン(選手名+成績等、
-- 「ホークス」等のトリガー語を含まない野球ニュース)が通知として漏れていた。
alter table stock_profiles add column if not exists force_ai_relevance_check boolean not null default false;
comment on column stock_profiles.force_ai_relevance_check is 'trueの場合、銘柄名の完全一致(quickKeywordMatch)だけでrelevance=certainにせず、必ずAI(checkRelevance)で判定する。球団・チーム名と社名が同じ銘柄(ソフトバンク/オリックス等)のノイズ対策。';

update stock_profiles sp
set force_ai_relevance_check = true
from stocks s
where sp.stock_id = s.id and s.code in ('9434','9984','8591');

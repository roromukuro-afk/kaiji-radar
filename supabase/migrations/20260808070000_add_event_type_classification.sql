-- 開示種別による自動分類(要約ではなく機械的分類)
alter table articles add column if not exists event_type text
  check (event_type in (
    'earnings','guidance_revision','dividend','treasury_stock',
    'ma_tob','alliance','personnel','agm','legal_regulatory',
    'product_service','other'
  ));
create index if not exists idx_articles_event_type on articles (event_type);

-- 銘柄別: 通知する開示種別 (null = 全種別を通知、現状の挙動を維持)
alter table stock_profiles add column if not exists notify_event_types jsonb;

comment on column articles.event_type is '要約ではなく機械的な開示種別分類。TDnet文書種別・EDINETコード・タイトル規則による。投資判断の評価ではない。';
comment on column stock_profiles.notify_event_types is 'この銘柄で通知する開示種別のリスト。nullなら全種別を通知(既定動作)。';

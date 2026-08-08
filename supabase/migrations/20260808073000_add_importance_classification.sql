-- 重要度分類 (3段階: 最重要/重要/通常)。開示種別・内容規則による客観分類であり、
-- 投資判断や自動要約ではない。
alter table articles add column if not exists importance text
  check (importance in ('critical','important','normal')) default 'normal';
alter table articles add column if not exists importance_reason text;
alter table articles add column if not exists importance_source text
  check (importance_source in ('rule','ai','manual'));
alter table articles add column if not exists importance_overridden_at timestamptz;

create index if not exists idx_articles_importance on articles (importance);

comment on column articles.importance is '重要度3段階(critical=最重要/important=重要/normal=通常)。開示種別・内容規則による客観分類。投資判断ではない。';
comment on column articles.importance_reason is '重要度判定の根拠(どの規則/AI判定に一致したか)';
comment on column articles.importance_source is '判定方法: rule(規則) / ai(AI補助判定) / manual(手動上書き)';
comment on column articles.importance_overridden_at is '手動で重要度を上書きした日時';

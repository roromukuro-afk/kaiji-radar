-- 開示レーダー Database Schema
-- Supabase (PostgreSQL)

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================
-- stocks
-- ============================
CREATE TABLE IF NOT EXISTS stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,          -- 4桁コード e.g. "6758"
  name TEXT NOT NULL,                  -- 正式会社名
  name_short TEXT,                     -- 株式会社を除いた略称
  name_en TEXT,                        -- 英語社名
  edinet_code TEXT,                    -- EDINETコード e.g. "E00001"
  sec_code TEXT,                       -- 5桁コード e.g. "67580"
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'removed', 'deleted')),
  removed_at TIMESTAMPTZ,
  removed_type TEXT
    CHECK (removed_type IN ('remove_from_list', 'full_delete', NULL)),
  initial_fetch_completed BOOLEAN NOT NULL DEFAULT FALSE,
  initial_fetch_completed_at TIMESTAMPTZ,
  initial_fetch_summary JSONB,         -- 取得件数サマリー
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- stock_profiles
-- ============================
CREATE TABLE IF NOT EXISTS stock_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  exchange TEXT,                           -- 上場市場 e.g. "東証プライム"
  sector TEXT,                             -- 業種
  official_url TEXT,
  ir_url TEXT,
  news_url TEXT,
  press_release_url TEXT,
  rss_urls JSONB NOT NULL DEFAULT '[]',
  main_business TEXT,
  main_products JSONB NOT NULL DEFAULT '[]',
  brand_names JSONB NOT NULL DEFAULT '[]',
  service_names JSONB NOT NULL DEFAULT '[]',
  subsidiaries JSONB NOT NULL DEFAULT '[]',
  affiliated_companies JSONB NOT NULL DEFAULT '[]',
  overseas_subsidiaries JSONB NOT NULL DEFAULT '[]',
  major_customers JSONB NOT NULL DEFAULT '[]',
  major_partners JSONB NOT NULL DEFAULT '[]',
  major_competitors JSONB NOT NULL DEFAULT '[]',
  ceo_name TEXT,
  former_names JSONB NOT NULL DEFAULT '[]',
  jp_keywords JSONB NOT NULL DEFAULT '[]',
  en_keywords JSONB NOT NULL DEFAULT '[]',
  source_urls JSONB NOT NULL DEFAULT '[]',  -- 情報根拠URL
  notify_event_types JSONB,  -- 通知する開示種別リスト (null = 全種別を通知)
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stock_id)
);

-- ============================
-- stock_profile_history
-- ============================
CREATE TABLE IF NOT EXISTS stock_profile_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  changed_fields JSONB NOT NULL DEFAULT '{}',
  previous_values JSONB NOT NULL DEFAULT '{}',
  new_values JSONB NOT NULL DEFAULT '{}',
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- articles (全情報ソース共通)
-- ============================
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ソース種別
  source_type TEXT NOT NULL
    CHECK (source_type IN ('tdnet', 'edinet', 'official', 'pr_times', 'jp_news', 'en_news')),
  source_url TEXT NOT NULL,
  discovered_url TEXT,   -- RSS等で最初に見つかった生のリンク(Google Newsのリダイレクトリンク等)
  canonical_url TEXT,    -- トラッキングパラメータ等を除去した正規化URL(重複判定用)

  -- TDnet固有
  tdnet_doc_id TEXT,

  -- EDINET固有
  edinet_doc_id TEXT,
  edinet_submitter_code TEXT,
  edinet_doc_type_code TEXT,

  -- メタデータ
  title TEXT NOT NULL,
  title_ja TEXT,                        -- 英語記事の日本語仮訳タイトル
  publisher TEXT,                       -- 媒体名・提出者名
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- コンテンツ
  summary TEXT,
  body_text TEXT,
  is_paywalled BOOLEAN NOT NULL DEFAULT FALSE,

  -- 分類
  relevance TEXT NOT NULL DEFAULT 'certain'
    CHECK (relevance IN ('certain', 'uncertain', 'irrelevant')),
  relevance_reason TEXT,

  -- フラグ
  is_update BOOLEAN NOT NULL DEFAULT FALSE,
  update_of_id UUID REFERENCES articles(id),
  is_overseas BOOLEAN NOT NULL DEFAULT FALSE,
  is_pdf BOOLEAN NOT NULL DEFAULT FALSE,
  doc_type TEXT,
  is_important BOOLEAN NOT NULL DEFAULT FALSE,  -- TDnet/EDINET/公式、または重要開示キーワード一致(客観分類、投資判断ではない)
  event_type TEXT
    CHECK (event_type IN (
      'earnings','guidance_revision','dividend','treasury_stock',
      'ma_tob','alliance','personnel','agm','legal_regulatory',
      'product_service','other'
    )),  -- 機械的な開示種別分類(要約ではない)
  importance TEXT DEFAULT 'normal'
    CHECK (importance IN ('critical','important','normal')),  -- 重要度3段階(客観分類、投資判断ではない)
  importance_reason TEXT,
  importance_source TEXT CHECK (importance_source IN ('rule','ai','manual')),
  importance_overridden_at TIMESTAMPTZ,

  -- PDF
  pdf_document_id UUID,

  -- 既読
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,

  -- 通知
  notification_sent BOOLEAN NOT NULL DEFAULT FALSE,
  notification_sent_at TIMESTAMPTZ,
  notification_failed_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 重複防止 (部分ユニークインデックスで実装、NULL は許容)
  CONSTRAINT articles_source_url_unique UNIQUE (source_url)
);

-- ============================
-- article_stocks (記事と銘柄の紐付け)
-- ============================
CREATE TABLE IF NOT EXISTS article_stocks (
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  stock_id UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, stock_id)
);

-- ============================
-- article_updates (記事内容の変更履歴)
-- ============================
CREATE TABLE IF NOT EXISTS article_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  previous_title TEXT,
  new_title TEXT,
  previous_body TEXT,
  new_body TEXT,
  change_type TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- pdf_documents
-- ============================
CREATE TABLE IF NOT EXISTS pdf_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  storage_path TEXT,
  file_hash TEXT,
  file_size_bytes INTEGER,
  extracted_text TEXT,
  ocr_text TEXT,
  extraction_method TEXT CHECK (extraction_method IN ('pdfparse', 'ocr', 'failed', NULL)),
  ocr_quality TEXT CHECK (ocr_quality IN ('good', 'poor', NULL)),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- push_subscriptions
-- ============================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- notification_history
-- ============================
CREATE TABLE IF NOT EXISTS notification_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- health_checks
-- ============================
CREATE TABLE IF NOT EXISTS health_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'degraded')),
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source)
);

-- ============================
-- fetch_jobs
-- ============================
CREATE TABLE IF NOT EXISTS fetch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL CHECK (job_type IN ('hourly', 'manual', 'initial', 'backfill')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  articles_found INTEGER NOT NULL DEFAULT 0,
  articles_saved INTEGER NOT NULL DEFAULT 0,
  tdnet_count INTEGER NOT NULL DEFAULT 0,
  edinet_count INTEGER NOT NULL DEFAULT 0,
  official_count INTEGER NOT NULL DEFAULT 0,
  jp_news_count INTEGER NOT NULL DEFAULT 0,
  en_news_count INTEGER NOT NULL DEFAULT 0,
  source_results JSONB NOT NULL DEFAULT '{}',
  error_message TEXT
);

-- ============================
-- operation_logs
-- ============================
CREATE TABLE IF NOT EXISTS operation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  target_id TEXT,
  target_name TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  result TEXT CHECK (result IN ('success', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- backup_logs
-- ============================
CREATE TABLE IF NOT EXISTS backup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  storage_path TEXT,
  file_size_bytes BIGINT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- ============================
-- exclusion_logs (無関係除外記録)
-- ============================
CREATE TABLE IF NOT EXISTS exclusion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL,
  title TEXT,
  source_type TEXT,
  related_stock_code TEXT,
  exclusion_reason TEXT NOT NULL,
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- system_settings
-- ============================
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- INDEXES
-- ============================
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source_type ON articles(source_type);
CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read);
CREATE INDEX IF NOT EXISTS idx_articles_notification_sent ON articles(notification_sent);
CREATE INDEX IF NOT EXISTS idx_articles_source_url ON articles(source_url);
-- 部分ユニークインデックス: NULL は重複チェック対象外
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_unique_tdnet_doc_id ON articles(tdnet_doc_id) WHERE tdnet_doc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_unique_edinet_doc_id ON articles(edinet_doc_id) WHERE edinet_doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articles_tdnet_doc_id ON articles(tdnet_doc_id);
CREATE INDEX IF NOT EXISTS idx_articles_edinet_doc_id ON articles(edinet_doc_id);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_article_stocks_stock_id ON article_stocks(stock_id);
CREATE INDEX IF NOT EXISTS idx_article_stocks_article_id ON article_stocks(article_id);

CREATE INDEX IF NOT EXISTS idx_health_checks_source ON health_checks(source);
CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at ON operation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_jobs_started_at ON fetch_jobs(started_at DESC);

-- Full-text search (trigram for ILIKE support)
CREATE INDEX IF NOT EXISTS idx_articles_title_trgm ON articles USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_articles_body_trgm ON articles USING GIN (body_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_articles_summary_trgm ON articles USING GIN (summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_articles_publisher_trgm ON articles USING GIN (publisher gin_trgm_ops);

-- ============================
-- ROW LEVEL SECURITY
-- ============================
ALTER TABLE stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_profile_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE fetch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE exclusion_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Authenticated user (single user app) can read/write all
CREATE POLICY "authenticated_all" ON stocks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON stock_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON stock_profile_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON articles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON article_stocks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON article_updates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON pdf_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON push_subscriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON notification_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON health_checks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON fetch_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON operation_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON backup_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON exclusion_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON system_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Service role bypasses RLS (used by workers)
-- (Supabase service_role already bypasses RLS by default)

-- ============================
-- INITIAL DATA
-- ============================
INSERT INTO system_settings (key, value) VALUES
  ('vapid_contact', '"mailto:roromukuro@gmail.com"'),
  ('app_version', '"1.0.0"'),
  ('last_hourly_run', 'null'),
  ('storage_warning_threshold_gb', '0.8'),
  ('monthly_cost_warning_jpy', '1500')
ON CONFLICT (key) DO NOTHING;

-- Initial health check rows
INSERT INTO health_checks (source, status) VALUES
  ('tdnet', 'ok'),
  ('edinet', 'ok'),
  ('official', 'ok'),
  ('jp_news', 'ok'),
  ('en_news', 'ok'),
  ('push', 'ok'),
  ('email', 'ok'),
  ('storage', 'ok'),
  ('backup', 'ok'),
  ('database', 'ok')
ON CONFLICT (source) DO NOTHING;

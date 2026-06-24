-- 学習・除外ルールシステムのテーブル追加
-- 関連性フィードバック / ルール / 除外パターン / キーワードルール

-- ============================
-- relevance_feedback
-- ============================
CREATE TABLE IF NOT EXISTS relevance_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  stock_id UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN (
    'relevant', 'uncertain', 'irrelevant',
    'weaken_domain', 'exclude_keyword', 'add_keyword', 'different_company', 'cancel'
  )),
  target_keyword TEXT,
  target_domain TEXT,
  target_url TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT 'user',
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  applied_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- ============================
-- relevance_rules
-- ============================
CREATE TABLE IF NOT EXISTS relevance_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'exclude_keyword', 'add_keyword', 'weaken_domain', 'exclude_domain',
    'different_company_domain', 'different_company_keyword'
  )),
  target TEXT NOT NULL,
  confirmation_count INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stock_id, rule_type, target)
);

-- ============================
-- excluded_patterns
-- ============================
CREATE TABLE IF NOT EXISTS excluded_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID REFERENCES stocks(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('domain', 'url_prefix', 'title_keyword')),
  pattern TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('exclude', 'weaken', 'candidate')),
  confirmation_count INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT 'user'
);

-- ============================
-- stock_keyword_rules
-- ============================
CREATE TABLE IF NOT EXISTS stock_keyword_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('ja', 'en')),
  action TEXT NOT NULL CHECK (action IN ('add', 'remove', 'strengthen', 'weaken')),
  confirmation_count INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT 'user',
  UNIQUE (stock_id, keyword, language, action)
);

-- ============================
-- articles テーブルに列追加
-- ============================
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS user_relevance TEXT
    CHECK (user_relevance IN ('relevant', 'uncertain', 'irrelevant', 'different_company')),
  ADD COLUMN IF NOT EXISTS exclusion_reason TEXT,
  ADD COLUMN IF NOT EXISTS exclusion_candidate BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================
-- インデックス
-- ============================
CREATE INDEX IF NOT EXISTS idx_relevance_feedback_article  ON relevance_feedback(article_id);
CREATE INDEX IF NOT EXISTS idx_relevance_feedback_stock    ON relevance_feedback(stock_id);
CREATE INDEX IF NOT EXISTS idx_relevance_rules_stock       ON relevance_rules(stock_id, active);
CREATE INDEX IF NOT EXISTS idx_stock_keyword_rules_stock   ON stock_keyword_rules(stock_id, active);
CREATE INDEX IF NOT EXISTS idx_articles_user_relevance     ON articles(user_relevance);
CREATE INDEX IF NOT EXISTS idx_articles_excl_candidate     ON articles(exclusion_candidate);

-- ============================
-- RLS
-- ============================
ALTER TABLE relevance_feedback    ENABLE ROW LEVEL SECURITY;
ALTER TABLE relevance_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE excluded_patterns     ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_keyword_rules   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON relevance_feedback  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON relevance_rules     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON excluded_patterns   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON stock_keyword_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);

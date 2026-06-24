-- Phase 3.2: Noise Rules System
-- 自然文ノイズ学習・銘柄別除外ルール強化

-- ============================
-- Fix existing tables
-- ============================

-- stock_keyword_rules: worker uses is_active but column was named active
DO $$ BEGIN
  ALTER TABLE stock_keyword_rules ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
  UPDATE stock_keyword_rules SET is_active = COALESCE(active, TRUE);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- relevance_feedback: add user_id column that API tries to insert
ALTER TABLE relevance_feedback ADD COLUMN IF NOT EXISTS user_id UUID;

-- ============================
-- noise_rules
-- ============================
-- Comprehensive noise/signal rule system.
-- Each row is one pattern that matches articles as noise or signal.
CREATE TABLE IF NOT EXISTS noise_rules (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Targeting: stock_id NULL = scope must be all_stocks
  stock_id    UUID    REFERENCES stocks(id) ON DELETE CASCADE,
  scope       TEXT    NOT NULL DEFAULT 'this_stock'
                CHECK (scope IN ('this_stock', 'all_stocks')),

  -- Rule identity
  rule_name   TEXT,
  rule_type   TEXT    NOT NULL
                CHECK (rule_type IN (
                  'exclude_candidate',  -- noise: keep in DB, no push notify
                  'block_notify',       -- alias for exclude_candidate (stronger label)
                  'weaken_source',      -- lower source weight
                  'strengthen',         -- keyword = definitely relevant
                  'different_company'   -- same name, different company
                )),
  match_type  TEXT    NOT NULL
                CHECK (match_type IN (
                  'keyword',      -- substring in title + summary
                  'domain',       -- substring in URL (domain)
                  'url_pattern',  -- substring anywhere in URL
                  'publisher',    -- match publisher field
                  'source_type'   -- match source_type column value
                )),
  match_value TEXT    NOT NULL,
  language    TEXT    NOT NULL DEFAULT 'any'
                CHECK (language IN ('ja', 'en', 'any')),

  -- Behavior
  auto_apply  BOOLEAN NOT NULL DEFAULT TRUE,

  -- Metadata
  reason      TEXT,
  created_by  TEXT    NOT NULL DEFAULT 'claude',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,

  -- Stats (updated by worker + reclassify script)
  apply_count      INTEGER   NOT NULL DEFAULT 0,
  last_applied_at  TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_noise_rules_stock_active ON noise_rules(stock_id, is_active);
CREATE INDEX IF NOT EXISTS idx_noise_rules_scope_active ON noise_rules(scope, is_active);
CREATE INDEX IF NOT EXISTS idx_noise_rules_type        ON noise_rules(rule_type, is_active);

ALTER TABLE noise_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON noise_rules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

#!/usr/bin/env tsx
/**
 * add-noise-rule.ts — ノイズルール追加 CLI
 *
 * 使い方:
 *   npx tsx scripts/add-noise-rule.ts --stock 8591 --type exclude_candidate \
 *     --keywords "バファローズ,プロ野球,試合結果" \
 *     --reason "オリックス球団ニュースは投資情報ではない"
 *
 *   npx tsx scripts/add-noise-rule.ts --file rules.json   # JSON一括投入
 *
 * 環境変数 (scripts/.env.local または ../.env.local を自動ロード):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local
function loadEnv() {
  for (const envFile of ["scripts/.env.local", ".env.local"]) {
    try {
      const content = readFileSync(resolve(process.cwd(), envFile), "utf-8");
      for (const line of content.split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      break;
    } catch { /* ignore */ }
  }
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// =====================
// Types
// =====================
interface RuleInput {
  stock_code?: string;       // e.g. "8591" — omit for all_stocks
  rule_name?: string;
  rule_type?: "exclude_candidate" | "block_notify" | "weaken_source" | "strengthen" | "different_company";
  keywords?: string[];       // keyword match rules
  domains?: string[];        // domain match rules
  publishers?: string[];     // publisher match rules
  url_patterns?: string[];   // URL pattern rules
  reason?: string;
  scope?: "this_stock" | "all_stocks";
  language?: "ja" | "en" | "any";
  notification?: boolean;    // false = exclude_candidate; true = strengthen
  dry_run?: boolean;
}

// =====================
// Helpers
// =====================
function parseArgs(): { values: Record<string, string | boolean>; file?: string } {
  const args = process.argv.slice(2);
  const values: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        values[key] = true;
      } else {
        values[key] = next;
        i++;
      }
    }
  }
  return { values, file: values.file as string | undefined };
}

async function findStock(code: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from("stocks")
    .select("id, name")
    .eq("code", code)
    .single();
  return data ?? null;
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

// Safe source types — never excluded regardless of rules
const SAFE_SOURCE_TYPES = new Set(["tdnet", "edinet", "official"]);

function matchesRule(
  matchType: string,
  matchValue: string,
  title: string,
  summary: string | null,
  url: string,
  publisher: string | null
): boolean {
  const text = (title + " " + (summary ?? "")).toLowerCase();
  const mv = matchValue.toLowerCase();
  switch (matchType) {
    case "keyword":    return text.includes(mv);
    case "domain":     return extractDomain(url).includes(mv);
    case "url_pattern":return url.toLowerCase().includes(mv);
    case "publisher":  return (publisher ?? "").toLowerCase().includes(mv);
    default:           return false;
  }
}

// =====================
// Core: add rules
// =====================
async function addRules(input: RuleInput): Promise<void> {
  const { dry_run = false } = input;
  const ruleType = input.rule_type ?? "exclude_candidate";
  const scope = input.scope ?? (input.stock_code ? "this_stock" : "all_stocks");
  const language = input.language ?? "any";
  const reason = input.reason ?? "";

  // Resolve stock_id
  let stockId: string | null = null;
  let stockName = "";
  if (input.stock_code && scope !== "all_stocks") {
    const stock = await findStock(input.stock_code);
    if (!stock) {
      console.error(`[error] 銘柄コード ${input.stock_code} が見つかりません`);
      process.exit(1);
    }
    stockId = stock.id;
    stockName = stock.name;
    console.log(`[info] 対象銘柄: ${input.stock_code} ${stockName}`);
  } else {
    console.log("[info] 対象: 全銘柄 (all_stocks)");
  }

  // Build rule rows
  const rows: {
    stock_id: string | null;
    scope: string;
    rule_name: string | null;
    rule_type: string;
    match_type: string;
    match_value: string;
    language: string;
    reason: string;
    created_by: string;
  }[] = [];

  const addRow = (matchType: string, matchValue: string) => {
    rows.push({
      stock_id: stockId,
      scope,
      rule_name: input.rule_name ?? null,
      rule_type: ruleType,
      match_type: matchType,
      match_value: matchValue,
      language,
      reason,
      created_by: "claude",
    });
  };

  for (const kw of input.keywords ?? []) addRow("keyword", kw);
  for (const d  of input.domains   ?? []) addRow("domain",  d);
  for (const p  of input.publishers ?? []) addRow("publisher", p);
  for (const u  of input.url_patterns ?? []) addRow("url_pattern", u);

  if (rows.length === 0) {
    console.error("[error] ルール条件が1件もありません。--keywords, --domains, --publishers, --url_patterns のいずれかを指定してください");
    process.exit(1);
  }

  console.log(`\n[info] 追加予定ルール: ${rows.length} 件`);
  for (const r of rows) {
    console.log(`  [${r.rule_type}] ${r.match_type} = "${r.match_value}"`);
  }

  // Duplicate check
  let dupeCount = 0;
  const newRows: typeof rows = [];
  for (const row of rows) {
    const query = supabase
      .from("noise_rules")
      .select("id")
      .eq("rule_type", row.rule_type)
      .eq("match_type", row.match_type)
      .eq("match_value", row.match_value)
      .eq("scope", row.scope);

    if (row.stock_id) {
      query.eq("stock_id", row.stock_id);
    } else {
      query.is("stock_id", null);
    }

    const { data: existing } = await query;
    if (existing && existing.length > 0) {
      console.log(`  [skip] 重複: ${row.match_type}="${row.match_value}" は既に登録済み`);
      dupeCount++;
    } else {
      newRows.push(row);
    }
  }

  if (newRows.length === 0) {
    console.log("\n[info] 新規ルールなし (全て重複)");
    return;
  }

  if (dry_run) {
    console.log(`\n[dry-run] ${newRows.length} 件を登録する予定 (実行なし)`);
    return;
  }

  // Insert
  const { data: inserted, error } = await supabase
    .from("noise_rules")
    .insert(newRows)
    .select("id, match_type, match_value");

  if (error) {
    console.error("[error] ルール登録失敗:", error.message);
    process.exit(1);
  }

  console.log(`\n[success] ${inserted?.length ?? 0} 件登録完了 (${dupeCount} 件スキップ)`);

  // Log to operation_logs
  await supabase.from("operation_logs").insert({
    action: "add_noise_rule",
    result: "success",
    details: {
      stock_code: input.stock_code ?? "all",
      stock_id: stockId,
      rule_type: ruleType,
      inserted_count: inserted?.length ?? 0,
      skipped_count: dupeCount,
      reason,
    },
  });

  // Reclassify existing articles if stock is specified
  if (stockId && inserted && inserted.length > 0) {
    await reclassifyForStock(stockId, stockName, inserted);
  } else if (!stockId && inserted && inserted.length > 0) {
    console.log("\n[info] all_stocks ルール: 再分類は --stock を指定して個別に実行してください");
  }
}

// =====================
// Reclassify
// =====================
async function reclassifyForStock(
  stockId: string,
  stockName: string,
  newRules: { id: string; match_type: string; match_value: string }[]
): Promise<void> {
  console.log(`\n[reclassify] ${stockName} の既存記事を再分類中…`);

  // Fetch all articles linked to this stock (excluding safe sources)
  const { data: linked } = await supabase
    .from("article_stocks")
    .select(`
      article_id,
      articles!inner (
        id, title, summary, source_url, publisher, source_type,
        exclusion_candidate, user_relevance
      )
    `)
    .eq("stock_id", stockId);

  if (!linked || linked.length === 0) {
    console.log("[reclassify] 対象記事なし");
    return;
  }

  const articles = (linked as unknown as { articles: {
    id: string;
    title: string;
    summary: string | null;
    source_url: string;
    publisher: string | null;
    source_type: string;
    exclusion_candidate: boolean;
    user_relevance: string | null;
  } }[]).map((r) => r.articles);

  let matched = 0;
  let skipped = 0;

  for (const article of articles) {
    // Never touch safe sources
    if (SAFE_SOURCE_TYPES.has(article.source_type)) { skipped++; continue; }
    // Never override user-set 'relevant'
    if (article.user_relevance === "relevant") { skipped++; continue; }
    // Already excluded — skip (avoid double-counting)
    if (article.exclusion_candidate) { skipped++; continue; }

    let matchedRule: { match_type: string; match_value: string } | null = null;
    for (const rule of newRules) {
      if (matchesRule(rule.match_type, rule.match_value, article.title, article.summary, article.source_url, article.publisher)) {
        matchedRule = rule;
        break;
      }
    }

    if (matchedRule) {
      await supabase.from("articles").update({
        exclusion_candidate: true,
        exclusion_reason: `ノイズルール一致: ${matchedRule.match_type}="${matchedRule.match_value}"`,
      }).eq("id", article.id);
      matched++;
    }
  }

  // Update apply_count on rules
  for (const rule of newRules) {
    if (matched > 0) {
      await supabase.from("noise_rules")
        .update({ apply_count: matched, last_applied_at: new Date().toISOString() })
        .eq("id", rule.id);
    }
  }

  console.log(`[reclassify] 完了: スキャン=${articles.length} 除外候補に追加=${matched} スキップ=${skipped}`);
  if (matched > 0) {
    console.log(`  → ${matched} 件が除外候補タブに移動しました（通知対象から外れます）`);
  }
}

// =====================
// JSON batch mode
// =====================
async function runBatch(filePath: string): Promise<void> {
  const content = readFileSync(resolve(process.cwd(), filePath), "utf-8");
  const rules: RuleInput[] = JSON.parse(content);
  console.log(`[batch] ${rules.length} ルールセットを処理します`);
  for (const rule of rules) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`[batch] stock=${rule.stock_code ?? "all_stocks"} type=${rule.rule_type}`);
    await addRules(rule);
  }
}

// =====================
// Entry point
// =====================
async function main() {
  const { values, file } = parseArgs();

  if (file) {
    await runBatch(file);
    process.exit(0);
  }

  // Single rule from CLI args
  const keywords = values.keywords
    ? (values.keywords as string).split(",").map((k) => k.trim()).filter(Boolean)
    : [];
  const domains = values.domains
    ? (values.domains as string).split(",").map((d) => d.trim()).filter(Boolean)
    : [];
  const publishers = values.publishers
    ? (values.publishers as string).split(",").map((p) => p.trim()).filter(Boolean)
    : [];
  const urlPatterns = values["url-patterns"]
    ? (values["url-patterns"] as string).split(",").map((u) => u.trim()).filter(Boolean)
    : [];

  const input: RuleInput = {
    stock_code:   values.stock as string | undefined,
    rule_name:    values.name as string | undefined,
    rule_type:    values.type as RuleInput["rule_type"] ?? "exclude_candidate",
    keywords,
    domains,
    publishers,
    url_patterns: urlPatterns,
    reason:       values.reason as string | undefined,
    scope:        values.scope as RuleInput["scope"],
    language:     values.language as RuleInput["language"],
    notification: values.notification !== "false",
    dry_run:      values["dry-run"] === true || values.dry_run === true,
  };

  if (keywords.length + domains.length + publishers.length + urlPatterns.length === 0) {
    console.error("使い方: --keywords \"kw1,kw2\" または --domains \"domain.com\" または --publishers \"媒体名\"");
    process.exit(1);
  }

  await addRules(input);
}

main().catch((err) => { console.error(err); process.exit(1); });

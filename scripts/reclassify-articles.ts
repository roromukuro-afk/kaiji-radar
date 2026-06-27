#!/usr/bin/env tsx
/**
 * reclassify-articles.ts — 既存記事の再分類
 *
 * 使い方:
 *   npx tsx scripts/reclassify-articles.ts              # 全銘柄を再分類
 *   npx tsx scripts/reclassify-articles.ts --stock 8591 # 特定銘柄だけ
 *   npx tsx scripts/reclassify-articles.ts --rule <uuid> # 特定ルールだけ
 *   npx tsx scripts/reclassify-articles.ts --dry-run    # 影響件数確認のみ
 *   npx tsx scripts/reclassify-articles.ts --restore     # 除外候補を復元
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { isSafeSource, matchesProtection } from "../lib/noise/protection.js";

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

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

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

interface NoiseRule {
  id: string;
  stock_id: string | null;
  scope: string;
  rule_type: string;
  match_type: string;
  match_value: string;
  is_active: boolean;
}

interface ArticleRow {
  id: string;
  title: string;
  summary: string | null;
  source_url: string;
  publisher: string | null;
  source_type: string;
  exclusion_candidate: boolean;
  user_relevance: string | null;
  exclusion_reason: string | null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const v: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) { v[key] = true; }
    else { v[key] = next; i++; }
  }
  return v;
}

async function main() {
  const args = parseArgs();
  const dryRun = args["dry-run"] === true;
  const restore = args.restore === true;
  const filterStock = args.stock as string | undefined;
  const filterRule  = args.rule  as string | undefined;

  console.log(`[reclassify] 開始 ${dryRun ? "(dry-run)" : ""} ${restore ? "(復元モード)" : ""}`);

  // Load noise rules
  const rulesQuery = supabase
    .from("noise_rules")
    .select("id, stock_id, scope, rule_type, match_type, match_value, is_active")
    .eq("is_active", true);
  if (filterRule) rulesQuery.eq("id", filterRule);

  const { data: allRules } = await rulesQuery;
  const noiseRules: NoiseRule[] = allRules ?? [];

  // DB の strengthen ルール (= 追加の保護キーワード)
  const dbProtectKeywords = noiseRules
    .filter((r) => r.rule_type === "strengthen" && r.match_type === "keyword")
    .map((r) => r.match_value);
  console.log(`[reclassify] ノイズルール: ${noiseRules.length} 件ロード (保護KW DB${dbProtectKeywords.length})`);

  // Load stocks
  const stocksQuery = supabase.from("stocks").select("id, code, name").eq("status", "active");
  if (filterStock) stocksQuery.eq("code", filterStock);
  const { data: stocks } = await stocksQuery;

  if (!stocks || stocks.length === 0) {
    console.log("[reclassify] 対象銘柄なし");
    return;
  }

  let totalScanned = 0, totalMarked = 0, totalRestored = 0, totalSkipped = 0;
  const markedArticles: { id: string; title: string; reason: string }[] = [];
  const restoredArticles: { id: string; title: string }[] = [];

  for (const stock of stocks) {
    // Get rules applicable to this stock
    const stockRules = noiseRules.filter(
      (r) => r.scope === "all_stocks" || r.stock_id === stock.id
    );

    if (!restore && stockRules.length === 0) continue;

    // Fetch linked articles (paginate to avoid 1000-row Supabase default limit)
    const articles: ArticleRow[] = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data: linked } = await supabase
        .from("article_stocks")
        .select("article_id, articles!inner(id,title,summary,source_url,publisher,source_type,exclusion_candidate,user_relevance,exclusion_reason)")
        .eq("stock_id", stock.id)
        .range(offset, offset + PAGE - 1);
      if (!linked || linked.length === 0) break;
      articles.push(...(linked as unknown as { articles: ArticleRow }[]).map((r) => r.articles));
      if (linked.length < PAGE) break;
    }

    for (const article of articles) {
      totalScanned++;

      // Never touch safe sources (TDnet/EDINET/official)
      if (isSafeSource(article.source_type)) { totalSkipped++; continue; }

      if (restore) {
        // Restore mode: revert exclusion_candidate if it was set by a rule
        if (
          article.exclusion_candidate &&
          article.user_relevance !== "irrelevant" &&
          article.user_relevance !== "different_company" &&
          (article.exclusion_reason?.includes("ノイズルール") || article.exclusion_reason?.includes("除外キーワード"))
        ) {
          if (!dryRun) {
            await supabase.from("articles").update({
              exclusion_candidate: false,
              exclusion_reason: null,
            }).eq("id", article.id);
          }
          restoredArticles.push({ id: article.id, title: article.title.slice(0, 60) });
          totalRestored++;
        }
        continue;
      }

      // Mark mode
      // Never override user-set 'relevant'
      if (article.user_relevance === "relevant") { totalSkipped++; continue; }
      // Skip if already excluded (avoid overwriting user judgments)
      if (article.exclusion_candidate && article.user_relevance === "irrelevant") { totalSkipped++; continue; }
      // 保護キーワードがあればノイズ一致しても除外しない
      if (matchesProtection(article.title, article.summary, dbProtectKeywords)) { totalSkipped++; continue; }

      let matchedRule: NoiseRule | null = null;
      let matchReason = "";
      for (const rule of stockRules) {
        if (rule.rule_type === "strengthen") continue;
        if (matchesRule(rule.match_type, rule.match_value, article.title, article.summary, article.source_url, article.publisher)) {
          matchedRule = rule;
          matchReason = `ノイズルール一致: ${rule.match_type}="${rule.match_value}"`;
          break;
        }
      }

      if (matchedRule && !article.exclusion_candidate) {
        if (!dryRun) {
          await supabase.from("articles").update({
            exclusion_candidate: true,
            exclusion_reason: matchReason,
          }).eq("id", article.id);

          // Update rule apply_count
          await supabase.from("noise_rules")
            .update({ apply_count: (matchedRule as any).apply_count + 1, last_applied_at: new Date().toISOString() })
            .eq("id", matchedRule.id);
        }
        markedArticles.push({ id: article.id, title: article.title.slice(0, 60), reason: matchReason });
        totalMarked++;
      }
    }
  }

  // Report
  console.log(`\n[reclassify] 完了${dryRun ? " (dry-run)" : ""}:`);
  console.log(`  スキャン   : ${totalScanned} 件`);
  if (!restore) {
    console.log(`  除外候補追加: ${totalMarked} 件${dryRun ? " (予定)" : ""}`);
    console.log(`  スキップ   : ${totalSkipped} 件 (安全ソース・ユーザー判定済み)`);
    if (totalMarked > 0) {
      console.log("\n  除外候補になった記事:");
      for (const a of markedArticles.slice(0, 20)) {
        console.log(`    - ${a.title}`);
        console.log(`      理由: ${a.reason}`);
      }
      if (markedArticles.length > 20) console.log(`    ... 他 ${markedArticles.length - 20} 件`);
    }
  } else {
    console.log(`  復元       : ${totalRestored} 件${dryRun ? " (予定)" : ""}`);
    if (totalRestored > 0) {
      console.log("\n  復元された記事:");
      for (const a of restoredArticles.slice(0, 20)) {
        console.log(`    - ${a.title}`);
      }
    }
  }

  // Log
  if (!dryRun) {
    await supabase.from("operation_logs").insert({
      action: restore ? "reclassify_restore" : "reclassify_articles",
      result: "success",
      details: {
        scanned: totalScanned,
        marked: totalMarked,
        restored: totalRestored,
        skipped: totalSkipped,
        filter_stock: filterStock ?? "all",
        filter_rule: filterRule ?? "all",
      },
    });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

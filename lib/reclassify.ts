/**
 * ノイズルールによる既存記事の再分類ロジック (Phase 3.2)
 *
 * app/api/reclassify/route.ts (画面からの実行) と
 * scripts/reclassify-articles.ts (CLI) が共通で使う。
 * 2つの実装が食い違っていた(article_stocksのページング有無、
 * noise_rules.apply_countの更新方式)ため、ここに一本化する。
 */

import { isSafeSource, matchesProtection } from "./noise/protection";

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
  apply_count: number;
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

export interface ReclassifyOptions {
  stockId?: string;
  ruleId?: string;
  dryRun?: boolean;
  restore?: boolean;
}

export interface ReclassifyResult {
  scanned: number;
  marked: number;
  restored: number;
  skipped: number;
  markedArticles: { id: string; title: string; reason: string }[];
  restoredArticles: { id: string; title: string }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runReclassify(supabase: any, opts: ReclassifyOptions = {}): Promise<ReclassifyResult> {
  const { stockId, ruleId, dryRun = false, restore = false } = opts;

  const rulesQuery = supabase
    .from("noise_rules")
    .select("id, stock_id, scope, rule_type, match_type, match_value, apply_count")
    .eq("is_active", true);
  if (ruleId) rulesQuery.eq("id", ruleId);

  const { data: allRules } = await rulesQuery;
  const noiseRules: NoiseRule[] = allRules ?? [];

  const dbProtectKeywords = noiseRules
    .filter((r) => r.rule_type === "strengthen" && r.match_type === "keyword")
    .map((r) => r.match_value);

  let stockIds: string[];
  if (stockId) {
    stockIds = [stockId];
  } else {
    const { data: allStocks } = await supabase.from("stocks").select("id").eq("status", "active");
    stockIds = (allStocks ?? []).map((s: { id: string }) => s.id);
  }

  let totalScanned = 0, totalMarked = 0, totalRestored = 0, totalSkipped = 0;
  const markedArticles: { id: string; title: string; reason: string }[] = [];
  const restoredArticles: { id: string; title: string }[] = [];
  const ruleApplyDelta: Record<string, number> = {};

  for (const sid of stockIds) {
    const stockRules = noiseRules.filter((r) => r.scope === "all_stocks" || r.stock_id === sid);
    if (!restore && stockRules.length === 0) continue;

    // article_stocksはstock1件あたり1000件を超えることがあるため必ずページングする
    // (APIルート版はこれが抜けていて1000件超の銘柄を取りこぼしていた)
    const articles: ArticleRow[] = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data: linked } = await supabase
        .from("article_stocks")
        .select("article_id, articles!inner(id,title,summary,source_url,publisher,source_type,exclusion_candidate,user_relevance,exclusion_reason)")
        .eq("stock_id", sid)
        .range(offset, offset + PAGE - 1);
      if (!linked || linked.length === 0) break;
      articles.push(...(linked as unknown as { articles: ArticleRow }[]).map((r) => r.articles));
      if (linked.length < PAGE) break;
    }

    for (const article of articles) {
      totalScanned++;

      if (isSafeSource(article.source_type)) { totalSkipped++; continue; }

      if (restore) {
        if (
          article.exclusion_candidate &&
          article.user_relevance !== "irrelevant" &&
          article.user_relevance !== "different_company" &&
          (article.exclusion_reason?.includes("ノイズルール") || article.exclusion_reason?.includes("除外キーワード"))
        ) {
          if (!dryRun) {
            await supabase.from("articles").update({ exclusion_candidate: false, exclusion_reason: null }).eq("id", article.id);
          }
          restoredArticles.push({ id: article.id, title: article.title.slice(0, 60) });
          totalRestored++;
        }
        continue;
      }

      if (article.user_relevance === "relevant") { totalSkipped++; continue; }
      if (article.exclusion_candidate && article.user_relevance === "irrelevant") { totalSkipped++; continue; }
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
          await supabase.from("articles").update({ exclusion_candidate: true, exclusion_reason: matchReason }).eq("id", article.id);
          ruleApplyDelta[matchedRule.id] = (ruleApplyDelta[matchedRule.id] ?? 0) + 1;
        }
        markedArticles.push({ id: article.id, title: article.title.slice(0, 60), reason: matchReason });
        totalMarked++;
      }
    }
  }

  // apply_countは「このrunで新たに一致した件数」をDB上の既存値へ累積加算する
  // (上書きだと過去の適用実績が消える — API/CLIで方式が食い違っていたバグの修正)
  if (!dryRun && !restore) {
    for (const [matchedRuleId, delta] of Object.entries(ruleApplyDelta)) {
      const base = noiseRules.find((r) => r.id === matchedRuleId)?.apply_count ?? 0;
      await supabase.from("noise_rules")
        .update({ apply_count: base + delta, last_applied_at: new Date().toISOString() })
        .eq("id", matchedRuleId);
    }
  }

  if (!dryRun) {
    await supabase.from("operation_logs").insert({
      action: restore ? "reclassify_restore" : "reclassify_articles",
      result: "success",
      details: {
        scanned: totalScanned,
        marked: totalMarked,
        restored: totalRestored,
        skipped: totalSkipped,
        stock_id: stockId ?? "all",
        rule_id: ruleId ?? "all",
      },
    });
  }

  return { scanned: totalScanned, marked: totalMarked, restored: totalRestored, skipped: totalSkipped, markedArticles, restoredArticles };
}

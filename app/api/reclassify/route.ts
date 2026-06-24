import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const SAFE_SOURCE_TYPES = new Set(["tdnet", "edinet", "official"]);

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

/**
 * POST /api/reclassify
 * Body: { stock_id?, rule_id?, dry_run?, restore? }
 * - dry_run=true: count only, no DB writes
 * - restore=true: revert auto-exclusion to not excluded
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Use service role key for bulk updates (bypasses RLS)
  const adminClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const body = await request.json().catch(() => ({}));
  const { stock_id, rule_id, dry_run = false, restore = false } = body;

  // Load applicable noise rules
  const rulesQuery = adminClient
    .from("noise_rules")
    .select("id, stock_id, scope, rule_type, match_type, match_value, apply_count")
    .eq("is_active", true);
  if (rule_id) rulesQuery.eq("id", rule_id);

  const { data: noiseRules } = await rulesQuery;
  const rules = noiseRules ?? [];

  // Determine which stocks to scan
  let stockIds: string[] = [];
  if (stock_id) {
    stockIds = [stock_id];
  } else {
    const { data: allStocks } = await adminClient
      .from("stocks")
      .select("id")
      .eq("status", "active");
    stockIds = (allStocks ?? []).map((s: { id: string }) => s.id);
  }

  let totalScanned = 0, totalMarked = 0, totalRestored = 0, totalSkipped = 0;
  const ruleApplyCounts: Record<string, number> = {};

  for (const sid of stockIds) {
    const stockRules = rules.filter(
      (r) => r.scope === "all_stocks" || r.stock_id === sid
    );
    if (!restore && stockRules.length === 0) continue;

    const { data: linked } = await adminClient
      .from("article_stocks")
      .select("article_id, articles!inner(id,title,summary,source_url,publisher,source_type,exclusion_candidate,user_relevance,exclusion_reason)")
      .eq("stock_id", sid);

    const articles = ((linked ?? []) as unknown as {
      articles: {
        id: string;
        title: string;
        summary: string | null;
        source_url: string;
        publisher: string | null;
        source_type: string;
        exclusion_candidate: boolean;
        user_relevance: string | null;
        exclusion_reason: string | null;
      };
    }[]).map((r) => r.articles);

    for (const article of articles) {
      totalScanned++;
      if (SAFE_SOURCE_TYPES.has(article.source_type)) { totalSkipped++; continue; }

      if (restore) {
        if (
          article.exclusion_candidate &&
          article.user_relevance !== "irrelevant" &&
          article.user_relevance !== "different_company" &&
          (article.exclusion_reason?.includes("ノイズルール") || article.exclusion_reason?.includes("除外キーワード"))
        ) {
          if (!dry_run) {
            await adminClient.from("articles").update({
              exclusion_candidate: false,
              exclusion_reason: null,
            }).eq("id", article.id);
          }
          totalRestored++;
        }
        continue;
      }

      if (article.user_relevance === "relevant") { totalSkipped++; continue; }
      if (article.exclusion_candidate && article.user_relevance === "irrelevant") { totalSkipped++; continue; }

      let matchedRule: (typeof rules)[0] | null = null;
      let matchReason = "";
      for (const rule of stockRules) {
        if (rule.rule_type === "strengthen") continue;
        if (matchesRule(rule.match_type, rule.match_value, article.title, article.summary, article.source_url, article.publisher)) {
          matchedRule = rule;
          matchReason = `ノイズルール一致: ${rule.match_type}="${rule.match_value}"`;
          ruleApplyCounts[rule.id] = (ruleApplyCounts[rule.id] ?? 0) + 1;
          break;
        }
      }

      if (matchedRule && !article.exclusion_candidate) {
        if (!dry_run) {
          await adminClient.from("articles").update({
            exclusion_candidate: true,
            exclusion_reason: matchReason,
          }).eq("id", article.id);
        }
        totalMarked++;
      }
    }
  }

  // Update apply_counts
  if (!dry_run && !restore) {
    for (const [ruleId, count] of Object.entries(ruleApplyCounts)) {
      await adminClient.from("noise_rules")
        .update({ apply_count: count, last_applied_at: new Date().toISOString() })
        .eq("id", ruleId);
    }
  }

  // Log
  if (!dry_run) {
    await supabase.from("operation_logs").insert({
      action: restore ? "reclassify_restore" : "reclassify_articles",
      result: "success",
      details: {
        scanned: totalScanned,
        marked: totalMarked,
        restored: totalRestored,
        skipped: totalSkipped,
        stock_id: stock_id ?? "all",
        rule_id: rule_id ?? "all",
      },
    });
  }

  return NextResponse.json({
    ok: true,
    dry_run,
    restore,
    stats: {
      scanned: totalScanned,
      marked: totalMarked,
      restored: totalRestored,
      skipped: totalSkipped,
    },
  });
}

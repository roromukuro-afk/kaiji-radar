#!/usr/bin/env tsx
/**
 * reclassify-relevance-failures.ts — AI関連性判定が失敗した記事の再判定
 *
 * checkRelevance()がGemini呼び出し失敗時に安全側フォールバックとして
 * relevance='uncertain', relevance_reason='AI判定失敗' を記録するケースが
 * 断続的に発生していた(2026-08-09〜)。実際にはAIが一度も判定しておらず、
 * Google News検索結果に混入した無関係な記事(フリマ・中古品サイト等)が
 * 「関連不確実」のまま一覧に残り続けていた。
 *
 * 今は改めてGemini APIで判定し直し、irrelevantと判明したものは
 * 除外候補化する(除外候補は一覧のデフォルト表示から隠れる)。
 *
 * 使い方: npx tsx scripts/reclassify-relevance-failures.ts [--limit N]
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { checkRelevance } from "../lib/processors/relevance.js";

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

interface Row {
  id: string;
  title: string;
  summary: string | null;
  source_type: string;
  stock_id: string;
  code: string;
  name: string;
  jp_keywords: string[] | null;
  en_keywords: string[] | null;
}

async function fetchBatch(limit: number): Promise<Row[]> {
  const { data, error } = await supabase
    .from("articles")
    .select(`
      id, title, summary, source_type,
      article_stocks!inner (
        stock_id,
        stocks!inner (
          code, name,
          stock_profiles (jp_keywords, en_keywords)
        )
      )
    `)
    .eq("relevance_reason", "AI判定失敗")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const link = r.article_stocks[0];
    const stock = link.stocks;
    const profile = Array.isArray(stock.stock_profiles) ? stock.stock_profiles[0] : stock.stock_profiles;
    return {
      id: r.id,
      title: r.title,
      summary: r.summary,
      source_type: r.source_type,
      stock_id: link.stock_id,
      code: stock.code,
      name: stock.name,
      jp_keywords: profile?.jp_keywords ?? null,
      en_keywords: profile?.en_keywords ?? null,
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const hardLimit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;

  const { count } = await supabase
    .from("articles")
    .select("id", { count: "exact", head: true })
    .eq("relevance_reason", "AI判定失敗");
  console.log(`[reclassify] 対象: ${count ?? 0} 件${Number.isFinite(hardLimit) ? ` (--limit ${hardLimit})` : ""}`);

  let processed = 0;
  let stillFailed = 0;
  const tally: Record<string, number> = { certain: 0, uncertain: 0, irrelevant: 0 };

  while (processed < hardLimit) {
    const batch = await fetchBatch(Math.min(50, hardLimit - processed));
    if (batch.length === 0) break;

    for (const row of batch) {
      const keywords =
        row.source_type === "en_news"
          ? [...(row.jp_keywords ?? []), ...(row.en_keywords ?? [])]
          : row.jp_keywords ?? [];

      const result = await checkRelevance(row.title, row.summary, row.code, row.name, keywords);

      if (result.reason === "AI判定失敗") {
        // まだ失敗する場合は次回に回す(無限ループ防止のため、この行だけスキップして進む)
        stillFailed++;
        await supabase
          .from("articles")
          .update({ relevance_reason: "AI判定失敗(再試行済み)" })
          .eq("id", row.id);
        processed++;
        continue;
      }

      const updates: Record<string, unknown> = {
        relevance: result.result,
        relevance_reason: result.reason,
      };
      if (result.result === "irrelevant") {
        updates.exclusion_candidate = true;
        updates.exclusion_reason = "AI再判定の結果irrelevant(元はAPI失敗によるuncertainフォールバック)";
      }

      const { error } = await supabase.from("articles").update(updates).eq("id", row.id);
      if (error) console.error(`[reclassify] 更新失敗 ${row.id}:`, error.message);
      else tally[result.result] = (tally[result.result] ?? 0) + 1;

      processed++;
      if (processed % 20 === 0) console.log(`[reclassify] ${processed} 件処理 (${JSON.stringify(tally)})`);
    }
  }

  console.log(`\n[reclassify] 完了: ${processed} 件処理`);
  console.log(`  内訳: ${JSON.stringify(tally)}`);
  console.log(`  再度AI判定失敗: ${stillFailed} 件(relevance_reasonを'AI判定失敗(再試行済み)'に変更し次回対象から除外)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

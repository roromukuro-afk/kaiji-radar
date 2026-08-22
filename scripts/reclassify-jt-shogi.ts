#!/usr/bin/env tsx
/**
 * reclassify-jt-shogi.ts — JT(2914)の将棋大会(JT杯/将棋日本シリーズ)記事の再判定
 *
 * 半角「JT」が社名と完全一致するため、force_ai_relevance_check未設定の間は
 * AI判定を省略して常にcertain確定していた。force_ai_relevance_check=true化
 * (別途DB側で実施済み)とプロンプトの一般化(冠スポンサー対象の活動報告は
 * プロ野球に限らずirrelevant)を行った上で、既存の該当記事を再判定する。
 *
 * 使い方: npx tsx scripts/reclassify-jt-shogi.ts
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

async function main() {
  const { data: stock } = await supabase.from("stocks").select("id, code, name").eq("code", "2914").single();
  if (!stock) throw new Error("2914 (JT) not found");

  const { data: profile } = await supabase
    .from("stock_profiles")
    .select("jp_keywords, en_keywords")
    .eq("stock_id", stock.id)
    .single();

  const { data: rows, error } = await supabase
    .from("articles")
    .select("id, title, summary, source_type")
    .eq("relevance", "certain")
    .or("title.ilike.%将棋%,title.ilike.%JT杯%,title.ilike.%ＪＴ杯%")
    .in(
      "id",
      (
        await supabase
          .from("article_stocks")
          .select("article_id")
          .eq("stock_id", stock.id)
      ).data?.map((r) => r.article_id) ?? []
    );
  if (error) throw error;

  console.log(`[reclassify-jt] 対象: ${rows?.length ?? 0} 件`);
  const tally: Record<string, number> = { certain: 0, uncertain: 0, irrelevant: 0 };

  for (const row of rows ?? []) {
    const keywords =
      row.source_type === "en_news"
        ? [...(profile?.jp_keywords ?? []), ...(profile?.en_keywords ?? [])]
        : profile?.jp_keywords ?? [];
    const result = await checkRelevance(row.title, row.summary, stock.code, stock.name, keywords);

    const updates: Record<string, unknown> = { relevance: result.result, relevance_reason: result.reason };
    if (result.result === "irrelevant") {
      updates.exclusion_candidate = true;
      updates.exclusion_reason = "AI再判定の結果irrelevant(将棋等の冠スポンサー大会の活動報告、プロンプト一般化後)";
    }
    const { error: updateErr } = await supabase.from("articles").update(updates).eq("id", row.id);
    if (updateErr) {
      console.error(`[reclassify-jt] 更新失敗 ${row.id}:`, updateErr.message);
      continue;
    }
    tally[result.result] = (tally[result.result] ?? 0) + 1;
    console.log(`  ${result.result}: ${row.title.slice(0, 50)} (${result.reason})`);
  }

  console.log(`[reclassify-jt] 完了: ${JSON.stringify(tally)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

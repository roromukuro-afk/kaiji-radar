#!/usr/bin/env tsx
/**
 * export-config.ts — 監視設定一式のJSONエクスポート
 *
 * 監視銘柄・キーワード・ノイズルール・通知設定をまとめて1つのJSONに出力する。
 * バックアップ(全記事含む)とは別に、「設定だけ」を素早く見返したり、
 * 別環境への移行・共有に使う。
 *
 * 使い方:
 *   npx tsx scripts/export-config.ts                      # ./config-export-<日付>.json へ出力
 *   npx tsx scripts/export-config.ts --out my-config.json  # 出力先を指定
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

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

function parseArgs() {
  const args = process.argv.slice(2);
  const v: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) { v.out = args[i + 1]; i++; }
  }
  return v;
}

async function main() {
  const args = parseArgs();
  const dateStr = new Date().toISOString().split("T")[0];
  const outPath = args.out ?? `config-export-${dateStr}.json`;

  const [stocksRes, noiseRulesRes] = await Promise.all([
    supabase
      .from("stocks")
      .select("code, name, name_en, edinet_code, sec_code, status, stock_profiles(exchange, sector, official_url, ir_url, jp_keywords, en_keywords, rss_urls, notify_event_types, force_ai_relevance_check)")
      .neq("status", "deleted")
      .order("code"),
    supabase
      .from("noise_rules")
      .select("scope, rule_name, rule_type, match_type, match_value, language, reason, is_active, stocks(code)")
      .order("created_at"),
  ]);

  if (stocksRes.error) throw stocksRes.error;
  if (noiseRulesRes.error) throw noiseRulesRes.error;

  const exportData = {
    exported_at: new Date().toISOString(),
    stocks: stocksRes.data ?? [],
    noise_rules: (noiseRulesRes.data ?? []).map((r) => ({
      stock_code: (r as unknown as { stocks: { code: string } | null }).stocks?.code ?? null,
      scope: r.scope,
      rule_name: r.rule_name,
      rule_type: r.rule_type,
      match_type: r.match_type,
      match_value: r.match_value,
      language: r.language,
      reason: r.reason,
      is_active: r.is_active,
    })),
  };

  writeFileSync(outPath, JSON.stringify(exportData, null, 2), "utf-8");
  console.log(`[export-config] ${outPath} に出力しました`);
  console.log(`  銘柄: ${exportData.stocks.length}件`);
  console.log(`  ノイズルール: ${exportData.noise_rules.length}件`);
}

main().catch((err) => { console.error(err); process.exit(1); });

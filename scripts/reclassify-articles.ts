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
 *
 * ロジック本体は lib/reclassify.ts に一本化(app/api/reclassify/route.ts と共通)。
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { runReclassify } from "../lib/reclassify.js";

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
  const filterRuleId = args.rule as string | undefined;

  console.log(`[reclassify] 開始 ${dryRun ? "(dry-run)" : ""} ${restore ? "(復元モード)" : ""}`);

  let stockId: string | undefined;
  if (filterStock) {
    const { data: s } = await supabase.from("stocks").select("id").eq("code", filterStock).single();
    if (!s) { console.log(`[reclassify] 銘柄コード ${filterStock} が見つかりません`); return; }
    stockId = s.id;
  }

  const result = await runReclassify(supabase, {
    stockId,
    ruleId: filterRuleId,
    dryRun,
    restore,
  });

  console.log(`\n[reclassify] 完了${dryRun ? " (dry-run)" : ""}:`);
  console.log(`  スキャン   : ${result.scanned} 件`);
  if (!restore) {
    console.log(`  除外候補追加: ${result.marked} 件${dryRun ? " (予定)" : ""}`);
    console.log(`  スキップ   : ${result.skipped} 件 (安全ソース・ユーザー判定済み)`);
    if (result.marked > 0) {
      console.log("\n  除外候補になった記事:");
      for (const a of result.markedArticles.slice(0, 20)) {
        console.log(`    - ${a.title}`);
        console.log(`      理由: ${a.reason}`);
      }
      if (result.markedArticles.length > 20) console.log(`    ... 他 ${result.markedArticles.length - 20} 件`);
    }
  } else {
    console.log(`  復元       : ${result.restored} 件${dryRun ? " (予定)" : ""}`);
    if (result.restored > 0) {
      console.log("\n  復元された記事:");
      for (const a of result.restoredArticles.slice(0, 20)) {
        console.log(`    - ${a.title}`);
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

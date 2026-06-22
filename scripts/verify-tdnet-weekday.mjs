/**
 * TDnet 平日検証スクリプト
 * 実行タイミング: 平日 15:30〜18:00 JST (市場クローズ後)
 * 使い方: node scripts/verify-tdnet-weekday.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
const envLines = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n");
for (const line of envLines) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const idx = t.indexOf("="); if (idx === -1) continue;
  const k = t.slice(0, idx).trim();
  const v = t.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log("=== TDnet 平日検証 ===");
console.log("実行時刻:", new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }));

// 直近24時間の TDnet 記事
const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const { data: tdnetArts } = await sb.from("articles")
  .select("id, title, source_type, source_url, stock_code, published_at, created_at, is_pdf")
  .eq("source_type", "tdnet")
  .gte("created_at", since)
  .order("created_at", { ascending: false });

console.log("\n1. TDnet 直近24時間の新着:", tdnetArts?.length ?? 0, "件");
if (tdnetArts && tdnetArts.length > 0) {
  for (const a of tdnetArts.slice(0, 5)) {
    console.log(`  ✓ [${a.stock_code}] ${a.title?.slice(0, 50)} (PDF:${a.is_pdf})`);
    console.log(`    source: ${a.source_url?.slice(0, 80)}`);
    console.log(`    created: ${a.created_at?.slice(0, 19)}`);
  }
} else {
  console.log("  ⚠️  TDnet 記事なし（市場クローズ後か、取得失敗の可能性）");
}

// TDnet 銘柄マッチング確認
const { data: stocks } = await sb.from("stocks").select("code, name").eq("status", "active");
const stockSet = new Set(stocks?.map((s) => s.code));
const unmapped = (tdnetArts ?? []).filter((a) => a.stock_code && !stockSet.has(a.stock_code));
console.log("\n2. 銘柄マッピング:");
console.log(`  監視銘柄: ${stockSet.size}件`);
console.log(`  マッチ: ${(tdnetArts ?? []).filter((a) => stockSet.has(a.stock_code)).length}件`);
if (unmapped.length > 0) console.log(`  ⚠️  未マッチ: ${unmapped.map((a) => a.stock_code).join(", ")}`);

// 重複確認: 同じ source_url が複数あれば問題
const urlMap = {};
for (const a of tdnetArts ?? []) {
  if (a.source_url) urlMap[a.source_url] = (urlMap[a.source_url] ?? 0) + 1;
}
const dups = Object.entries(urlMap).filter(([, count]) => count > 1);
console.log("\n3. 重複チェック:");
if (dups.length > 0) {
  console.log("  ⚠️  重複URLあり:", dups.length, "件");
} else {
  console.log("  ✓ 重複なし");
}

// 最新フェッチジョブの TDnet カウント
const { data: latestJob } = await sb.from("fetch_jobs")
  .select("started_at, status, tdnet_count, source_results")
  .order("started_at", { ascending: false })
  .limit(3);

console.log("\n4. 最近の fetch_jobs TDnet カウント:");
for (const j of latestJob ?? []) {
  const sr = j.source_results;
  const tdnet = sr?.per_source?.tdnet;
  console.log(`  ${j.started_at?.slice(0, 19)} tdnet_count=${j.tdnet_count}`, tdnet ? `candidates=${tdnet.candidates} saved=${tdnet.saved} skipped=${tdnet.skipped}` : "");
}

// PDF URL 確認
const pdfArts = (tdnetArts ?? []).filter((a) => a.is_pdf);
console.log("\n5. PDF 記事:", pdfArts.length, "件");
if (pdfArts.length > 0) {
  console.log("  (PDF URLは source_url で確認してください)");
  console.log("  例:", pdfArts[0]?.source_url?.slice(0, 80));
}

console.log("\n=== 検証完了 ===");
if ((tdnetArts?.length ?? 0) === 0) {
  console.log("⚠️  TDnet 記事が0件です。以下を確認してください:");
  console.log("  - 実行時刻が平日 15:30〜18:00 JST 以降か");
  console.log("  - GitHub Actions ログで TDnet 取得エラーがないか");
  console.log("  - health_checks.tdnet の status が ok か");
} else {
  console.log("✓ TDnet 正常取得確認完了");
}

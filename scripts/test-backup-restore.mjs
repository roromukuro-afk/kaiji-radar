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

// Download latest backup from storage
const { data: files } = await sb.storage.from("backups").list("", { limit: 5, sortBy: { column: "created_at", order: "desc" } });
const latest = files?.[0];
if (!latest) { console.log("バックアップファイルなし"); process.exit(1); }

console.log("最新バックアップ:", latest.name, Math.round((latest.metadata?.size ?? 0) / 1024), "KB");

const { data: raw } = await sb.storage.from("backups").download(latest.name);
const text = await raw.text();
const backup = JSON.parse(text);

// Validate structure
console.log("\n=== バックアップ内容 ===");
const TABLES = ["stocks", "stock_profiles", "articles", "article_stocks", "push_subscriptions", "notification_history", "operation_logs", "system_settings"];
let allOk = true;
for (const table of TABLES) {
  const rows = backup[table];
  if (!Array.isArray(rows)) { console.log(`  ✗ ${table}: 存在しない`); allOk = false; }
  else console.log(`  ✓ ${table}: ${rows.length}件`);
}

// Verify data integrity: stocks count
const stockCount = backup.stocks?.length ?? 0;
if (stockCount === 0) { console.log("  ✗ stocks が空"); allOk = false; }

// Check latest article timestamp
const articles = backup.articles ?? [];
const latestArticle = articles.sort((a, b) => b.created_at?.localeCompare(a.created_at ?? "") ?? 0)[0];
if (latestArticle) {
  console.log("\n最新記事:", latestArticle.title?.slice(0, 50), "@", latestArticle.created_at?.slice(0, 19));
}

console.log("\n復元テスト結果:", allOk ? "✓ 整合性OK" : "✗ 問題あり");
console.log("(実際のDB挿入は行いません — 整合性確認のみ)");

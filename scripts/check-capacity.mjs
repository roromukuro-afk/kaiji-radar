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

const tables = ["articles","article_stocks","notification_history","fetch_jobs","health_checks","operation_logs","push_subscriptions","backup_logs","pdf_documents","stocks"];
console.log("=== テーブル件数 ===");
for (const t of tables) {
  const { count } = await sb.from(t).select("id", { count: "exact", head: true });
  console.log(`  ${t}: ${count ?? "?"}`);
}

// backup storage
const { data: files } = await sb.storage.from("backups").list("", { limit: 100 });
const backupBytes = (files ?? []).reduce((s, f) => s + (f.metadata?.size ?? 0), 0);
console.log("\n=== ストレージ ===");
console.log(`  backups: ${files?.length}件, ${Math.round(backupBytes/1024)}KB`);

// Fetch jobs per day for the last 7 days
const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString();
const { data: jobs } = await sb.from("fetch_jobs").select("started_at").gte("started_at", sevenDaysAgo);
const dayMap = {};
for (const j of jobs ?? []) {
  const day = j.started_at?.slice(0,10);
  dayMap[day] = (dayMap[day] ?? 0) + 1;
}
console.log("\n=== GitHub Actions 実行頻度 (過去7日) ===");
for (const [day, count] of Object.entries(dayMap).sort()) {
  const mins = count * 7;
  console.log(`  ${day}: ${count}回 (~${mins}分)`);
}
const avgPerDay = Object.values(dayMap).reduce((s, v) => s + v, 0) / Object.keys(dayMap).length;
console.log(`  平均: ${avgPerDay.toFixed(1)}回/日 → 月推計: ${Math.round(avgPerDay * 30 * 7)}分`);

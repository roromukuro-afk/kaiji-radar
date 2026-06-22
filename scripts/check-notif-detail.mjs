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

// notification_history stats
const { data: byStatus } = await sb.from("notification_history")
  .select("status")
  .order("created_at", { ascending: false });

const counts = {};
for (const r of byStatus ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log("notification_history ステータス別:", counts);

// latest 5 notifications
const { data: recent } = await sb.from("notification_history")
  .select("status, error_message, created_at, article_id")
  .order("created_at", { ascending: false })
  .limit(5);
console.log("\n最新5件:");
for (const n of recent ?? []) {
  console.log(JSON.stringify({ status: n.status, err: n.error_message?.slice(0, 60), at: n.created_at?.slice(0, 19) }));
}

// source_results for latest run
const { data: job } = await sb.from("fetch_jobs")
  .select("started_at, source_results, articles_found, articles_saved")
  .order("started_at", { ascending: false })
  .limit(1)
  .single();
console.log("\n最新ジョブ source_results:");
console.log(JSON.stringify(job?.source_results, null, 2));

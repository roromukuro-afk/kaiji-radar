import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const envLines = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n");
for (const line of envLines) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const idx = t.indexOf("=");
  if (idx === -1) continue;
  const k = t.slice(0, idx).trim();
  const v = t.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// fetch_jobs
const { data: jobs } = await sb
  .from("fetch_jobs")
  .select("*")
  .order("started_at", { ascending: false })
  .limit(5);

console.log("=== fetch_jobs (最新5件) ===");
for (const j of jobs ?? []) {
  console.log(JSON.stringify({
    status: j.status,
    started: j.started_at?.slice(0, 19),
    tdnet: j.tdnet_count,
    edinet: j.edinet_count,
    jp_news: j.jp_news_count,
    en_news: j.en_news_count,
    found: j.articles_found,
    saved: j.articles_saved,
    err: j.error_message?.slice(0, 80),
  }));
}

// health_checks
const { data: hc } = await sb.from("health_checks").select("*").order("source");
console.log("\n=== health_checks ===");
for (const h of hc ?? []) {
  console.log(JSON.stringify({
    source: h.source,
    last_ok: h.last_success_at?.slice(0, 19),
    last_fail: h.last_failure_at?.slice(0, 19),
    consec_fail: h.consecutive_failures,
    status: h.status,
  }));
}

// operation_logs
const { data: logs } = await sb
  .from("operation_logs")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(10);

console.log("\n=== operation_logs (最新10件) ===");
for (const l of logs ?? []) {
  console.log(JSON.stringify({
    action: l.action,
    result: l.result,
    created: l.created_at?.slice(0, 19),
    details: l.details,
  }));
}

// notification_history recent
const { data: notifs } = await sb
  .from("notification_history")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(10);

console.log("\n=== notification_history (最新10件) ===");
for (const n of notifs ?? []) {
  console.log(JSON.stringify({
    status: n.status,
    created: n.created_at?.slice(0, 19),
    article_id: n.article_id?.slice(0, 8),
    error: n.error_message?.slice(0, 60),
  }));
}

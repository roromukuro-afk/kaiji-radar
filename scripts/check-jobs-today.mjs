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
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// fetch_jobs last 20
const { data: jobs } = await sb
  .from("fetch_jobs")
  .select("id, started_at, status, articles_saved, source_results")
  .order("started_at", { ascending: false })
  .limit(20);

console.log("=== fetch_jobs (最新20件) ===");
for (const j of jobs ?? []) {
  const hasSourceResults = j.source_results != null;
  console.log(`${j.started_at?.slice(0, 19)} ${j.status} saved=${j.articles_saved} source_results=${hasSourceResults}`);
}

// push_subscriptions details (without keys)
const { data: subs } = await sb.from("push_subscriptions").select("id, user_id, created_at, endpoint").limit(5);
console.log("\n=== push_subscriptions ===");
for (const s of subs ?? []) {
  console.log(`id=${s.id?.slice(0,8)} user=${s.user_id?.slice(0,8)} created=${s.created_at?.slice(0,19)} endpoint=...${s.endpoint?.slice(-30)}`);
}

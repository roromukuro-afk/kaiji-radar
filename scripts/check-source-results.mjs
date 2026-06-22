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

const { data } = await sb.from("fetch_jobs").select("started_at, source_results").order("started_at", { ascending: false }).limit(2);
for (const j of data ?? []) {
  console.log("started:", j.started_at?.slice(0,19));
  console.log("source_results:", JSON.stringify(j.source_results, null, 2));
  console.log("---");
}

// push_subscriptions
const { data: subs, error: subErr } = await sb.from("push_subscriptions").select("*");
console.log("push_subscriptions error:", subErr);
console.log("push_subscriptions rows:", subs?.length ?? 0);
if (subs && subs.length > 0) {
  const s = subs[0];
  console.log("  id:", s.id, "created:", s.created_at?.slice(0,19), "endpoint_tail:", s.endpoint?.slice(-40));
}

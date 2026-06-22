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

const { count: subCount } = await sb.from("push_subscriptions").select("id", { count: "exact", head: true });
console.log("push_subscriptions件数:", subCount);

const { count: notifTotal } = await sb.from("notification_history").select("id", { count: "exact", head: true });
console.log("notification_history総件数:", notifTotal);

const { count: sentCount } = await sb.from("articles").select("id", { count: "exact", head: true }).eq("notification_sent", true);
const { count: unsentCount } = await sb.from("articles").select("id", { count: "exact", head: true }).eq("notification_sent", false);
console.log("articles notification_sent=true:", sentCount);
console.log("articles notification_sent=false:", unsentCount);

const { data: recent } = await sb.from("articles").select("id, title, source_type, notification_sent, notification_failed_count, created_at").order("created_at", { ascending: false }).limit(5);
console.log("\n最新5記事:");
for (const a of recent ?? []) {
  console.log(JSON.stringify({ title: a.title?.slice(0, 40), type: a.source_type, notif_sent: a.notification_sent, failed: a.notification_failed_count, at: a.created_at?.slice(0, 19) }));
}

/**
 * 安全な障害テスト:
 * 1. notification_history に "failed" レコードを挿入
 * 2. テスト記事の notification_failed_count を 2 に設定
 * 3. 再送対象クエリで検出されるか確認
 * 4. health_checks に連続失敗を書き込んでみる
 * ※ テスト終了後に全て元に戻す
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

// 1. テスト対象記事を1件取得
const { data: art } = await sb.from("articles").select("id, title, notification_sent, notification_failed_count").limit(1).single();
console.log("テスト記事:", art.id.slice(0,8), art.title?.slice(0,40));
const origFailed = art.notification_failed_count ?? 0;

// 2. Push subscription を取得
const { data: subs } = await sb.from("push_subscriptions").select("id").limit(1);
const subId = subs?.[0]?.id;

// 3. notification_history に failed レコード挿入
const { data: failRec, error: failErr } = await sb.from("notification_history").insert({
  article_id: art.id,
  subscription_id: subId,
  status: "failed",
  error_message: "Simulated failure for testing",
  attempt_count: 1,
}).select("id").single();
if (failErr) { console.log("failed insert error:", failErr.message); }
else console.log("✓ notification_history に failed レコード挿入:", failRec.id.slice(0,8));

// 4. 記事の notification_failed_count を 2 に設定
await sb.from("articles").update({ notification_failed_count: 2, notification_sent: false }).eq("id", art.id);
console.log("✓ notification_failed_count=2 に設定");

// 5. 再送対象クエリ確認（ワーカー内で使われる条件と同じ）
const { count: pendingCount } = await sb.from("articles")
  .select("id", { count: "exact", head: true })
  .eq("notification_sent", false)
  .gte("notification_failed_count", 2);
console.log("✓ 再送対象件数:", pendingCount, "(期待値: >=1)");

// 6. health_checks に連続失敗を一時書き込み
const hcSource = "test_failure";
await sb.from("health_checks").upsert(
  { source: hcSource, status: "failed", consecutive_failures: 3, last_failure_at: new Date().toISOString(), checked_at: new Date().toISOString() },
  { onConflict: "source" }
);
const { data: hcRow } = await sb.from("health_checks").select("*").eq("source", hcSource).single();
console.log("✓ health_checks 障害記録:", JSON.stringify({ source: hcRow.source, status: hcRow.status, consec: hcRow.consecutive_failures }));

// 7. 後片付け
await sb.from("articles").update({ notification_failed_count: origFailed, notification_sent: true }).eq("id", art.id);
if (failRec?.id) await sb.from("notification_history").delete().eq("id", failRec.id);
await sb.from("health_checks").delete().eq("source", hcSource);
console.log("\n✓ 後片付け完了（テストデータを全て削除）");

// 8. notification_history 最終状態確認
const { data: nh } = await sb.from("notification_history").select("status").order("sent_at", { ascending: false }).limit(5);
const statusMap = {};
for (const r of nh ?? []) statusMap[r.status] = (statusMap[r.status] ?? 0) + 1;
console.log("notification_history 現状:", statusMap);

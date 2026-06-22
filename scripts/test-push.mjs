/**
 * Test script: check push subscriptions and send a test notification.
 * Usage: npx tsx scripts/test-push.mjs
 */
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local");
const envLines = readFileSync(envPath, "utf-8").split("\n");
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx).trim();
  const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = val;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  "mailto:roromukuro@gmail.com",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// 1. Check subscriptions
const { data: subs, error } = await supabase
  .from("push_subscriptions")
  .select("id, endpoint, p256dh, auth, user_agent, last_active_at");

if (error) {
  console.error("Supabase error:", error);
  process.exit(1);
}

console.log(`\n=== push_subscriptions: ${subs.length} 件 ===`);
for (const s of subs) {
  console.log(`  id: ${s.id}`);
  console.log(`  endpoint: ...${s.endpoint.slice(-40)}`);
  console.log(`  last_active_at: ${s.last_active_at}`);
  console.log(`  user_agent: ${s.user_agent?.slice(0, 80)}`);
  console.log();
}

if (subs.length === 0) {
  console.log("購読が0件です。iPhoneで通知許可をしてから再実行してください。");
  process.exit(0);
}

// 2. Send test notification to all subscriptions
console.log("=== テスト通知を送信します ===");

const payload = JSON.stringify({
  title: "開示レーダー | テスト通知",
  body: "通知が正常に届いています。PWA設定完了です。",
  icon: "/icons/icon-192.png",
  badge: "/icons/badge-96.png",
  data: { url: "/" },
  tag: "test-notification",
});

let sent = 0;
let failed = 0;

for (const sub of subs) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: 3600 }
    );
    console.log(`  ✓ 送信成功: ...${sub.endpoint.slice(-30)}`);
    sent++;
  } catch (err) {
    console.error(`  ✗ 送信失敗 (status=${err?.statusCode}): ...${sub.endpoint.slice(-30)}`);
    if (err?.statusCode === 410 || err?.statusCode === 404) {
      console.log("    → 無効な購読。Supabaseから削除します。");
      await supabase.from("push_subscriptions").delete().eq("id", sub.id);
    }
    failed++;
  }
}

console.log(`\n結果: 送信=${sent}, 失敗=${failed}`);

/**
 * Send a test notification with a real article URL to verify tap-to-open.
 */
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { readFileSync } from "fs";
import { resolve } from "path";

const envLines = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n");
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

// Fetch a recent article with stock info
const { data: articles } = await supabase
  .from("articles")
  .select("id, title, source_type, published_at, article_stocks(stocks(code, name))")
  .order("published_at", { ascending: false })
  .limit(5);

const article = articles?.[0];
if (!article) { console.error("記事が見つかりません"); process.exit(1); }

const stockCode = article.article_stocks?.[0]?.stocks?.code ?? "----";
const stockName = article.article_stocks?.[0]?.stocks?.name ?? "不明";

console.log(`\n記事: [${stockCode} ${stockName}] ${article.title?.slice(0, 60)}`);
console.log(`URL: /article/${article.id}`);

const { data: subs } = await supabase
  .from("push_subscriptions")
  .select("id, endpoint, p256dh, auth");

const payload = JSON.stringify({
  title: `TDnet | ${stockCode} ${stockName}`,
  body: article.title,
  icon: "/icons/icon-192.png",
  badge: "/icons/badge-96.png",
  data: { url: `/article/${article.id}` },
  tag: `test-article-${article.id}`,
});

for (const sub of subs) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: 3600 }
    );
    console.log("✓ 送信成功");
  } catch (err) {
    console.error("✗ 失敗:", err?.statusCode, err?.message);
  }
}

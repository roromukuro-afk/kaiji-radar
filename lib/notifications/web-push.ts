/**
 * Web Push 通知 (VAPID)
 *
 * iOS 16.4+ PWA対応。APNs証明書不要でVAPIDのみで動作。
 * 通知失敗時は再送し、2回連続失敗でメール通知。
 */

import webpush from "web-push";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

webpush.setVapidDetails(
  `mailto:${process.env.BACKUP_EMAIL ?? "roromukuro@gmail.com"}`,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export interface PushPayload {
  title: string;
  body: string;
  icon: string;
  badge: string;
  data: {
    articleId: string;
    sourceType: string;
    stockCode: string;
    stockName: string;
    url: string;
  };
  tag?: string;
}

function getSupabase() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function sendPushToAll(
  payload: PushPayload,
  articleId: string
): Promise<{ sent: number; failed: number }> {
  const supabase = getSupabase();
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");

  if (!subs || subs.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    const success = await sendPushToSubscription(sub, payload, articleId);
    if (success) sent++;
    else failed++;
  }

  return { sent, failed };
}

export async function sendPushToSubscription(
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
  articleId: string
): Promise<boolean> {
  const supabase = getSupabase();

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 24 * 3600 }
    );

    const now = new Date().toISOString();

    await supabase.from("notification_history").insert({
      article_id: articleId,
      subscription_id: sub.id,
      status: "sent",
    });

    await supabase
      .from("articles")
      .update({ notification_sent: true, notification_sent_at: now, notification_failed_count: 0 })
      .eq("id", articleId);

    // 端末単位の成功実績を記録し、連続失敗カウントをリセットする
    await supabase
      .from("push_subscriptions")
      .update({ last_success_at: now, consecutive_failures: 0 })
      .eq("id", sub.id);

    return true;
  } catch (err: any) {
    console.error(`[Push] 送信失敗 ${sub.endpoint.slice(-20)}:`, err?.statusCode ?? err);

    await supabase.from("notification_history").insert({
      article_id: articleId,
      subscription_id: sub.id,
      status: "failed",
      error_message: String(err),
    });

    // 410/404: subscription gone → remove it
    if (err?.statusCode === 410 || err?.statusCode === 404) {
      await supabase.from("push_subscriptions").delete().eq("id", sub.id);
    } else {
      const { data: subRow } = await supabase
        .from("push_subscriptions")
        .select("consecutive_failures")
        .eq("id", sub.id)
        .single();
      await supabase
        .from("push_subscriptions")
        .update({
          last_failure_at: new Date().toISOString(),
          consecutive_failures: (subRow?.consecutive_failures ?? 0) + 1,
        })
        .eq("id", sub.id);
    }

    // Increment failure count on article
    const { data: art } = await supabase
      .from("articles")
      .select("notification_failed_count")
      .eq("id", articleId)
      .single();

    const count = (art?.notification_failed_count ?? 0) + 1;
    await supabase
      .from("articles")
      .update({ notification_failed_count: count })
      .eq("id", articleId);

    return false;
  }
}

export function buildPushPayload(article: {
  id: string;
  source_type: string;
  title: string;
  title_ja: string | null;
  publisher: string | null;
  published_at: string | null;
  summary: string | null;
  relevance: string;
  is_overseas: boolean;
  source_url: string;
  stock_code: string;
  stock_name: string;
}): PushPayload {
  const sourceLabels: Record<string, string> = {
    tdnet: "TDnet",
    edinet: "EDINET",
    official: "公式",
    jp_news: "国内",
    en_news: "海外",
  };

  const displayTitle = article.is_overseas && article.title_ja
    ? `[${article.title_ja}] ${article.title}`
    : article.title;

  const prefix = [
    sourceLabels[article.source_type] ?? article.source_type,
    article.relevance === "uncertain" ? "【関連不確実】" : "",
    `${article.stock_code} ${article.stock_name}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const body = [
    article.summary?.slice(0, 120) ?? "",
    article.publisher ? `— ${article.publisher}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title: `${prefix}`,
    body: displayTitle + (body ? `\n${body}` : ""),
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    data: {
      articleId: article.id,
      sourceType: article.source_type,
      stockCode: article.stock_code,
      stockName: article.stock_name,
      url: `/article/${article.id}`,
    },
    tag: `article-${article.id}`,
  };
}

export async function generateVapidKeys(): Promise<void> {
  const keys = webpush.generateVAPIDKeys();
  console.log("VAPID Keys generated:");
  console.log("Public:", keys.publicKey);
  console.log("Private:", keys.privateKey);
}

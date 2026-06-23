/**
 * 予備メール通知 (Resend)
 *
 * 通常のニュース配信には使わない。
 * - プッシュ通知が2回連続失敗したときの障害通知
 * - システム復旧通知
 * - 未送信記事の復旧後再送通知
 */

import { Resend } from "resend";

// RESEND_FROM_EMAIL に独自ドメインを設定しない場合は Resend のデフォルト送信元を使用
// 独自ドメイン使用時は Resend ダッシュボードでドメイン認証が必要
const FROM = process.env.RESEND_FROM_EMAIL ?? "開示レーダー <onboarding@resend.dev>";
const TO = process.env.BACKUP_EMAIL!;

type EmailKind = "info" | "error" | "recovery";

const PREFIX: Record<EmailKind, string> = {
  info:     "[開示レーダー]",
  error:    "[開示レーダー障害]",
  recovery: "[開示レーダー復旧]",
};

const LOG_LABEL: Record<EmailKind, string> = {
  info:     "通知メール送信",
  error:    "障害メール送信",
  recovery: "復旧メール送信",
};

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

async function sendEmail(
  kind: EmailKind,
  subject: string,
  body: string
): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.log("[Email] RESEND_API_KEY未設定 — メール送信スキップ:", subject);
    return;
  }
  try {
    await resend.emails.send({
      from: FROM,
      to: TO,
      subject: `${PREFIX[kind]} ${subject}`,
      text: body,
    });
    console.log(`[Email] ${LOG_LABEL[kind]}:`, subject);
  } catch (err) {
    console.error("[Email] 送信失敗:", err);
  }
}

export async function sendErrorEmail(
  subject: string,
  body: string
): Promise<void> {
  await sendEmail("error", subject, body);
}

export async function sendRecoveryEmail(
  source: string,
  recoveredAt: Date
): Promise<void> {
  await sendEmail(
    "recovery",
    `${source} 復旧`,
    `${source} が復旧しました。\n復旧時刻: ${recoveredAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`
  );
}

export async function sendPendingArticlesEmail(
  pendingCount: number
): Promise<void> {
  await sendEmail(
    "error",
    `未送信記事あり: ${pendingCount}件`,
    `プッシュ通知が届かなかった記事が ${pendingCount} 件あります。\nアプリを開いて未読一覧をご確認ください。\n${process.env.NEXT_PUBLIC_APP_URL}`
  );
}

export async function sendWeeklyBackupReport(
  success: boolean,
  details: string
): Promise<void> {
  await sendEmail(
    success ? "info" : "error",
    success ? "週次バックアップ完了" : "週次バックアップ失敗",
    details
  );
}

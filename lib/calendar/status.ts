/**
 * 開示予定カレンダー(新規実装7)
 *
 * DBのstatusは利用者が明示的に設定する'scheduled'/'postponed'のみを保持する。
 * 「開示確認済み」「未確認」は保存せず、記事のリンク有無と現在日から都度導出する
 * (二重管理によるズレを防ぐため)。
 */

export type StoredEventStatus = "scheduled" | "postponed";
export type DisplayEventStatus = "scheduled" | "confirmed" | "postponed" | "unconfirmed";

export const EVENT_STATUS_LABEL: Record<DisplayEventStatus, string> = {
  scheduled: "予定済み",
  confirmed: "開示確認済み",
  postponed: "延期",
  unconfirmed: "未確認",
};

export interface StockEventInput {
  scheduled_date: string; // YYYY-MM-DD
  status: StoredEventStatus;
  linked_article_id: string | null;
}

export function deriveEventStatus(event: StockEventInput, now: number = Date.now()): DisplayEventStatus {
  if (event.linked_article_id) return "confirmed";
  if (event.status === "postponed") return "postponed";
  const isPast = new Date(event.scheduled_date).getTime() < now;
  return isPast ? "unconfirmed" : "scheduled";
}

// 記事のevent_type(lib/classifiers/event-type.ts)とカレンダーevent_typeの対応。
// 一致するevent_typeの記事だけを自動リンク候補とする(誤リンクを避けるため)。
export const CALENDAR_TO_ARTICLE_EVENT_TYPE: Record<string, string> = {
  earnings: "earnings",
  agm: "agm",
  dividend_record: "dividend",
};

const AUTO_LINK_WINDOW_DAYS = 10;

/**
 * 記事が予定イベントの「該当記事」として自動リンクできるかを判定する。
 * (株価判断は行わない。日付・開示種別の一致のみで機械的に判定する)
 */
export function isAutoLinkCandidate(
  event: { event_type: string; scheduled_date: string; status: StoredEventStatus; linked_article_id: string | null },
  article: { event_type: string | null; published_at: string | null },
  now: number = Date.now()
): boolean {
  if (event.linked_article_id) return false;
  if (event.status === "postponed") return false;
  if (deriveEventStatus(event, now) === "confirmed") return false;

  const expectedArticleType = CALENDAR_TO_ARTICLE_EVENT_TYPE[event.event_type];
  if (!expectedArticleType || article.event_type !== expectedArticleType) return false;
  if (!article.published_at) return false;

  const diffDays = Math.abs(
    (new Date(article.published_at).getTime() - new Date(event.scheduled_date).getTime()) / (24 * 60 * 60 * 1000)
  );
  return diffDays <= AUTO_LINK_WINDOW_DAYS;
}

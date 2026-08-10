/**
 * 銘柄別情報源カバレッジ(新規実装5)
 *
 * 銘柄×情報源ごとの状態を5区分に分類する:
 *   正常 / 新着なし / 未設定 / 取得失敗 / 長期間更新なし
 */

export type CoverageStatus = "normal" | "no_new" | "not_configured" | "fetch_failed" | "long_quiet";

export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  normal: "正常",
  no_new: "新着なし",
  not_configured: "未設定",
  fetch_failed: "取得失敗",
  long_quiet: "長期間更新なし",
};

export interface CoverageInput {
  is_configured: boolean;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_article_at: string | null;
  consecutive_failures: number;
}

const FAILURE_THRESHOLD = 2;
const RECENT_ARTICLE_DAYS = 3;
const LONG_QUIET_DAYS = 30;

function daysSince(iso: string | null, now: number): number {
  if (!iso) return Infinity;
  return (now - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
}

export function deriveCoverageStatus(input: CoverageInput, now: number = Date.now()): CoverageStatus {
  if (!input.is_configured) return "not_configured";
  if (!input.last_checked_at) return "not_configured";
  if (input.consecutive_failures >= FAILURE_THRESHOLD) return "fetch_failed";

  const articleAge = daysSince(input.last_article_at, now);
  if (articleAge > LONG_QUIET_DAYS) return "long_quiet";
  if (articleAge <= RECENT_ARTICLE_DAYS) return "normal";
  return "no_new";
}

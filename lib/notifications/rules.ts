/**
 * 詳細な通知ルール(新規実装3)
 *
 * 銘柄・重要度・開示種別・情報源・キーワードを組み合わせた条件で、
 * 記事ごとに「即時通知/保存のみ(通知しない)/通知しない」を判定する。
 * 条件がnullの項目はその条件で絞り込まない(=どの値にもマッチする)。
 */

export interface NotificationRule {
  id: string;
  stock_id: string | null;
  importance: string | null;
  event_type: string | null;
  source_type: string | null;
  keyword: string | null;
  action: "notify" | "save_only" | "no_notify";
  priority: number;
}

export interface RuleTarget {
  stock_id: string;
  importance: string | null;
  event_type: string | null;
  source_type: string;
  title: string;
}

function matchesRule(rule: NotificationRule, target: RuleTarget): boolean {
  if (rule.stock_id && rule.stock_id !== target.stock_id) return false;
  if (rule.importance && rule.importance !== target.importance) return false;
  if (rule.event_type && rule.event_type !== target.event_type) return false;
  if (rule.source_type && rule.source_type !== target.source_type) return false;
  if (rule.keyword && !target.title.toLowerCase().includes(rule.keyword.toLowerCase())) return false;
  return true;
}

function specificity(rule: NotificationRule): number {
  return [rule.stock_id, rule.importance, rule.event_type, rule.source_type, rule.keyword].filter(
    (v) => v !== null && v !== undefined
  ).length;
}

/**
 * 一致するルールのうち、優先度(priority降順)→具体性(条件数降順)で最も優先されるものを返す。
 * 一致するルールが無ければnull(呼び出し側は既存の既定動作にフォールバックする)。
 */
export function resolveNotificationRule(
  rules: NotificationRule[],
  target: RuleTarget
): NotificationRule | null {
  const matching = rules.filter((r) => matchesRule(r, target));
  if (matching.length === 0) return null;

  matching.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return specificity(b) - specificity(a);
  });
  return matching[0];
}

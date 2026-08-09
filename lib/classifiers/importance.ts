/**
 * 重要度分類 (3段階: 最重要/重要/通常)
 *
 * 開示カテゴリ・内容の機械的な分類であり、投資判断(買い/売り推奨等)や
 * 記事の自動要約ではない。あくまで「情報の整理」を目的とする。
 *
 * 判定方法:
 *   1. ルール(TDnet文書種別・EDINETコード・タイトル/概要のキーワード規則) — 既定
 *   2. ルールだけでは「規模」が判断できないごく一部のカテゴリ(自己株取得の
 *      規模、赤字・特別損失の規模)のみ、AIで開示カテゴリとしての規模感を
 *      補助判定する(株価への影響や売買判断は一切問わない)
 *   3. ユーザーによる手動上書き
 */

import { callGemini } from "../ai/gemini";

export type ImportanceTier = "critical" | "important" | "normal";

export const IMPORTANCE_LABELS: Record<ImportanceTier, string> = {
  critical: "最重要",
  important: "重要",
  normal: "通常",
};

export const IMPORTANCE_TIERS: ImportanceTier[] = ["critical", "important", "normal"];

export function importanceLabel(tier: string | null | undefined): string {
  if (!tier) return "";
  return IMPORTANCE_LABELS[tier as ImportanceTier] ?? tier;
}

export interface ImportanceResult {
  tier: ImportanceTier;
  reason: string;
  source: "rule" | "ai";
}

// ============================
// ルールベース分類
// ============================

const CRITICAL_RULES: [RegExp, string][] = [
  [/業績予想.*(上方修正|下方修正)|上方修正|下方修正/, "業績予想の上方・下方修正"],
  [/無配|減配|増配|配当予想.*(修正|変更)/, "配当変更・無配・増配"],
  [/TOB|公開買付|合併|会社分割|株式交換|株式移転|経営統合/i, "TOB・M&A・会社分割"],
  [/行政処分|課徴金|業務停止命令|不祥事|訴訟|提訴|損害賠償請求/, "行政処分・不祥事・訴訟"],
  [/代表取締役.*(社長)?.*(交代|辞任|退任|解任|新任|就任)|新社長|新CEO|CEO交代/, "代表者変更"],
  [/上場廃止|監理銘柄|整理銘柄/, "上場廃止・監理銘柄関連"],
];

const IMPORTANT_RULES: [RegExp, string][] = [
  [/決算短信/, "決算短信"],
  [/月次売上|月次業績|月次動向/, "月次業績"],
  [/資本業務提携|業務提携|資本提携|戦略的提携/, "資本・業務提携"],
  [/大口契約|大型契約|大口受注/, "大口契約"],
  [/新工場|工場新設|生産停止|生産再開|工場稼働/, "新工場・生産停止"],
  [/株主総会/, "株主総会"],
  [/株式分割/, "株式分割"],
  [/格付.*(変更|引き上げ|引き下げ|見直し)|格付会社/, "格付変更"],
  [/子会社化|子会社(の)?異動|子会社(の)?移管/, "主要子会社の変更"],
  [/自己株式|自社株買い/, "自己株式取得"],
  [/特別損失|最終赤字|純損失|営業損失/, "赤字・特別損失"],
];

/**
 * ルールだけでは「規模」が判定できず、AIによる補助判定が有効なカテゴリ。
 * (自己株取得は少額のことも多く、赤字/特別損失も軽微〜甚大まで幅があるため)
 */
function needsMagnitudeCheck(title: string, summary: string | null | undefined): boolean {
  const text = `${title} ${summary ?? ""}`;
  return /自己株式|自社株買い|特別損失|最終赤字|純損失|営業損失/.test(text);
}

function classifyByRules(
  title: string,
  summary: string | null | undefined
): { tier: ImportanceTier; reason: string } | null {
  const text = `${title} ${summary ?? ""}`;
  for (const [pattern, reason] of CRITICAL_RULES) {
    if (pattern.test(text)) return { tier: "critical", reason };
  }
  for (const [pattern, reason] of IMPORTANT_RULES) {
    if (pattern.test(text)) return { tier: "important", reason };
  }
  return null;
}

// EDINET書類種別コード → 重要度ベースライン
const EDINET_IMPORTANCE_MAP: Record<string, { tier: ImportanceTier; reason: string }> = {
  "070": { tier: "critical", reason: "公開買付届出書" },
  "072": { tier: "critical", reason: "公開買付撤回届出書" },
  "080": { tier: "critical", reason: "意見表明報告書" },
  "050": { tier: "important", reason: "大量保有報告書" },
  "051": { tier: "important", reason: "大量保有報告書(短期)" },
  "053": { tier: "important", reason: "変更報告書" },
  "020": { tier: "important", reason: "有価証券報告書" },
  "030": { tier: "important", reason: "半期報告書" },
  "040": { tier: "important", reason: "四半期報告書" },
};

/**
 * AIによる「規模」補助判定。株価への影響や売買判断は問わず、
 * 記事に書かれている数値・表現から開示の規模感(軽微〜甚大)のみを判定する。
 */
async function checkMagnitudeByAI(
  title: string,
  summary: string | null,
  baseReason: string
): Promise<{ tier: ImportanceTier; reason: string }> {
  const prompt = `次の企業開示・ニュース記事について、内容に記載されている規模感だけを基準に重要度を3段階で分類してください。株価が上がるか下がるか、売買すべきかどうかは一切判断しないでください。

記事タイトル: ${title}
記事概要: ${summary ?? "(概要なし)"}

以下のJSON形式のみで回答してください:
{"tier": "critical"|"important"|"normal", "reason": "判定理由（30文字以内、規模を示す記述に基づくこと）"}

判定基準（開示の規模感のみで判定。投資判断は行わない）:
- "critical": 記事本文の記述から、会社全体の業績・財務に及ぼす影響が大きいと読み取れる(例: 大幅な赤字転落、発行済株式の相当割合を占める自己株取得等)
- "important": 相応の規模だが会社全体を揺るがすほどではないと読み取れる
- "normal": 記載内容が軽微、または規模を判断できる記述が無い`;

  const { text, error } = await callGemini(prompt, 150);
  if (!text) {
    console.error("[Importance] AI規模判定失敗:", error);
    return { tier: "important", reason: baseReason };
  }

  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    if (!IMPORTANCE_TIERS.includes(parsed.tier)) {
      return { tier: "important", reason: baseReason };
    }
    return { tier: parsed.tier as ImportanceTier, reason: parsed.reason ?? baseReason };
  } catch (err) {
    console.error("[Importance] AI応答のパース失敗:", err, text);
    return { tier: "important", reason: baseReason };
  }
}

/**
 * 記事の重要度を分類する統合エントリポイント。
 * TDnet/EDINETの構造化データを優先し、次にタイトル/概要のキーワード規則、
 * 最後にごく一部のカテゴリのみAIで規模を補助判定する。
 */
export async function classifyImportance(params: {
  title: string;
  summary?: string | null;
  edinetDocTypeCode?: string | null;
  isSafeSource: boolean;
}): Promise<ImportanceResult> {
  // 1. EDINET構造化データ (最も確実)
  if (params.edinetDocTypeCode) {
    const edinetMatch = EDINET_IMPORTANCE_MAP[params.edinetDocTypeCode];
    if (edinetMatch) return { ...edinetMatch, source: "rule" };
  }

  // 2. タイトル/概要のキーワード規則
  const ruleMatch = classifyByRules(params.title, params.summary);
  if (ruleMatch) {
    // 規模判断が必要なカテゴリ(自己株取得・赤字系)は、AIで規模感を補助判定する
    if (needsMagnitudeCheck(params.title, params.summary)) {
      const aiResult = await checkMagnitudeByAI(params.title, params.summary ?? null, ruleMatch.reason);
      return { ...aiResult, source: "ai" };
    }
    return { ...ruleMatch, source: "rule" };
  }

  // 3. 既定値: 安全ソース(TDnet/EDINET/公式)は「重要」、それ以外(一般ニュース・PR)は「通常」
  return params.isSafeSource
    ? { tier: "important", reason: "公式開示(種別未分類)", source: "rule" }
    : { tier: "normal", reason: "", source: "rule" };
}

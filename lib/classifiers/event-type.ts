/**
 * 開示種別の機械的分類 (要約・投資判断ではなく情報整理のための分類)
 *
 * 優先順位:
 *   1. EDINET書類種別コード (最も構造化されたデータ)
 *   2. TDnet文書種別 (extractDocType の結果、タイトルから抽出済み)
 *   3. タイトル・概要のキーワード規則 (国内/海外ニュース・PR TIMES用のフォールバック)
 */

export type EventType =
  | "earnings"
  | "guidance_revision"
  | "dividend"
  | "treasury_stock"
  | "ma_tob"
  | "alliance"
  | "personnel"
  | "agm"
  | "legal_regulatory"
  | "product_service"
  | "other";

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  earnings: "決算",
  guidance_revision: "業績予想修正",
  dividend: "配当",
  treasury_stock: "自己株式",
  ma_tob: "M&A・TOB",
  alliance: "資本・業務提携",
  personnel: "人事",
  agm: "株主総会",
  legal_regulatory: "訴訟・行政処分",
  product_service: "製品・サービス",
  other: "その他",
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS) as EventType[];

export function eventTypeLabel(type: string | null | undefined): string {
  if (!type) return "";
  return EVENT_TYPE_LABELS[type as EventType] ?? type;
}

// EDINET書類種別コード → event_type
// (参考: lib/fetchers/edinet.ts の docTypeLabel と対応表)
const EDINET_CODE_MAP: Record<string, EventType> = {
  "010": "other",              // 有価証券届出書
  "020": "earnings",           // 有価証券報告書
  "030": "earnings",           // 半期報告書
  "040": "earnings",           // 四半期報告書
  "043": "other",              // 臨時報告書 (内容が多岐にわたるためタイトル規則に譲る)
  "044": "other",              // 訂正臨時報告書
  "050": "ma_tob",             // 大量保有報告書
  "051": "ma_tob",             // 大量保有報告書(短期)
  "052": "ma_tob",
  "053": "ma_tob",             // 変更報告書
  "054": "ma_tob",
  "055": "ma_tob",
  "070": "ma_tob",             // 公開買付届出書
  "072": "ma_tob",             // 公開買付撤回届出書
  "080": "ma_tob",             // 意見表明報告書
  "090": "ma_tob",             // 対質問回答報告書
};

export function classifyFromEdinetCode(docTypeCode: string | null | undefined): EventType | null {
  if (!docTypeCode) return null;
  return EDINET_CODE_MAP[docTypeCode] ?? null;
}

// TDnet文書種別 (lib/fetchers/tdnet.ts の extractDocType が返す日本語ラベル) → event_type
const TDNET_DOC_TYPE_MAP: Record<string, EventType> = {
  "決算短信": "earnings",
  "業績予想修正": "guidance_revision",
  "配当": "dividend",
  "自己株式取得": "treasury_stock",
  "株式分割": "other",
  "増資": "other",
  "新株予約権": "other",
  "TOB/公開買付": "ma_tob",
  "M&A": "ma_tob",
  "資本業務提携": "alliance",
  "受注・契約": "product_service",
  "訂正": "other",
  "株主総会": "agm",
  "訴訟": "legal_regulatory",
  "行政処分": "legal_regulatory",
};

export function classifyFromTdnetDocType(docType: string | null | undefined): EventType | null {
  if (!docType) return null;
  return TDNET_DOC_TYPE_MAP[docType] ?? null;
}

// タイトル・概要のキーワード規則 (国内/海外ニュース・PR TIMES向けフォールバック)
// 上から順に判定し、最初に一致したものを採用する。
const TEXT_RULES: [RegExp, EventType][] = [
  [/決算短信|決算発表|決算説明会|四半期決算|通期決算|純利益|営業利益|経常利益|売上高/, "earnings"],
  [/業績予想|上方修正|下方修正/, "guidance_revision"],
  [/配当|自己株式|自社株買い|株式分割/, "dividend"],
  [/TOB|公開買付|買収|合併|子会社化|M&A/i, "ma_tob"],
  [/資本提携|業務提携|資本業務提携|戦略的提携/, "alliance"],
  [/代表取締役|取締役.*(選任|退任|異動)|人事異動|役員人事|新社長|CEO交代/, "personnel"],
  [/株主総会/, "agm"],
  [/訴訟|提訴|行政処分|課徴金|リコール|不祥事|品質問題/, "legal_regulatory"],
  [/新製品|新サービス|発売|リリース|提供開始|受注|契約締結/, "product_service"],
];

export function classifyFromText(title: string, summary?: string | null): EventType {
  const text = `${title} ${summary ?? ""}`;
  for (const [pattern, type] of TEXT_RULES) {
    if (pattern.test(text)) return type;
  }
  return "other";
}

/**
 * 記事の各種メタデータから開示種別を分類する統合エントリポイント。
 */
export function classifyEventType(params: {
  title: string;
  summary?: string | null;
  tdnetDocType?: string | null;
  edinetDocTypeCode?: string | null;
}): EventType {
  return (
    classifyFromEdinetCode(params.edinetDocTypeCode) ??
    classifyFromTdnetDocType(params.tdnetDocType) ??
    classifyFromText(params.title, params.summary)
  );
}

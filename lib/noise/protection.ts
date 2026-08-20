/**
 * 保護キーワード (Phase 3.3)
 *
 * これらのキーワードが記事に含まれる場合、ノイズルールに一致しても
 * 完全除外せず「関連確実/関連不確実」として残す。
 * 企業IR・公式発表・企業リスク情報を誤って消さないための安全装置。
 *
 * worker / reclassify API / CLI スクリプトで共通利用する。
 */

// 全銘柄共通の保護キーワード
//
// 誤判定防止の設計原則:
//   - "決算" 単独は除外: "大決算セール" で保護扱いになるため、複合語のみ使用
//   - "IR" 単独は除外: 英語テキストの部分一致 (firm/first 等) を防ぐため複合語
//   - "生産" 単独は除外: "生産終了の中古品" で保護扱いになるため複合語
//   - "契約" 単独は除外: "契約更改"(野球ノイズKW) を保護してしまうため削除
//   - "公式" 単独は含まない: "公式発表" の形で既に登録済み
export const GLOBAL_PROTECT_KEYWORDS: string[] = [
  // 決算・業績開示 (複合語で "大決算セール" との誤判定を防止)
  "決算短信", "決算発表", "決算説明会", "四半期決算", "通期決算",
  // IR・適時開示 (複合語で英語部分一致を防止)
  "IR情報", "IR資料", "IR発表", "適時開示", "TDnet", "EDINET",
  "有価証券報告書", "臨時報告書",
  // 株主・資本アクション
  "大量保有", "TOB", "公開買付", "配当", "自己株", "株式分割", "増資",
  // 業績修正
  "下方修正", "上方修正", "業績予想",
  // M&A・提携
  "M&A", "買収", "資本提携", "業務提携",
  // 企業構造
  "子会社",
  // リスク・法的
  "行政処分", "訴訟", "不祥事", "リコール", "製品安全", "品質問題",
  // 生産・操業 (複合語で "生産終了の中古品" 等との誤判定を防止)
  "生産停止", "生産台数", "生産ライン", "生産計画",
  // 工場・施設
  "工場",
  // 販売・事業
  "販売台数", "受注", "公式発表", "プレスリリース",
  // 財務指標・経営
  "株主総会", "株価", "業績", "純利益", "営業利益", "経常利益", "売上高",
  "格付", "出資", "売却", "譲渡", "経営", "代表取締役", "ガバナンス",
];

const SAFE_SOURCE_TYPES = new Set(["tdnet", "edinet", "official", "sec_edgar"]);

/**
 * 安全ソースか判定 (TDnet/EDINET/公式は絶対除外しない)
 */
export function isSafeSource(sourceType: string): boolean {
  return SAFE_SOURCE_TYPES.has(sourceType);
}

/**
 * 保護キーワードに一致するか判定
 * @param extraProtect DBの strengthen ルール由来の追加保護語 (コード側と重複可、Set で統合)
 * @returns マッチしたキーワード or null
 */
export function matchesProtection(
  title: string,
  summary: string | null | undefined,
  extraProtect: string[] = []
): string | null {
  const text = (title + " " + (summary ?? "")).toLowerCase();
  // GLOBAL_PROTECT_KEYWORDS とDB由来extraProtectをSetで重複排除
  const uniqueKw = new Set([
    ...GLOBAL_PROTECT_KEYWORDS.map((k) => k.toLowerCase()),
    ...extraProtect.map((k) => k.toLowerCase()),
  ]);
  for (const kw of uniqueKw) {
    if (text.includes(kw)) return kw;
  }
  return null;
}

/**
 * 保護キーワードのユニーク件数を返す (ログ用)
 */
export function uniqueProtectCount(extraProtect: string[] = []): number {
  return new Set([
    ...GLOBAL_PROTECT_KEYWORDS.map((k) => k.toLowerCase()),
    ...extraProtect.map((k) => k.toLowerCase()),
  ]).size;
}

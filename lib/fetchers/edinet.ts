/**
 * EDINET API v2 取得
 *
 * 公式 API: https://api.edinet-fsa.go.jp/api/v2/
 * 仕様書: https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/download/ESE140206.pdf
 *
 * 対象銘柄に関係する書類を取得する。
 * - 提出者が対象銘柄の場合 (secCode一致)
 * - 第三者提出で対象銘柄が対象会社の場合 (大量保有報告書など)
 */

export interface EdinetItem {
  docId: string;
  edinetCode: string;
  secCode: string | null;
  filerName: string;
  docDescription: string;
  docTypeCode: string;
  periodStart: string | null;
  periodEnd: string | null;
  submitDateTime: Date;
  pdfUrl: string | null;
  xbrlUrl: string | null;
  isAmendment: boolean;
  isTargetCompanyDoc: boolean;
}

const EDINET_BASE = "https://api.edinet-fsa.go.jp/api/v2";

function edinetHeaders(): Record<string, string> {
  const key = process.env.EDINET_API_KEY;
  return {
    "User-Agent": "KaijiRadar/1.0 (+https://github.com/roromukuro/kaiji-radar)",
    ...(key ? { "Ocp-Apim-Subscription-Key": key } : {}),
  };
}

// docTypeCodes that are especially important to capture for third-party filings
const THIRD_PARTY_DOC_TYPES = new Set([
  "050", // 大量保有報告書
  "051", // 大量保有報告書（短期大量譲渡）
  "052", // 大量保有報告書（特例対象株券等）
  "053", // 変更報告書
  "054", // 変更報告書（短期大量譲渡）
  "055", // 変更報告書（特例対象株券等）
  "070", // 公開買付届出書
  "072", // 公開買付撤回届出書
  "080", // 意見表明報告書
  "090", // 対質問回答報告書
]);

export async function fetchEdinetByDate(
  date: Date,
  targetSecCodes: string[]
): Promise<EdinetItem[]> {
  const dateStr = date.toISOString().split("T")[0];
  const targetSet = new Set(targetSecCodes.map(normalizeSecCode));

  try {
    const url = `${EDINET_BASE}/documents.json?date=${dateStr}&type=2`;
    const res = await fetch(url, {
      headers: edinetHeaders(),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      throw new Error(`EDINET API HTTP ${res.status}`);
    }

    const data = await res.json();
    const results: EdinetItem[] = [];

    for (const doc of data?.results ?? []) {
      const docSecCode = normalizeSecCode(doc.secCode ?? "");
      const isDirectMatch = docSecCode && targetSet.has(docSecCode);

      // Also capture third-party filings where target company is in our list
      const isThirdPartyForTarget =
        !isDirectMatch &&
        THIRD_PARTY_DOC_TYPES.has(doc.docTypeCode) &&
        docSecCode &&
        targetSet.has(docSecCode);

      if (!isDirectMatch && !isThirdPartyForTarget) continue;

      const submitDateTime = new Date(doc.submitDateTime ?? dateStr);

      const pdfUrl = doc.hasPdf === "1" || doc.hasPdf === 1
        ? `${EDINET_BASE}/documents/${doc.docID}?type=3`
        : null;
      const xbrlUrl = doc.hasXbrl === "1" || doc.hasXbrl === 1
        ? `${EDINET_BASE}/documents/${doc.docID}?type=1`
        : null;

      results.push({
        docId: doc.docID,
        edinetCode: doc.edinetCode ?? "",
        secCode: doc.secCode ?? null,
        filerName: doc.filerName ?? "",
        docDescription: doc.docDescription ?? "",
        docTypeCode: doc.docTypeCode ?? "",
        periodStart: doc.periodStart ?? null,
        periodEnd: doc.periodEnd ?? null,
        submitDateTime,
        pdfUrl,
        xbrlUrl,
        isAmendment: doc.docTypeCode?.startsWith("9") ?? false,
        isTargetCompanyDoc: !!isThirdPartyForTarget,
      });
    }

    return results;
  } catch (err) {
    console.error(`[EDINET] 取得失敗 ${dateStr}:`, err);
    throw err;
  }
}

export async function fetchEdinetDateRange(
  startDate: Date,
  endDate: Date,
  targetSecCodes: string[]
): Promise<EdinetItem[]> {
  const results: EdinetItem[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    // Skip weekends (EDINET submissions unlikely, but still check)
    try {
      const items = await fetchEdinetByDate(current, targetSecCodes);
      results.push(...items);
    } catch (err) {
      console.error(`[EDINET] ${current.toISOString().split("T")[0]} 取得エラー:`, err);
    }

    // Wait 500ms between requests to be polite
    await new Promise((r) => setTimeout(r, 500));
    current.setDate(current.getDate() + 1);
  }

  return results;
}

// sec_code from EDINET is 5 digits (e.g. "67580"), we normalise to 4+1
function normalizeSecCode(code: string): string {
  if (!code) return "";
  return code.trim().replace(/\s/g, "");
}

// Convert 4-digit stock code to 5-digit sec_code (e.g. "6758" → "67580")
export function stockCodeToSecCode(code: string): string {
  return code.padEnd(5, "0");
}

export function secCodeToStockCode(secCode: string): string {
  return secCode.slice(0, 4);
}

export function docTypeLabel(code: string): string {
  const map: Record<string, string> = {
    "010": "有価証券届出書",
    "020": "有価証券報告書",
    "030": "半期報告書",
    "040": "四半期報告書",
    "043": "臨時報告書",
    "044": "訂正臨時報告書",
    "050": "大量保有報告書",
    "051": "大量保有報告書(短期)",
    "053": "変更報告書",
    "070": "公開買付届出書",
    "072": "公開買付撤回届出書",
    "080": "意見表明報告書",
    "090": "対質問回答報告書",
  };
  return map[code] ?? `書類コード${code}`;
}

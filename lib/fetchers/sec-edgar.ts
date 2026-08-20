/**
 * SEC EDGAR 取得 (米国株の一次情報)
 *
 * TDnet/EDINETの米国版に相当する、米証券取引委員会(SEC)の公式開示システム。
 * API仕様: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
 * 無料・APIキー不要。ただしSECのフェアユースポリシーにより
 * リクエストごとに連絡先を含むUser-Agentの送信が必須。
 *
 * CIK(Central Index Key)単位で企業ごとの提出書類一覧を取得する
 * (TDnet/EDINETと違い日付横断の全銘柄検索APIではなく、銘柄=CIK単位のAPI)。
 */

export interface SecEdgarItem {
  accessionNumber: string;
  form: string;
  filingDate: Date;
  reportDate: string | null;
  items: string;
  primaryDocDescription: string;
  url: string;
}

// 個人の役員株式売買届出(Form 3/4/5)等は頻度が高く「重要開示」の趣旨に合わないため対象外。
// TDnet/EDINETに相当する「重要な適時開示」「定期報告書」「大量保有」のみを拾う。
const RELEVANT_FORMS = new Set([
  "8-K", "8-K/A",
  "10-K", "10-K/A",
  "10-Q", "10-Q/A",
  "DEF 14A",
  "SC 13D", "SC 13D/A",
  "SC 13G", "SC 13G/A",
  "6-K", "6-K/A",
]);

function secEdgarHeaders(): Record<string, string> {
  const contact = process.env.BACKUP_EMAIL ?? "contact@example.com";
  return { "User-Agent": `KaijiRadar/1.0 (${contact})` };
}

export function formLabel(form: string): string {
  const map: Record<string, string> = {
    "8-K": "臨時報告(重要事象)",
    "8-K/A": "臨時報告(訂正)",
    "10-K": "年次報告書",
    "10-K/A": "年次報告書(訂正)",
    "10-Q": "四半期報告書",
    "10-Q/A": "四半期報告書(訂正)",
    "DEF 14A": "株主総会招集通知",
    "SC 13D": "大量保有報告(能動的)",
    "SC 13D/A": "大量保有報告(能動的・変更)",
    "SC 13G": "大量保有報告(受動的)",
    "SC 13G/A": "大量保有報告(受動的・変更)",
    "6-K": "臨時報告(外国私募発行体)",
    "6-K/A": "臨時報告(外国私募発行体・訂正)",
  };
  return map[form] ?? form;
}

export async function fetchSecEdgarFilings(cik: string, since: Date): Promise<SecEdgarItem[]> {
  const paddedCik = cik.padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

  const res = await fetch(url, {
    headers: secEdgarHeaders(),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`SEC EDGAR API HTTP ${res.status}`);

  const data = await res.json();
  const recent = data?.filings?.recent;
  if (!recent?.form) return [];

  const cikNumeric = String(parseInt(cik, 10));
  const results: SecEdgarItem[] = [];

  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i];
    if (!RELEVANT_FORMS.has(form)) continue;

    const filingDate = new Date(recent.filingDate[i]);
    if (filingDate < since) continue;

    const accessionNumber = recent.accessionNumber[i];
    const accNoDash = accessionNumber.replace(/-/g, "");
    const primaryDocument = recent.primaryDocument[i];
    const url = primaryDocument
      ? `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${accNoDash}/${primaryDocument}`
      : `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${accNoDash}/`;

    results.push({
      accessionNumber,
      form,
      filingDate,
      reportDate: recent.reportDate?.[i] || null,
      items: recent.items?.[i] ?? "",
      primaryDocDescription: recent.primaryDocDescription?.[i] ?? "",
      url,
    });
  }

  return results;
}

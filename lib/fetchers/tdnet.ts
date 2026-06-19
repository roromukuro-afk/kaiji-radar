/**
 * TDnet 適時開示取得
 *
 * 一次ソース: やのしん WEB-API (https://webapi.yanoshin.jp/webapi/tdnet/)
 * フォールバック: Yahoo Finance Japan (https://finance.yahoo.co.jp/quote/{code}.T/disclosure)
 *   - yanoshin が GitHub Actions IP をブロックする場合に使用
 *   - Yahoo Finance Japan は SSR でページ内に開示データを含むため HTML スクレイピング可能
 *   - TDnet docId = "1401" + Yahoo 14桁ファイルID で復元可能
 *
 * 参考: やのしん WEB-API は 2007 年から公開され実績ある非公式 API。
 * 公式 TDnet API は月額 7 万円超のため採用外。
 *
 * 注: undici (Node fetch) の connectTimeout がデフォルト 10s で yanoshin に届かない。
 * Node.js 組み込みの https.get() を使用することで回避。
 */

import https from "https";
import { XMLParser } from "fast-xml-parser";

export interface TdnetItem {
  docId: string;
  code: string;
  title: string;
  publishedAt: Date;
  url: string;
  pdfUrl: string | null;
  submitter: string;
  docType: string | null;
}

const YANOSHIN_BASE = "https://webapi.yanoshin.jp/webapi/tdnet/list";
const UA = "KaijiRadar/1.0 (+https://github.com/roromukuro/kaiji-radar)";
const UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function httpsGet(url: string, timeoutMs = 8000, browserUa = false): Promise<string> {
  const ua = browserUa ? UA_BROWSER : UA;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": ua, "Accept-Language": "ja,en;q=0.9" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        req.destroy();
        httpsGet(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      if (!res.statusCode || res.statusCode >= 400) {
        req.destroy();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
  });
}

async function fetchRss(url: string): Promise<any[]> {
  const xml = await httpsGet(url);
  const parsed = xmlParser.parse(xml);
  const items = parsed?.rss?.channel?.item ?? [];
  return Array.isArray(items) ? items : [items];
}

export async function fetchTdnetByCode(
  code: string,
  since?: Date
): Promise<TdnetItem[]> {
  const url = `${YANOSHIN_BASE}/${code}.rss`;
  try {
    const rawItems = await fetchRss(url);
    const items: TdnetItem[] = [];

    for (const item of rawItems) {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      if (since && pubDate <= since) continue;

      const link = item.link ?? item.guid ?? "";
      const docId = extractTdnetDocId(link);
      const pdfUrl = extractTdnetPdfUrl(link);

      items.push({
        docId: docId ?? `tdnet-${code}-${pubDate.getTime()}`,
        code,
        title: item.title ?? "(タイトルなし)",
        publishedAt: pubDate,
        url: link,
        pdfUrl,
        submitter: "",
        docType: extractDocType(item.title ?? ""),
      });
    }
    return items;
  } catch (err) {
    console.error(`[TDnet] やのしん RSS 取得失敗 ${code}:`, err);
    return fetchTdnetByCodeDirect(code, since);
  }
}

export async function fetchTdnetRecent(since: Date): Promise<TdnetItem[]> {
  const url = `${YANOSHIN_BASE}/recent.rss`;
  try {
    const rawItems = await fetchRss(url);
    const items: TdnetItem[] = [];

    for (const item of rawItems) {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      if (pubDate <= since) continue;

      const link = item.link ?? item.guid ?? "";
      const docId = extractTdnetDocId(link);
      const codeMatch = link.match(/\/(\d{4})\//);
      const code = codeMatch?.[1] ?? "";

      items.push({
        docId: docId ?? `tdnet-${code}-${pubDate.getTime()}`,
        code,
        title: item.title ?? "(タイトルなし)",
        publishedAt: pubDate,
        url: link,
        pdfUrl: extractTdnetPdfUrl(link),
        submitter: item["dc:creator"] ?? "",
        docType: extractDocType(item.title ?? ""),
      });
    }
    return items;
  } catch (err) {
    console.error("[TDnet] recent RSS 取得失敗:", err);
    return [];
  }
}

// Yahoo Finance Japan の適時開示ページからスクレイプ
// yanoshin が GitHub Actions IP をブロックする場合のフォールバック
// URL: https://finance.yahoo.co.jp/quote/{code}.T/disclosure
// TDnet docId = "1401" + Yahoo 14桁ファイルID で復元
export async function fetchTdnetByCodeDirect(
  code: string,
  since?: Date
): Promise<TdnetItem[]> {
  try {
    const url = `https://finance.yahoo.co.jp/quote/${code}.T/disclosure`;
    const html = await httpsGet(url, 20000, true);
    return parseYahooFinanceHtml(html, code, since);
  } catch (err) {
    console.error(`[TDnet] Yahoo Finance 取得失敗 ${code}:`, err);
    return [];
  }
}

function parseYahooFinanceHtml(html: string, code: string, since?: Date): TdnetItem[] {
  const items: TdnetItem[] = [];
  const articleRegex = /<article[^>]*>[\s\S]*?<\/article>/g;
  let match;

  while ((match = articleRegex.exec(html)) !== null) {
    const art = match[0];
    if (!art.includes("TDnet")) continue;

    const hrefMatch = art.match(/href="(https:\/\/finance-frontend[^"]+\.pdf)"/);
    const titleMatch = art.match(/<h3[^>]*>([^<]+)<\/h3>/);
    const dateMatch = art.match(/dateTime="([^"]+)"/);

    if (!hrefMatch || !titleMatch || !dateMatch) continue;

    const pubDate = new Date(dateMatch[1]);
    if (since && pubDate <= since) continue;

    const pdfUrl = hrefMatch[1];
    const fileMatch = pdfUrl.match(/\/(\d+)\.pdf$/);
    const yahooDocId = fileMatch?.[1];
    // TDnet 18桁 docId = "1401" + Yahoo 14桁ファイルID
    const docId =
      yahooDocId && yahooDocId.length === 14
        ? `1401${yahooDocId}`
        : yahooDocId ?? `yahoo-${code}-${pubDate.getTime()}`;

    const title = titleMatch[1].trim();

    items.push({
      docId,
      code,
      title,
      publishedAt: pubDate,
      url: pdfUrl,
      pdfUrl,
      submitter: "",
      docType: extractDocType(title),
    });
  }
  return items;
}


function extractTdnetDocId(url: string): string | null {
  const match = url.match(/(\d{18})/);
  return match?.[1] ?? null;
}

function extractTdnetPdfUrl(pageUrl: string): string | null {
  if (pageUrl.endsWith(".pdf")) return pageUrl;
  const docId = extractTdnetDocId(pageUrl);
  if (!docId) return null;
  return `https://www.release.tdnet.info/inbs/${docId}.pdf`;
}

function extractDocType(title: string): string | null {
  const patterns = [
    ["決算短信", "決算短信"],
    ["業績予想", "業績予想修正"],
    ["配当", "配当"],
    ["自己株式", "自己株式取得"],
    ["株式分割", "株式分割"],
    ["増資", "増資"],
    ["新株予約権", "新株予約権"],
    ["公開買付", "TOB/公開買付"],
    ["M&A|合併|買収|子会社化", "M&A"],
    ["資本業務提携", "資本業務提携"],
    ["受注|契約", "受注・契約"],
    ["訂正", "訂正"],
    ["株主総会", "株主総会"],
    ["訴訟", "訴訟"],
    ["行政処分", "行政処分"],
  ];
  for (const [pattern, label] of patterns) {
    if (new RegExp(pattern).test(title)) return label;
  }
  return null;
}

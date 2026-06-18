/**
 * TDnet 適時開示取得
 *
 * やのしん WEB-API (http://webapi.yanoshin.jp/tdnet/) を一次ソースとして使用。
 * 取得失敗時は release.tdnet.info 公開ページから取得する。
 *
 * 参考: やのしん WEB-API は 2007 年から公開され実績ある非公式 API。
 * 公式 TDnet API は月額 7 万円超のため採用外。
 */

import RssParser from "rss-parser";

const rssParser = new RssParser({
  timeout: 15000,
  headers: { "User-Agent": "KaijiRadar/1.0 (+https://github.com/roromukuro/kaiji-radar)" },
});

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

// yanoshin serves only over HTTP (HTTPS certificate not configured on their server)
const YANOSHIN_BASE = "http://webapi.yanoshin.jp/webapi/tdnet/list";

export async function fetchTdnetByCode(
  code: string,
  since?: Date
): Promise<TdnetItem[]> {
  const url = `${YANOSHIN_BASE}/${code}.rss`;
  try {
    const feed = await rssParser.parseURL(url);
    const items: TdnetItem[] = [];

    for (const item of feed.items ?? []) {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      if (since && pubDate <= since) continue;

      const docId = extractTdnetDocId(item.link ?? "");
      const pdfUrl = extractTdnetPdfUrl(item.link ?? "");

      items.push({
        docId: docId ?? `tdnet-${code}-${pubDate.getTime()}`,
        code,
        title: item.title ?? "(タイトルなし)",
        publishedAt: pubDate,
        url: item.link ?? "",
        pdfUrl,
        submitter: feed.title ?? "",
        docType: extractDocType(item.title ?? ""),
      });
    }
    return items;
  } catch (err) {
    console.error(`[TDnet] やのしん RSS 取得失敗 ${code}:`, err);
    return fetchTdnetDirectFallback(code, since);
  }
}

export async function fetchTdnetRecent(since: Date): Promise<TdnetItem[]> {
  const url = `${YANOSHIN_BASE}/recent.rss`;
  try {
    const feed = await rssParser.parseURL(url);
    const items: TdnetItem[] = [];

    for (const item of feed.items ?? []) {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      if (pubDate <= since) continue;

      const docId = extractTdnetDocId(item.link ?? "");
      const codeMatch = item.link?.match(/\/(\d{4})\//);
      const code = codeMatch?.[1] ?? "";

      items.push({
        docId: docId ?? `tdnet-${code}-${pubDate.getTime()}`,
        code,
        title: item.title ?? "(タイトルなし)",
        publishedAt: pubDate,
        url: item.link ?? "",
        pdfUrl: extractTdnetPdfUrl(item.link ?? ""),
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

async function fetchTdnetDirectFallback(
  code: string,
  since?: Date
): Promise<TdnetItem[]> {
  try {
    const url = `https://www.release.tdnet.info/inbs/I_list_NF_${code}.html`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "KaijiRadar/1.0 (+https://github.com/roromukuro/kaiji-radar)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    return parseTdnetHtml(html, code, since);
  } catch (err) {
    console.error(`[TDnet] フォールバック失敗 ${code}:`, err);
    return [];
  }
}

function parseTdnetHtml(html: string, code: string, since?: Date): TdnetItem[] {
  const items: TdnetItem[] = [];
  // release.tdnet.info のリスト行パターン
  const rowRegex =
    /<td[^>]*class="[^"]*listed_date[^"]*"[^>]*>([\d/\s:]+)<\/td>[\s\S]*?<td[^>]*class="[^"]*listed_local_name[^"]*"[^>]*>([\s\S]*?)<\/td>[\s\S]*?href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const dateStr = match[1].trim();
    const pubDate = new Date(dateStr.replace(/\//g, "-").trim());
    if (since && pubDate <= since) continue;

    const pdfPath = match[3];
    const pdfUrl = pdfPath.startsWith("http")
      ? pdfPath
      : `https://www.release.tdnet.info${pdfPath}`;
    const title = match[4].replace(/<[^>]+>/g, "").trim();
    const docId = pdfPath.match(/\/(\d{18})/)?.[1] ?? `tdnet-${code}-${pubDate.getTime()}`;

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

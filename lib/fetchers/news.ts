/**
 * 国内・海外ニュース取得
 *
 * ソース:
 * - Google News RSS (無料、銘柄名クエリ検索)
 * - PR TIMES RSS (プレスリリース)
 * - Yahoo!ニュース RSS
 * - Reuters 日本語 RSS
 */

import RssParser from "rss-parser";

const rssParser = new RssParser({
  timeout: 15000,
  headers: { "User-Agent": "KaijiRadar/1.0 (+https://github.com/roromukuro/kaiji-radar)" },
});

export interface NewsItem {
  url: string;
  title: string;
  titleJa: string | null;
  publisher: string;
  publishedAt: Date;
  summary: string | null;
  isOverseas: boolean;
  isPaywalled: boolean;
  sourceType: "jp_news" | "en_news" | "official" | "pr_times";
}

// ============================
// Google News RSS
// ============================
//
// サーキットブレーカー: Googleがレート制限/一時ブロック(HTTP 503等)を
// 始めると、以降のリクエストも軒並み失敗し続け、29銘柄×キーワード分を
// 律儀にリトライして25分のジョブタイムアウトを浪費してしまう。
// 連続失敗が閾値を超えたら、このプロセス実行中は以降のGoogle News取得を
// スキップして早期に諦める(次回実行時はリセットされる)。
const CIRCUIT_BREAKER_THRESHOLD = 5;
let consecutiveFailures = 0;
let circuitOpenLogged = false;

function isCircuitOpen(): boolean {
  return consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD;
}

// google-news-decoder.ts からも参照する(Googleにブロックされている間は
// リダイレクト解決の試行自体が無駄になるため)
export function isGoogleNewsCircuitOpen(): boolean {
  return isCircuitOpen();
}

export function recordGoogleNewsFailure(): void {
  consecutiveFailures++;
}

export function recordGoogleNewsSuccess(): void {
  consecutiveFailures = 0;
}

export async function fetchGoogleNewsJP(
  keywords: string[],
  since?: Date
): Promise<NewsItem[]> {
  const results: NewsItem[] = [];
  for (const kw of keywords) {
    if (isCircuitOpen()) {
      if (!circuitOpenLogged) {
        console.error(`[News] Google News連続失敗が${CIRCUIT_BREAKER_THRESHOLD}回に達したため、今回の実行では以降のGoogle News取得をスキップします`);
        circuitOpenLogged = true;
      }
      break;
    }
    const q = encodeURIComponent(kw);
    const url = `https://news.google.com/rss/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja`;
    try {
      const feed = await rssParser.parseURL(url);
      consecutiveFailures = 0;
      for (const item of feed.items ?? []) {
        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
        if (since && pubDate <= since) continue;
        if (!item.link) continue;

        results.push({
          url: item.link,
          title: stripGoogleNewsSource(item.title ?? ""),
          titleJa: null,
          publisher: extractGoogleNewsSource(item.title ?? "") ?? feed.title ?? "",
          publishedAt: pubDate,
          summary: item.contentSnippet ?? item.content ?? null,
          isOverseas: false,
          isPaywalled: false,
          sourceType: "jp_news",
        });
      }
    } catch (err) {
      consecutiveFailures++;
      console.error(`[News] Google JP RSS 失敗 "${kw}":`, err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return deduplicateByUrl(results);
}

export async function fetchGoogleNewsEN(
  keywords: string[],
  since?: Date
): Promise<NewsItem[]> {
  const results: NewsItem[] = [];
  for (const kw of keywords) {
    if (isCircuitOpen()) {
      if (!circuitOpenLogged) {
        console.error(`[News] Google News連続失敗が${CIRCUIT_BREAKER_THRESHOLD}回に達したため、今回の実行では以降のGoogle News取得をスキップします`);
        circuitOpenLogged = true;
      }
      break;
    }
    const q = encodeURIComponent(kw);
    const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
    try {
      const feed = await rssParser.parseURL(url);
      consecutiveFailures = 0;
      for (const item of feed.items ?? []) {
        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
        if (since && pubDate <= since) continue;
        if (!item.link) continue;

        results.push({
          url: item.link,
          title: stripGoogleNewsSource(item.title ?? ""),
          titleJa: null,
          publisher: extractGoogleNewsSource(item.title ?? "") ?? feed.title ?? "",
          publishedAt: pubDate,
          summary: item.contentSnippet ?? item.content ?? null,
          isOverseas: true,
          isPaywalled: false,
          sourceType: "en_news",
        });
      }
    } catch (err) {
      consecutiveFailures++;
      console.error(`[News] Google EN RSS 失敗 "${kw}":`, err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return deduplicateByUrl(results);
}

// ============================
// PR TIMES RSS
// ============================

export async function fetchPRTimes(
  companyName: string,
  since?: Date
): Promise<NewsItem[]> {
  const q = encodeURIComponent(companyName);
  const url = `https://prtimes.jp/rss_search.php?query=${q}`;
  try {
    const feed = await rssParser.parseURL(url);
    const results: NewsItem[] = [];
    for (const item of feed.items ?? []) {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      if (since && pubDate <= since) continue;
      if (!item.link) continue;

      results.push({
        url: item.link,
        title: item.title ?? "",
        titleJa: null,
        publisher: "PR TIMES",
        publishedAt: pubDate,
        summary: item.contentSnippet ?? null,
        isOverseas: false,
        isPaywalled: false,
        sourceType: "pr_times",
      });
    }
    return results;
  } catch {
    return [];
  }
}

// ============================
// Generic RSS feed
// ============================

export async function fetchGenericRss(
  feedUrl: string,
  sourceType: "jp_news" | "en_news" | "official",
  since?: Date
): Promise<NewsItem[]> {
  try {
    const feed = await rssParser.parseURL(feedUrl);
    const results: NewsItem[] = [];
    for (const item of feed.items ?? []) {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      if (since && pubDate <= since) continue;
      if (!item.link) continue;

      results.push({
        url: item.link,
        title: item.title ?? "",
        titleJa: null,
        publisher: feed.title ?? feedUrl,
        publishedAt: pubDate,
        summary: item.contentSnippet ?? item.content?.slice(0, 300) ?? null,
        isOverseas: sourceType === "en_news",
        isPaywalled: false,
        sourceType,
      });
    }
    return results;
  } catch (err) {
    console.error(`[News] Generic RSS 失敗 ${feedUrl}:`, err);
    return [];
  }
}

// ============================
// Helpers
// ============================

function stripGoogleNewsSource(title: string): string {
  return title.replace(/\s*-\s*[^-]+$/, "").trim();
}

function extractGoogleNewsSource(title: string): string | null {
  const match = title.match(/\s*-\s*([^-]+)$/);
  return match?.[1]?.trim() ?? null;
}

function deduplicateByUrl(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

// ============================
// Paywall detection heuristics
// ============================

const PAYWALL_DOMAINS = [
  "nikkei.com",
  "wsj.com",
  "ft.com",
  "bloomberg.com",
  "economist.com",
];

export function detectPaywall(url: string): boolean {
  return PAYWALL_DOMAINS.some((domain) => url.includes(domain));
}

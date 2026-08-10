/**
 * 企業IRページ直接監視(新規実装2)
 *
 * RSSを提供していない企業のIR/ニュース一覧ページをHTMLとして取得し、
 * 同一ドメイン内のリンクをタイトル候補として抽出する。
 * 新着判定は呼び出し側で前回巡回時のURL集合(known_urls)との差分により行う。
 * (本文取得・要約は行わない。関連性判定は既存のニュースパイプラインに委ねる)
 */

import { parse } from "node-html-parser";

export interface IrPageItem {
  url: string;
  title: string;
}

export interface IrPageCrawlResult {
  items: IrPageItem[];
  allUrls: string[];
}

const MIN_TITLE_LENGTH = 6;
const MAX_TITLE_LENGTH = 200;
const FETCH_TIMEOUT_MS = 20000;

export async function crawlIrPage(pageUrl: string): Promise<IrPageCrawlResult> {
  const res = await fetch(pageUrl, {
    headers: { "User-Agent": "KaijiRadar/1.0 (+https://github.com/roromukuro/kaiji-radar)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`IRページ取得失敗 (HTTP ${res.status}): ${pageUrl}`);
  }
  const html = await res.text();
  const root = parse(html);
  const base = new URL(pageUrl);

  const seen = new Set<string>();
  const items: IrPageItem[] = [];

  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    const title = a.text.replace(/\s+/g, " ").trim();
    if (title.length < MIN_TITLE_LENGTH || title.length > MAX_TITLE_LENGTH) continue;

    let absUrl: string;
    try {
      absUrl = new URL(href, base).toString();
    } catch {
      continue;
    }
    if (!absUrl.startsWith("http")) continue;
    // 外部リンク(SNS・広告等)はIR一覧のノイズ源になりやすいため同一ドメインのみ対象にする
    if (new URL(absUrl).hostname !== base.hostname) continue;
    if (seen.has(absUrl)) continue;
    seen.add(absUrl);

    items.push({ url: absUrl, title });
  }

  return { items, allUrls: [...seen] };
}

"use client";

import { useState } from "react";

type ShareArticle = {
  id: string;
  title: string;
  title_ja: string | null;
  is_overseas: boolean;
  source_type: string;
  source_url: string;
  published_at: string | null;
  is_read: boolean;
  article_stocks: { stocks: { code: string; name: string } }[];
};

const SOURCE_LABELS: Record<string, string> = {
  tdnet: "TDnet",
  edinet: "EDINET",
  sec_edgar: "SEC EDGAR",
  official: "公式",
  pr_times: "PR TIMES",
  jp_news: "国内",
  en_news: "海外",
};

const PAGE_SIZE = 1000;
const DAYS_BACK = 30;

// 全期間だと数万件規模になり現実的でないため、直近30日分に絞る。
// それでも既読/未読を問わないため1回のGETで返せる上限(PAGE_SIZE)を
// 超えることがあり、offsetをずらしながら全ページ取得する。
async function fetchRecentArticles(): Promise<ShareArticle[]> {
  const publishedAfter = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
  const all: ShareArticle[] = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `/api/articles?published_after=${encodeURIComponent(publishedAfter)}&limit=${PAGE_SIZE}&offset=${offset}`
    );
    const json = await res.json();
    const page: ShareArticle[] = json.data ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

function buildGroupedShareText(articles: ShareArticle[]): string {
  const byStock = new Map<string, { label: string; items: ShareArticle[] }>();
  for (const a of articles) {
    const stock = a.article_stocks?.[0]?.stocks;
    const key = stock ? stock.code : "unknown";
    const label = stock ? `${stock.code} ${stock.name}` : "(銘柄不明)";
    if (!byStock.has(key)) byStock.set(key, { label, items: [] });
    byStock.get(key)!.items.push(a);
  }

  const lines: string[] = [`直近${DAYS_BACK}日分 ${articles.length}件`, ""];
  for (const { label, items } of byStock.values()) {
    lines.push(`■ ${label} (${items.length}件)`);
    for (const a of items) {
      const displayTitle = a.is_overseas && a.title_ja ? `[${a.title_ja}] ${a.title}` : a.title;
      lines.push(`【${SOURCE_LABELS[a.source_type] ?? a.source_type}】${a.is_read ? "" : "(未読) "}${displayTitle}`);
      if (a.source_url) lines.push(a.source_url);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function ShareAllUnreadButton({ onShared }: { onShared: () => void }) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // 既読/未読に関わらず常に使えるようにする(既読済みでもボタンは消えない)。
  // 未読が残っていれば、共有(コピー)完了後にそれだけ既読化する。
  // 共有対象と同じ直近DAYS_BACK日分だけに絞る(範囲外の古い未読を勝手に
  // 既読化しないようにするため)。
  async function markRemainingAsRead() {
    const publishedAfter = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
    await fetch(`/api/articles?published_after=${encodeURIComponent(publishedAfter)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_all_read: true }),
    });
    onShared();
  }

  async function handleShare() {
    setLoading(true);
    try {
      const articles = await fetchRecentArticles();
      if (articles.length === 0) return;
      const text = buildGroupedShareText(articles);

      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          // 共有シートを実際に完了した場合のみ既読化する(キャンセル時は既読にしない)
          await navigator.share({ text });
          await markRemainingAsRead();
        } catch {
          // ユーザーがキャンセルした場合等は何もしない
        }
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        await markRemainingAsRead();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // クリップボードも使えない環境では何もしない
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleShare}
        disabled={loading}
        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
      >
        {loading ? "準備中…" : copied ? "コピーしました" : `直近${DAYS_BACK}日分を銘柄別にまとめてChatGPTへ共有`}
      </button>
      <p className="text-xs text-zinc-400 text-center">既読・未読を問わず直近{DAYS_BACK}日分が対象です(未読分は共有後に既読になります)</p>
    </div>
  );
}

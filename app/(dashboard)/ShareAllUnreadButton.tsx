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
  article_stocks: { stocks: { code: string; name: string } }[];
};

const SOURCE_LABELS: Record<string, string> = {
  tdnet: "TDnet",
  edinet: "EDINET",
  official: "公式",
  pr_times: "PR TIMES",
  jp_news: "国内",
  en_news: "海外",
};

const LIMIT = 300;

function buildGroupedShareText(articles: ShareArticle[]): string {
  const byStock = new Map<string, { label: string; items: ShareArticle[] }>();
  for (const a of articles) {
    const stock = a.article_stocks?.[0]?.stocks;
    const key = stock ? stock.code : "unknown";
    const label = stock ? `${stock.code} ${stock.name}` : "(銘柄不明)";
    if (!byStock.has(key)) byStock.set(key, { label, items: [] });
    byStock.get(key)!.items.push(a);
  }

  const lines: string[] = [
    `未読 ${articles.length}件${articles.length >= LIMIT ? `(直近${LIMIT}件まで)` : ""}`,
    "",
  ];
  for (const { label, items } of byStock.values()) {
    lines.push(`■ ${label} (${items.length}件)`);
    for (const a of items) {
      const displayTitle = a.is_overseas && a.title_ja ? `[${a.title_ja}] ${a.title}` : a.title;
      lines.push(`【${SOURCE_LABELS[a.source_type] ?? a.source_type}】${displayTitle}`);
      if (a.source_url) lines.push(a.source_url);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function ShareAllUnreadButton({
  unreadCount,
  onShared,
}: {
  unreadCount: number;
  onShared: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  if (unreadCount === 0) return null;

  async function markAsRead(ids: string[]) {
    if (ids.length === 0) return;
    await fetch("/api/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, is_read: true }),
    });
    onShared();
  }

  async function handleShare() {
    setLoading(true);
    try {
      const res = await fetch(`/api/articles?is_read=false&limit=${LIMIT}`);
      const json = await res.json();
      const articles: ShareArticle[] = json.data ?? [];
      if (articles.length === 0) return;
      const text = buildGroupedShareText(articles);
      const ids = articles.map((a) => a.id);

      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          // 共有シートを実際に完了した場合のみ既読化する(キャンセル時は既読にしない)
          await navigator.share({ text });
          await markAsRead(ids);
        } catch {
          // ユーザーがキャンセルした場合等は何もしない
        }
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        await markAsRead(ids);
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
        {loading ? "準備中…" : copied ? "コピーしました" : "未読を銘柄別にまとめてChatGPTへ共有"}
      </button>
      <p className="text-xs text-zinc-400 text-center">共有(コピー)が完了した記事は既読になります</p>
    </div>
  );
}

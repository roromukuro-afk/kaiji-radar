"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UnreadArticleForShare {
  id: string;
  title: string;
  title_ja: string | null;
  is_overseas: boolean;
  published_at: string | null;
  source_type: string;
  source_url: string | null;
}

interface Props {
  stockLabel: string;
  articles: UnreadArticleForShare[];
}

const SOURCE_LABELS: Record<string, string> = {
  tdnet: "TDnet",
  edinet: "EDINET",
  official: "公式",
  pr_times: "PR TIMES",
  jp_news: "国内",
  en_news: "海外",
};

function buildBundleShareText({ stockLabel, articles }: Props): string {
  const lines: string[] = [stockLabel, `未読 ${articles.length}件`, ""];
  for (const a of articles) {
    const displayTitle = a.is_overseas && a.title_ja ? `[${a.title_ja}] ${a.title}` : a.title;
    lines.push(`【${SOURCE_LABELS[a.source_type] ?? a.source_type}】${displayTitle}`);
    if (a.source_url) lines.push(a.source_url);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function ShareUnreadToChatGptButton({ stockLabel, articles }: Props) {
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  if (articles.length === 0) return null;

  async function markAsRead() {
    await fetch("/api/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: articles.map((a) => a.id), is_read: true }),
    });
    router.refresh();
  }

  async function handleShare() {
    const text = buildBundleShareText({ stockLabel, articles });

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        // 共有シートを実際に完了した場合のみ既読化する(キャンセル時は既読にしない)
        await navigator.share({ text });
        await markAsRead();
      } catch {
        // ユーザーがキャンセルした場合等は何もしない
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      await markAsRead();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードも使えない環境では何もしない
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleShare}
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        <span>{copied ? "コピーしました" : `未読${articles.length}件をまとめてChatGPTへ共有`}</span>
      </button>
      <p className="text-xs text-zinc-400 text-center">共有(コピー)が完了した記事は既読になります</p>
    </div>
  );
}

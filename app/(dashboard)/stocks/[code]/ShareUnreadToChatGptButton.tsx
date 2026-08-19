"use client";

import { useState } from "react";

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

  if (articles.length === 0) return null;

  async function handleShare() {
    const text = buildBundleShareText({ stockLabel, articles });

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // ユーザーがキャンセルした場合等は何もしない
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードも使えない環境では何もしない
    }
  }

  return (
    <button
      onClick={handleShare}
      className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
    >
      <span>{copied ? "コピーしました" : `未読${articles.length}件をまとめてChatGPTへ共有`}</span>
    </button>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ArticleForShare {
  id: string;
  title: string;
  title_ja: string | null;
  is_overseas: boolean;
  published_at: string | null;
  source_type: string;
  source_url: string | null;
  is_read: boolean;
}

interface Props {
  stockId: string;
  stockLabel: string;
  articles: ArticleForShare[];
  daysBack: number;
}

const SOURCE_LABELS: Record<string, string> = {
  tdnet: "TDnet",
  edinet: "EDINET",
  sec_edgar: "SEC EDGAR",
  official: "公式",
  pr_times: "PR TIMES",
  jp_news: "国内",
  en_news: "海外",
};

function buildBundleShareText({
  stockLabel,
  articles,
  daysBack,
}: Pick<Props, "stockLabel" | "articles" | "daysBack">): string {
  const lines: string[] = [stockLabel, `直近${daysBack}日分 ${articles.length}件`, ""];
  for (const a of articles) {
    const displayTitle = a.is_overseas && a.title_ja ? `[${a.title_ja}] ${a.title}` : a.title;
    lines.push(`【${SOURCE_LABELS[a.source_type] ?? a.source_type}】${a.is_read ? "" : "(未読) "}${displayTitle}`);
    if (a.source_url) lines.push(a.source_url);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function ShareUnreadToChatGptButton({ stockId, stockLabel, articles, daysBack }: Props) {
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  // 既読/未読に関わらず常に使えるようにする(既読済みでもボタンは消えない)。

  // 件数が多くても確実に既読化できるよう、この銘柄に絞った
  // 「全記事を既読」(サーバー側でページング解決)の仕組みを流用する。
  // 既読な記事に対しては何もしない(is_read=false のものだけが対象)。
  // 共有対象と同じ直近daysBack日分だけに絞る(範囲外の古い未読を勝手に
  // 既読化しないようにするため)。
  async function markRemainingAsRead() {
    const publishedAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    await fetch(
      `/api/articles?stock_id=${stockId}&published_after=${encodeURIComponent(publishedAfter)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark_all_read: true }),
      }
    );
    router.refresh();
  }

  async function handleShare() {
    const text = buildBundleShareText({ stockLabel, articles, daysBack });

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
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleShare}
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        <span>{copied ? "コピーしました" : `この銘柄の直近${daysBack}日分(${articles.length}件)をChatGPTへ共有`}</span>
      </button>
      <p className="text-xs text-zinc-400 text-center">既読・未読を問わず直近{daysBack}日分が対象です(未読分は共有後に既読になります)</p>
    </div>
  );
}

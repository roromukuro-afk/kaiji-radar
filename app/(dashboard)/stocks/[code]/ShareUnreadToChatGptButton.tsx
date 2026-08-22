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

function buildBundleShareText({ stockLabel, articles }: Pick<Props, "stockLabel" | "articles">): string {
  const lines: string[] = [stockLabel, `全${articles.length}件`, ""];
  for (const a of articles) {
    const displayTitle = a.is_overseas && a.title_ja ? `[${a.title_ja}] ${a.title}` : a.title;
    lines.push(`【${SOURCE_LABELS[a.source_type] ?? a.source_type}】${a.is_read ? "" : "(未読) "}${displayTitle}`);
    if (a.source_url) lines.push(a.source_url);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function ShareUnreadToChatGptButton({ stockId, stockLabel, articles }: Props) {
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  // 既読/未読に関わらず常に使えるようにする(既読済みでもボタンは消えない)。

  // 件数が多くても確実に既読化できるよう、この銘柄に絞った
  // 「全記事を既読」(サーバー側でページング解決)の仕組みを流用する。
  // 既読な記事に対しては何もしない(is_read=false のものだけが対象)。
  async function markRemainingAsRead() {
    await fetch(`/api/articles?stock_id=${stockId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_all_read: true }),
    });
    router.refresh();
  }

  async function handleShare() {
    const text = buildBundleShareText({ stockLabel, articles });

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
        <span>{copied ? "コピーしました" : `この銘柄の全${articles.length}件をChatGPTへ共有`}</span>
      </button>
      <p className="text-xs text-zinc-400 text-center">既読・未読を問わず全件が対象です(未読分は共有後に既読になります)</p>
    </div>
  );
}

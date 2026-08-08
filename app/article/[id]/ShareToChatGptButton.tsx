"use client";

import { useState } from "react";

interface ShareToChatGptButtonProps {
  stockLabel: string | null;
  title: string;
  publishedAtLabel: string | null;
  articleUrl: string | null;
  pdfUrl: string | null;
}

function buildShareText({
  stockLabel,
  title,
  publishedAtLabel,
  articleUrl,
  pdfUrl,
}: ShareToChatGptButtonProps): string {
  const lines: string[] = [];
  if (stockLabel) lines.push(stockLabel);
  lines.push(title);
  if (publishedAtLabel) lines.push(publishedAtLabel);
  lines.push("");
  if (articleUrl) lines.push(articleUrl);
  if (pdfUrl) lines.push(`PDF: ${pdfUrl}`);
  return lines.join("\n");
}

export function ShareToChatGptButton(props: ShareToChatGptButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const text = buildShareText(props);

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
      className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
    >
      <span>{copied ? "コピーしました" : "ChatGPTへ共有"}</span>
    </button>
  );
}

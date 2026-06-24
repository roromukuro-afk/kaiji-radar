"use client";

import { useEffect, useState } from "react";

type FeedbackType =
  | "relevant"
  | "uncertain"
  | "irrelevant"
  | "different_company"
  | "weaken_domain"
  | "exclude_keyword"
  | "add_keyword"
  | "cancel";

type Stock = { id: string; code: string; name: string };

interface FeedbackPanelProps {
  articleId: string;
  stock: Stock;
  systemRelevance: string | null;
  systemExclusion: boolean;
}

const RELEVANCE_LABEL: Record<string, string> = {
  certain: "関連確実",
  uncertain: "関連不確実",
  irrelevant: "除外候補",
  relevant: "関連あり",
  different_company: "同名別会社",
};

const USER_RELEVANCE_COLOR: Record<string, string> = {
  relevant: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200",
  uncertain: "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200",
  irrelevant: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
  different_company: "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300",
};

export function FeedbackPanel({ articleId, stock, systemRelevance, systemExclusion }: FeedbackPanelProps) {
  const [userRelevance, setUserRelevance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showExtraOptions, setShowExtraOptions] = useState(false);
  const [excludeKeyword, setExcludeKeyword] = useState(false);
  const [keywordInput, setKeywordInput] = useState("");
  const [weakenDomain, setWeakenDomain] = useState(false);
  const [domainInput, setDomainInput] = useState("");

  useEffect(() => {
    fetch(`/api/feedback?article_id=${articleId}&stock_id=${stock.id}`)
      .then((r) => r.json())
      .then((j) => {
        setUserRelevance(j.user_relevance ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [articleId, stock.id]);

  async function submitFeedback(type: FeedbackType) {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        article_id: articleId,
        stock_id: stock.id,
        feedback_type: type,
      };

      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (type === "cancel") {
        setUserRelevance(null);
      } else if (type !== "exclude_keyword" && type !== "add_keyword" && type !== "weaken_domain") {
        setUserRelevance(type);
      }
      setShowExtraOptions(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitIrrelevantWithExtras() {
    setSubmitting(true);
    try {
      // Main irrelevant feedback
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article_id: articleId,
          stock_id: stock.id,
          feedback_type: "irrelevant",
        }),
      });

      // Optional keyword exclusion
      if (excludeKeyword && keywordInput.trim()) {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            article_id: articleId,
            stock_id: stock.id,
            feedback_type: "exclude_keyword",
            target_keyword: keywordInput.trim(),
          }),
        });
      }

      // Optional domain weakening
      if (weakenDomain && domainInput.trim()) {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            article_id: articleId,
            stock_id: stock.id,
            feedback_type: "weaken_domain",
            target_domain: domainInput.trim(),
          }),
        });
      }

      setUserRelevance("irrelevant");
      setShowExtraOptions(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 text-xs text-zinc-400">
        読み込み中…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 space-y-3">
      {/* Header: stock + system judgment */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {stock.code} {stock.name}
          </span>
          {systemRelevance && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
              システム判定: {RELEVANCE_LABEL[systemRelevance] ?? systemRelevance}
              {systemExclusion ? " (除外候補)" : ""}
            </span>
          )}
        </div>

        {userRelevance && (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${USER_RELEVANCE_COLOR[userRelevance] ?? "bg-zinc-100 text-zinc-600"}`}>
            あなたの判定: {RELEVANCE_LABEL[userRelevance] ?? userRelevance}
          </span>
        )}
      </div>

      {/* Feedback buttons */}
      {!showExtraOptions && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => submitFeedback("relevant")}
            disabled={submitting || userRelevance === "relevant"}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
              userRelevance === "relevant"
                ? "bg-green-200 dark:bg-green-800 text-green-900 dark:text-green-100"
                : "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-800"
            }`}
          >
            関連あり
          </button>

          <button
            onClick={() => submitFeedback("uncertain")}
            disabled={submitting || userRelevance === "uncertain"}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
              userRelevance === "uncertain"
                ? "bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100"
                : "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 hover:bg-yellow-200 dark:hover:bg-yellow-800"
            }`}
          >
            関連不確実
          </button>

          <button
            onClick={() => setShowExtraOptions(true)}
            disabled={submitting || userRelevance === "irrelevant"}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
              userRelevance === "irrelevant"
                ? "bg-red-200 dark:bg-red-800 text-red-900 dark:text-red-100"
                : "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800"
            }`}
          >
            関係なし
          </button>

          <button
            onClick={() => submitFeedback("different_company")}
            disabled={submitting || userRelevance === "different_company"}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
              userRelevance === "different_company"
                ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100"
                : "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600"
            }`}
          >
            同名別会社
          </button>

          {userRelevance && (
            <button
              onClick={() => submitFeedback("cancel")}
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              判定を取り消す
            </button>
          )}
        </div>
      )}

      {/* Expanded irrelevant options */}
      {showExtraOptions && (
        <div className="space-y-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            この記事を「関係なし」として記録します
          </p>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeKeyword}
              onChange={(e) => setExcludeKeyword(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded flex-shrink-0"
            />
            <div className="space-y-1">
              <span className="text-xs text-zinc-700 dark:text-zinc-300">このキーワードを除外候補に追加</span>
              {excludeKeyword && (
                <input
                  type="text"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  placeholder="除外するキーワード"
                  className="block w-full px-2 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              )}
            </div>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={weakenDomain}
              onChange={(e) => setWeakenDomain(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded flex-shrink-0"
            />
            <div className="space-y-1">
              <span className="text-xs text-zinc-700 dark:text-zinc-300">このドメインをこの銘柄で弱める</span>
              {weakenDomain && (
                <input
                  type="text"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="ドメイン例: example.com"
                  className="block w-full px-2 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              )}
            </div>
          </label>

          <div className="flex gap-2">
            <button
              onClick={submitIrrelevantWithExtras}
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? "送信中…" : "関係なしとして記録"}
            </button>
            <button
              onClick={() => {
                setShowExtraOptions(false);
                setExcludeKeyword(false);
                setKeywordInput("");
                setWeakenDomain(false);
                setDomainInput("");
              }}
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

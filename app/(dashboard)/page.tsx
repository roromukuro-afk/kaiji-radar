"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatJST, formatRelative, sourceTypeLabel, sourceTypeColor, relevanceLabel, truncate } from "@/lib/utils";
import Link from "next/link";
import { PushNotificationButton } from "@/components/PushNotificationButton";

type Article = {
  id: string;
  source_type: string;
  title: string;
  title_ja: string | null;
  publisher: string | null;
  published_at: string | null;
  summary: string | null;
  is_read: boolean;
  is_paywalled: boolean;
  is_overseas: boolean;
  is_update: boolean;
  is_pdf: boolean;
  relevance: string;
  notification_failed_count: number;
  article_stocks: { stocks: { id: string; code: string; name: string } }[];
};

const SOURCE_TYPES = ["", "tdnet", "edinet", "official", "jp_news", "en_news"];

export default function FeedPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ sourceType: "", isRead: "", q: "" });
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const fetchArticles = useCallback(async (newOffset = 0) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(newOffset) });
    if (filter.sourceType) params.set("source_type", filter.sourceType);
    if (filter.isRead !== "") params.set("is_read", filter.isRead);
    if (filter.q) params.set("q", filter.q);

    const res = await fetch(`/api/articles?${params}`);
    const json = await res.json();
    setArticles(newOffset === 0 ? json.data ?? [] : (prev: Article[]) => [...prev, ...json.data]);
    setTotal(json.count ?? 0);
    setOffset(newOffset);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchArticles(0);
  }, [fetchArticles]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("is_read", false)
      .then(({ count }) => setUnreadCount(count ?? 0));
  }, [articles]);

  async function markAllRead() {
    const ids = articles.filter((a) => !a.is_read).map((a) => a.id);
    if (!ids.length) return;
    await fetch("/api/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, is_read: true }),
    });
    fetchArticles(0);
  }

  async function handleManualFetch() {
    setRefreshing(true);
    try {
      await fetch("/api/manual-fetch", { method: "POST" });
      setTimeout(() => {
        fetchArticles(0);
        setRefreshing(false);
      }, 3000);
    } catch {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Top controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <PushNotificationButton />

        <button
          onClick={handleManualFetch}
          disabled={refreshing}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-50"
        >
          {refreshing ? "更新中…" : "今すぐ更新"}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap text-sm">
        <select
          value={filter.sourceType}
          onChange={(e) => setFilter((f) => ({ ...f, sourceType: e.target.value }))}
          className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
        >
          <option value="">全ソース</option>
          {SOURCE_TYPES.slice(1).map((t) => (
            <option key={t} value={t}>{sourceTypeLabel(t)}</option>
          ))}
        </select>

        <select
          value={filter.isRead}
          onChange={(e) => setFilter((f) => ({ ...f, isRead: e.target.value }))}
          className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
        >
          <option value="">全て</option>
          <option value="false">未読</option>
          <option value="true">既読</option>
        </select>

        <input
          type="search"
          placeholder="検索…"
          value={filter.q}
          onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
          className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
        />

        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            全て既読
          </button>
        )}
      </div>

      {/* Unread badge */}
      {unreadCount > 0 && (
        <div className="text-sm text-zinc-500">
          未読 <span className="font-semibold text-zinc-900 dark:text-zinc-100">{unreadCount}</span> 件
        </div>
      )}

      {/* Article list */}
      {loading && articles.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">読み込み中…</div>
      ) : articles.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">記事がありません</div>
      ) : (
        <div className="space-y-2">
          {articles.map((a) => (
            <ArticleCard key={a.id} article={a} onRead={() => fetchArticles(0)} />
          ))}

          {offset + LIMIT < total && (
            <button
              onClick={() => fetchArticles(offset + LIMIT)}
              className="w-full py-3 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              もっと見る ({total - offset - LIMIT} 件)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ArticleCard({ article: a, onRead }: { article: Article; onRead: () => void }) {
  const stocks = a.article_stocks?.map((as) => as.stocks).filter(Boolean) ?? [];

  async function handleClick() {
    if (!a.is_read) {
      await fetch("/api/articles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [a.id], is_read: true }),
      });
      onRead();
    }
  }

  return (
    <Link
      href={`/article/${a.id}`}
      onClick={handleClick}
      className={`block rounded-xl border p-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
        a.is_read
          ? "border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950"
          : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-950"
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Unread dot */}
        {!a.is_read && (
          <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-blue-500" />
        )}

        <div className="flex-1 min-w-0 space-y-1">
          {/* Badges row */}
          <div className="flex flex-wrap gap-1 items-center">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${sourceTypeColor(a.source_type)}`}>
              {sourceTypeLabel(a.source_type)}
            </span>
            {stocks.slice(0, 3).map((s) => (
              <span key={s.id} className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                {s.code} {s.name}
              </span>
            ))}
            {a.is_update && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">更新</span>
            )}
            {a.is_paywalled && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">有料</span>
            )}
            {a.relevance === "uncertain" && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200">関連不確実</span>
            )}
          </div>

          {/* Title */}
          <p className={`text-sm leading-snug ${a.is_read ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-900 dark:text-zinc-100 font-medium"}`}>
            {a.is_overseas && a.title_ja ? (
              <>
                <span className="text-zinc-400 dark:text-zinc-500 font-normal">[{a.title_ja}]</span>{" "}
                {a.title}
              </>
            ) : a.title}
          </p>

          {/* Summary */}
          {a.summary && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {truncate(a.summary, 100)}
            </p>
          )}

          {/* Meta */}
          <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
            {a.publisher && <span>{truncate(a.publisher, 30)}</span>}
            <span>·</span>
            <span>{formatRelative(a.published_at)}</span>
            {a.is_pdf && <span>· PDF</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}

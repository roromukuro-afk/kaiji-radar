"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRelative, sourceTypeLabel, sourceTypeColor, truncate } from "@/lib/utils";
import { EVENT_TYPES, eventTypeLabel } from "@/lib/classifiers/event-type";
import { IMPORTANCE_TIERS, importanceLabel } from "@/lib/classifiers/importance";
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
  is_important: boolean;
  event_type: string | null;
  importance: string | null;
  relevance: string;
  user_relevance: string | null;
  exclusion_candidate: boolean | null;
  notification_failed_count: number;
  article_stocks: { stocks: { id: string; code: string; name: string } }[];
};

type Stock = {
  id: string;
  code: string;
  name: string;
};

const SOURCE_TYPES = ["tdnet", "edinet", "official", "pr_times", "jp_news", "en_news"] as const;

type DateRange = "24h" | "7d" | "30d" | "all";

type Filter = {
  stockId: string;
  sourceType: string;
  isRead: string;
  relevance: string;
  isPaywalled: boolean;
  isUpdate: boolean;
  isImportant: boolean;
  eventType: string;
  importance: string;
  dateRange: DateRange;
  q: string;
};

const INITIAL_FILTER: Filter = {
  stockId: "",
  sourceType: "",
  isRead: "",
  relevance: "",
  isPaywalled: false,
  isUpdate: false,
  isImportant: false,
  eventType: "",
  importance: "",
  dateRange: "all",
  q: "",
};

function getPublishedAfter(range: DateRange): string | null {
  if (range === "all") return null;
  const now = new Date();
  if (range === "24h") now.setHours(now.getHours() - 24);
  else if (range === "7d") now.setDate(now.getDate() - 7);
  else if (range === "30d") now.setDate(now.getDate() - 30);
  return now.toISOString();
}

// GETの一覧取得とPATCHの一括既読で同じ条件を使い回す(is_readは呼び出し側で設定する)
function buildFilterParams(filter: Filter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.stockId) params.set("stock_id", filter.stockId);
  if (filter.sourceType) params.set("source_type", filter.sourceType);
  if (filter.relevance) params.set("relevance", filter.relevance);
  if (filter.isPaywalled) params.set("is_paywalled", "true");
  if (filter.isUpdate) params.set("is_update", "true");
  if (filter.isImportant) params.set("is_important", "true");
  if (filter.eventType) params.set("event_type", filter.eventType);
  if (filter.importance) params.set("importance", filter.importance);
  if (filter.q) params.set("q", filter.q);
  const after = getPublishedAfter(filter.dateRange);
  if (after) params.set("published_after", after);
  return params;
}

function countActiveFilters(f: Filter): number {
  let n = 0;
  if (f.stockId) n++;
  if (f.sourceType) n++;
  if (f.isRead !== "") n++;
  if (f.relevance) n++;
  if (f.isPaywalled) n++;
  if (f.isUpdate) n++;
  if (f.isImportant) n++;
  if (f.eventType) n++;
  if (f.importance) n++;
  if (f.dateRange !== "all") n++;
  if (f.q) n++;
  return n;
}

export default function FeedPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>(INITIAL_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  // Load stocks for filter dropdown
  useEffect(() => {
    fetch("/api/stocks")
      .then((r) => r.json())
      .then((j) => setStocks(j.data ?? []))
      .catch(() => {});
  }, []);

  const fetchArticles = useCallback(async (newOffset = 0) => {
    setLoading(true);
    const params = buildFilterParams(filter);
    params.set("limit", String(LIMIT));
    params.set("offset", String(newOffset));
    if (filter.isRead !== "") params.set("is_read", filter.isRead);

    const res = await fetch(`/api/articles?${params}`);
    const json = await res.json();
    setArticles(newOffset === 0 ? json.data ?? [] : (prev: Article[]) => [...prev, ...(json.data ?? [])]);
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

  const [markingAllRead, setMarkingAllRead] = useState(false);

  async function markAllRead() {
    setMarkingAllRead(true);
    try {
      const params = buildFilterParams(filter);
      params.set("is_read", "false");
      params.set("limit", "1");

      const countRes = await fetch(`/api/articles?${params}`);
      const countJson = await countRes.json();
      const targetCount: number = countJson.count ?? 0;

      if (targetCount === 0) {
        alert("対象の未読記事はありません");
        return;
      }
      if (!confirm(`${targetCount}件を既読にします。よろしいですか？`)) return;

      await fetch(`/api/articles?${params}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark_all_read: true }),
      });
      fetchArticles(0);
    } finally {
      setMarkingAllRead(false);
    }
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

  const activeCount = countActiveFilters(filter);

  return (
    <div className="space-y-4">
      {/* Top controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <PushNotificationButton />

        <button
          onClick={() => setFilterOpen((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
            filterOpen
              ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent"
              : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
          }`}
        >
          フィルター
          {activeCount > 0 && (
            <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-xs font-bold ${
              filterOpen ? "bg-white text-zinc-900" : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
            }`}>
              {activeCount}
            </span>
          )}
        </button>

        {activeCount > 0 && (
          <button
            onClick={() => setFilter(INITIAL_FILTER)}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 px-2 py-1.5"
          >
            クリア
          </button>
        )}

        <button
          onClick={handleManualFetch}
          disabled={refreshing}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-50"
        >
          {refreshing ? "更新中…" : "今すぐ更新"}
        </button>
      </div>

      {/* Collapsible filter panel */}
      {filterOpen && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 space-y-3">
          {/* Row 1: keyword search (always visible and first) */}
          <input
            type="search"
            placeholder="キーワード検索…"
            value={filter.q}
            onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
          />

          {/* Row 2: stock + source type */}
          <div className="flex gap-2 flex-wrap">
            <select
              value={filter.stockId}
              onChange={(e) => setFilter((f) => ({ ...f, stockId: e.target.value }))}
              className="flex-1 min-w-0 px-2 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
            >
              <option value="">全銘柄</option>
              {stocks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} {s.name}
                </option>
              ))}
            </select>

            <select
              value={filter.sourceType}
              onChange={(e) => setFilter((f) => ({ ...f, sourceType: e.target.value }))}
              className="flex-1 min-w-0 px-2 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
            >
              <option value="">全ソース</option>
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>{sourceTypeLabel(t)}</option>
              ))}
            </select>

            <select
              value={filter.eventType}
              onChange={(e) => setFilter((f) => ({ ...f, eventType: e.target.value }))}
              className="flex-1 min-w-0 px-2 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
            >
              <option value="">全種別</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>{eventTypeLabel(t)}</option>
              ))}
            </select>

            <select
              value={filter.importance}
              onChange={(e) => setFilter((f) => ({ ...f, importance: e.target.value }))}
              className="flex-1 min-w-0 px-2 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
            >
              <option value="">全重要度</option>
              {IMPORTANCE_TIERS.map((t) => (
                <option key={t} value={t}>{importanceLabel(t)}</option>
              ))}
            </select>
          </div>

          {/* Row 3: read status + relevance */}
          <div className="flex gap-2 flex-wrap">
            <select
              value={filter.isRead}
              onChange={(e) => setFilter((f) => ({ ...f, isRead: e.target.value }))}
              className="flex-1 min-w-0 px-2 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
            >
              <option value="">既読・未読</option>
              <option value="false">未読</option>
              <option value="true">既読</option>
            </select>

            <select
              value={filter.relevance}
              onChange={(e) => setFilter((f) => ({ ...f, relevance: e.target.value }))}
              className="flex-1 min-w-0 px-2 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
            >
              <option value="">全関連度</option>
              <option value="certain">関連確実</option>
              <option value="uncertain">関連不確実</option>
              <option value="irrelevant">除外候補</option>
            </select>
          </div>

          {/* Row 4: date range */}
          <div className="flex gap-1.5 flex-wrap">
            {(["all", "24h", "7d", "30d"] as DateRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setFilter((f) => ({ ...f, dateRange: r }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter.dateRange === r
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                    : "border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                {r === "all" ? "全期間" : r === "24h" ? "24時間" : r === "7d" ? "7日間" : "30日間"}
              </button>
            ))}
          </div>

          {/* Row 5: toggles */}
          <div className="flex gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filter.isImportant}
                onChange={(e) => setFilter((f) => ({ ...f, isImportant: e.target.checked }))}
                className="w-4 h-4 rounded"
              />
              <span className="text-zinc-700 dark:text-zinc-300">重要開示のみ</span>
            </label>

            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filter.isPaywalled}
                onChange={(e) => setFilter((f) => ({ ...f, isPaywalled: e.target.checked }))}
                className="w-4 h-4 rounded"
              />
              <span className="text-zinc-700 dark:text-zinc-300">有料記事のみ</span>
            </label>

            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filter.isUpdate}
                onChange={(e) => setFilter((f) => ({ ...f, isUpdate: e.target.checked }))}
                className="w-4 h-4 rounded"
              />
              <span className="text-zinc-700 dark:text-zinc-300">更新記事のみ</span>
            </label>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            重要開示 = TDnet/EDINET/公式発表、または決算・M&amp;A・行政処分など開示カテゴリに一致する記事(投資判断の評価ではありません)
          </p>
        </div>
      )}

      {/* Quick search (when panel is closed) */}
      {!filterOpen && (
        <div className="flex gap-2">
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
              disabled={markingAllRead}
              className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap disabled:opacity-50"
            >
              {activeCount > 0 ? "検索結果を既読" : "全記事を既読"}
            </button>
          )}
        </div>
      )}

      {/* Unread badge */}
      {unreadCount > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-zinc-500">
            未読 <span className="font-semibold text-zinc-900 dark:text-zinc-100">{unreadCount}</span> 件
          </div>
          {filterOpen && unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={markingAllRead}
              className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              {activeCount > 0 ? "検索結果を既読" : "全記事を既読"}
            </button>
          )}
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

  const isExcluded = a.exclusion_candidate === true || a.user_relevance === "irrelevant" || a.user_relevance === "different_company";

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
            {a.importance === "critical" && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 font-semibold border border-red-300 dark:border-red-700">
                最重要
              </span>
            )}
            {a.importance === "important" && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
                重要
              </span>
            )}
            {a.event_type && a.event_type !== "other" && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                {eventTypeLabel(a.event_type)}
              </span>
            )}
            {stocks.slice(0, 3).map((s) => (
              <span key={s.id} className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                {s.code} {s.name}
              </span>
            ))}
            {a.is_important && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 font-semibold border border-red-200 dark:border-red-800">★重要</span>
            )}
            {a.is_update && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">更新</span>
            )}
            {a.is_paywalled && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">有料</span>
            )}
            {(a.relevance === "uncertain" && !isExcluded) && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200">関連不確実</span>
            )}
            {isExcluded && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300">除外候補</span>
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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatRelative } from "@/lib/utils";

// --- Types ---

interface OperationLog {
  id: string;
  action: string;
  target_id: string;
  result: string;
  details: FeedbackLogDetails | null;
  created_at: string;
}

interface FeedbackLogDetails {
  stock_id?: string;
  feedback_type?: string;
  target_keyword?: string | null;
  target_domain?: string | null;
  reason?: string | null;
  article_title?: string | null;
  stock_name?: string | null;
}

interface KeywordRule {
  id: string;
  stock_id: string;
  keyword: string;
  action: string;
  is_active: boolean;
  created_at: string;
  stocks: { id: string; code: string; name: string } | null;
}

interface ExcludedArticle {
  id: string;
  title: string;
  source_type: string;
  published_at: string | null;
  user_relevance: string | null;
  exclusion_candidate: boolean | null;
  article_stocks: { stocks: { id: string; code: string; name: string } }[];
}

// --- Badge helpers ---

const FEEDBACK_BADGE: Record<string, { label: string; cls: string }> = {
  relevant: { label: "関連あり", cls: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" },
  uncertain: { label: "不確実", cls: "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200" },
  irrelevant: { label: "関係なし", cls: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300" },
  different_company: { label: "別会社", cls: "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300" },
  cancel: { label: "取り消し", cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500" },
  exclude_keyword: { label: "KW除外", cls: "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200" },
  add_keyword: { label: "KW追加", cls: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200" },
  weaken_domain: { label: "DM弱化", cls: "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200" },
  // noise_rules.rule_type values (キーワードルール一覧はnoise_rules由来)
  exclude_candidate: { label: "除外候補", cls: "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200" },
  block_notify: { label: "通知停止", cls: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300" },
  weaken_source: { label: "DM弱化", cls: "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200" },
  strengthen: { label: "関連強化", cls: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200" },
};

function FeedbackBadge({ type }: { type: string }) {
  const b = FEEDBACK_BADGE[type] ?? { label: type, cls: "bg-zinc-100 text-zinc-600" };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${b.cls}`}>{b.label}</span>
  );
}

// --- Sections ---

function FeedbackLogsSection({ logs }: { logs: OperationLog[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-zinc-400 py-4 text-center">フィードバックの履歴がありません</p>;
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => {
        const details = log.details ?? {};
        const type = details.feedback_type ?? "";
        return (
          <div key={log.id} className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 flex items-start gap-3">
            <FeedbackBadge type={type} />
            <div className="flex-1 min-w-0">
              <Link
                href={`/article/${log.target_id}`}
                className="text-sm text-zinc-800 dark:text-zinc-200 hover:underline line-clamp-1"
              >
                {details.article_title ?? log.target_id}
              </Link>
              {details.stock_name && (
                <p className="text-xs text-zinc-500">{details.stock_name}</p>
              )}
              {(details.target_keyword || details.target_domain) && (
                <p className="text-xs text-zinc-400">
                  {details.target_keyword && <>KW: {details.target_keyword}</>}
                  {details.target_domain && <> / DM: {details.target_domain}</>}
                </p>
              )}
            </div>
            <span className="text-xs text-zinc-400 flex-shrink-0">{formatRelative(log.created_at)}</span>
          </div>
        );
      })}
    </div>
  );
}

function KeywordRulesSection({
  rules,
  onDelete,
  onToggle,
}: {
  rules: KeywordRule[];
  onDelete: (id: string) => void;
  onToggle: (id: string, current: boolean) => void;
}) {
  if (rules.length === 0) {
    return <p className="text-sm text-zinc-400 py-4 text-center">キーワードルールがありません</p>;
  }

  return (
    <div className="space-y-2">
      {rules.map((r) => (
        <div key={r.id} className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 flex items-center gap-2">
          <FeedbackBadge type={r.action} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-800 dark:text-zinc-200 font-medium">{r.keyword}</p>
            {r.stocks && (
              <p className="text-xs text-zinc-500">{r.stocks.code} {r.stocks.name}</p>
            )}
          </div>
          <button
            onClick={() => onToggle(r.id, r.is_active)}
            className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
              r.is_active
                ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300"
                : "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-400"
            }`}
          >
            {r.is_active ? "有効" : "無効"}
          </button>
          <button
            onClick={() => onDelete(r.id)}
            className="text-xs px-2 py-1 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
          >
            削除
          </button>
        </div>
      ))}
    </div>
  );
}

function ExcludedArticlesSection({
  articles,
  onRestore,
}: {
  articles: ExcludedArticle[];
  onRestore: (articleId: string, stockId: string) => void;
}) {
  if (articles.length === 0) {
    return <p className="text-sm text-zinc-400 py-4 text-center">除外候補の記事がありません</p>;
  }

  return (
    <div className="space-y-2">
      {articles.map((a) => {
        const stocks = a.article_stocks?.map((as) => as.stocks).filter(Boolean) ?? [];
        const firstStock = stocks[0];

        return (
          <div key={a.id} className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <Link
                href={`/article/${a.id}`}
                className="text-sm text-zinc-800 dark:text-zinc-200 hover:underline line-clamp-2"
              >
                {a.title}
              </Link>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {stocks.slice(0, 3).map((s) => (
                  <span key={s.id} className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                    {s.code} {s.name}
                  </span>
                ))}
                <span className="text-xs text-zinc-400">{formatRelative(a.published_at)}</span>
              </div>
            </div>
            {firstStock && (
              <button
                onClick={() => onRestore(a.id, firstStock.id)}
                className="flex-shrink-0 text-xs px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                復元
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Main page ---

export default function FeedbackPage() {
  const [feedbackLogs, setFeedbackLogs] = useState<OperationLog[]>([]);
  const [rules, setRules] = useState<KeywordRule[]>([]);
  const [excluded, setExcluded] = useState<ExcludedArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"logs" | "rules" | "excluded">("logs");

  async function loadAll() {
    setLoading(true);
    try {
      const [logsRes, rulesRes, excludedRes] = await Promise.all([
        fetch("/api/feedback?type=log&limit=50"),
        fetch("/api/feedback?type=rules"),
        fetch("/api/articles?relevance=irrelevant&limit=50"),
      ]);

      const [logsJson, rulesJson, excludedJson] = await Promise.all([
        logsRes.json(),
        rulesRes.json(),
        excludedRes.json(),
      ]);

      setFeedbackLogs(logsJson.data ?? []);
      setRules(rulesJson.data ?? []);
      setExcluded(excludedJson.data ?? []);
    } catch {
      // Ignore — empty state shown
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function handleDeleteRule(id: string) {
    const prev = rules;
    setRules((r) => r.filter((rule) => rule.id !== id));
    try {
      const res = await fetch(`/api/noise-rules?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      setRules(prev);
    }
  }

  async function handleToggleRule(id: string, current: boolean) {
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, is_active: !current } : r));
    try {
      const res = await fetch("/api/noise-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_active: !current }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      setRules((prev) => prev.map((r) => r.id === id ? { ...r, is_active: current } : r));
    }
  }

  async function handleRestore(articleId: string, stockId: string) {
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article_id: articleId,
          stock_id: stockId,
          feedback_type: "cancel",
        }),
      });
      setExcluded((prev) => prev.filter((a) => a.id !== articleId));
    } catch {
      // Reload if something went wrong
      loadAll();
    }
  }

  const TABS = [
    { key: "logs" as const, label: "フィードバック一覧", count: feedbackLogs.length },
    { key: "rules" as const, label: "キーワードルール", count: rules.length },
    { key: "excluded" as const, label: "除外候補記事", count: excluded.length },
  ];

  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-sm text-zinc-500">フィードバック管理</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === t.key
                ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-500 rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-12 text-zinc-400">読み込み中…</div>
      ) : (
        <>
          {activeTab === "logs" && <FeedbackLogsSection logs={feedbackLogs} />}
          {activeTab === "rules" && (
            <KeywordRulesSection
              rules={rules}
              onDelete={handleDeleteRule}
              onToggle={handleToggleRule}
            />
          )}
          {activeTab === "excluded" && (
            <ExcludedArticlesSection articles={excluded} onRestore={handleRestore} />
          )}
        </>
      )}
    </div>
  );
}

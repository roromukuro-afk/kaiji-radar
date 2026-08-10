import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { formatJST, formatRelative, sourceTypeLabel, sourceTypeColor } from "@/lib/utils";
import { eventTypeLabel } from "@/lib/classifiers/event-type";
import Link from "next/link";
import { NotifyEventTypesSettings } from "./NotifyEventTypesSettings";
import { RssUrlsSettings } from "./RssUrlsSettings";
import { IrSourcesSettings } from "./IrSourcesSettings";

type TabKey = "all" | "important" | "tdnet" | "edinet" | "official" | "pr_times" | "jp_news" | "en_news" | "uncertain" | "excluded";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all",      label: "すべて" },
  { key: "important", label: "★重要" },
  { key: "tdnet",    label: "TDnet" },
  { key: "edinet",   label: "EDINET" },
  { key: "official", label: "公式" },
  { key: "pr_times", label: "PR TIMES" },
  { key: "jp_news",  label: "国内" },
  { key: "en_news",  label: "海外" },
  { key: "uncertain", label: "関連不確実" },
  { key: "excluded", label: "除外候補" },
];

export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { code } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: TabKey = (TABS.map((t) => t.key).includes(rawTab as TabKey) ? rawTab : "all") as TabKey;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch stock + profile
  const { data: stock } = await supabase
    .from("stocks")
    .select("*, stock_profiles (*)")
    .eq("code", code)
    .neq("status", "deleted")
    .single();

  if (!stock) notFound();

  const profile = stock.stock_profiles as {
    exchange: string | null;
    sector: string | null;
    official_url: string | null;
    ir_url: string | null;
    jp_keywords: string[] | null;
    en_keywords: string[] | null;
    notify_event_types: string[] | null;
    rss_urls: string[] | null;
  } | null;

  // ── Count query: full stats across all articles for this stock ──
  // is_event_representative=trueのみ集計(同一事象へ統合された記事は代表記事1件分としてカウントする)
  const { data: allArticleData } = await supabase
    .from("articles")
    .select(`id, source_type, is_read, relevance, is_important, article_stocks!inner(stock_id)`)
    .eq("article_stocks.stock_id", stock.id)
    .eq("is_event_representative", true)
    .limit(2000);

  const allArticles = allArticleData ?? [];
  const totalCount   = allArticles.length;
  const unreadCount  = allArticles.filter((a) => !a.is_read).length;
  const tdnetCount   = allArticles.filter((a) => a.source_type === "tdnet").length;
  const edinetCount  = allArticles.filter((a) => a.source_type === "edinet").length;
  const jpCount      = allArticles.filter((a) => a.source_type === "jp_news").length;
  const enCount      = allArticles.filter((a) => a.source_type === "en_news").length;
  const uncertainCount = allArticles.filter((a) => a.relevance === "uncertain").length;
  const importantCount = allArticles.filter((a) => a.is_important).length;

  // ── Filtered article list query ──
  type ArticleRow = {
    id: string;
    source_type: string;
    title: string;
    title_ja: string | null;
    publisher: string | null;
    published_at: string | null;
    is_read: boolean;
    is_pdf: boolean;
    is_important: boolean;
    event_type: string | null;
    importance: string | null;
    relevance: string | null;
    is_overseas: boolean;
    article_events: { member_count: number } | { member_count: number }[] | null;
    article_stocks: { stock_id: string }[];
  };

  let filteredQuery = supabase
    .from("articles")
    .select(`
      id, source_type, title, title_ja, publisher, published_at, is_read, is_pdf, is_important, event_type, importance, relevance, is_overseas,
      article_events (member_count),
      article_stocks!inner (stock_id)
    `)
    .eq("article_stocks.stock_id", stock.id)
    .eq("is_event_representative", true)
    .order("published_at", { ascending: false })
    .limit(100);

  if (tab === "tdnet")    filteredQuery = filteredQuery.eq("source_type", "tdnet");
  else if (tab === "edinet")   filteredQuery = filteredQuery.eq("source_type", "edinet");
  else if (tab === "jp_news")  filteredQuery = filteredQuery.eq("source_type", "jp_news");
  else if (tab === "en_news")  filteredQuery = filteredQuery.eq("source_type", "en_news");
  else if (tab === "official") filteredQuery = filteredQuery.eq("source_type", "official");
  else if (tab === "pr_times") filteredQuery = filteredQuery.eq("source_type", "pr_times");
  else if (tab === "uncertain") filteredQuery = filteredQuery.eq("relevance", "uncertain");
  else if (tab === "excluded")  filteredQuery = filteredQuery.eq("relevance", "irrelevant");
  else if (tab === "important") filteredQuery = filteredQuery.eq("is_important", true);

  const { data: articles } = await filteredQuery;
  const filteredArticles = (articles ?? []) as ArticleRow[];

  const { data: irSources } = await supabase
    .from("stock_ir_sources")
    .select("id, url, enabled, last_checked_at, last_success_at, consecutive_failures, last_error")
    .eq("stock_id", stock.id)
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <Link
        href="/stocks"
        className="inline-block text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        ← 一覧
      </Link>

      <div className="space-y-6">
        {/* ── Stock header ── */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-lg font-bold">{stock.code}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              stock.status === "active"
                ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
            }`}>
              {stock.status === "active" ? "監視中" : stock.status === "paused" ? "停止中" : stock.status}
            </span>
          </div>
          <h1 className="text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
            {stock.name}
          </h1>
          {profile && (
            <p className="text-sm text-zinc-500">
              {[profile.exchange, profile.sector].filter(Boolean).join(" · ")}
            </p>
          )}
          <div className="flex gap-3 flex-wrap">
            {profile?.official_url && (
              <a
                href={profile.official_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                公式サイト ↗
              </a>
            )}
            {profile?.ir_url && (
              <a
                href={profile.ir_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                IR情報 ↗
              </a>
            )}
          </div>
        </div>

        {/* ── Stats grid ── */}
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {[
            { label: "全記事",     value: totalCount },
            { label: "未読",       value: unreadCount },
            { label: "★重要",     value: importantCount },
            { label: "TDnet",      value: tdnetCount },
            { label: "EDINET",     value: edinetCount },
            { label: "国内",       value: jpCount },
            { label: "海外",       value: enCount },
            { label: "関連不確実", value: uncertainCount },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 text-center"
            >
              <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{stat.value}</p>
              <p className="text-xs text-zinc-500 mt-0.5 whitespace-nowrap">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* ── Tab row ── */}
        <div className="flex gap-1 flex-wrap">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/stocks/${code}?tab=${t.key}`}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {/* ── Article list ── */}
        <section className="space-y-2">
          {filteredArticles.length === 0 ? (
            <p className="text-sm text-zinc-400 py-8 text-center">
              {tab === "excluded" ? "除外候補の記事はありません" : "記事がありません"}
            </p>
          ) : filteredArticles.map((a) => {
            const eventInfo = Array.isArray(a.article_events) ? a.article_events[0] : a.article_events;
            const relatedCount = (eventInfo?.member_count ?? 1) - 1;
            return (
            <Link
              key={a.id}
              href={`/article/${a.id}`}
              className={`block rounded-xl border p-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                a.is_read
                  ? "border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950"
                  : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-950"
              }`}
            >
              <div className="flex items-start gap-2">
                {!a.is_read && (
                  <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-blue-500" />
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  {/* Badges */}
                  <div className="flex flex-wrap gap-1 items-center">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${sourceTypeColor(a.source_type)}`}>
                      {sourceTypeLabel(a.source_type)}
                    </span>
                    {a.is_important && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 font-semibold border border-red-200 dark:border-red-800">
                        ★重要
                      </span>
                    )}
                    {a.is_pdf && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                        PDF
                      </span>
                    )}
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
                    {a.relevance === "uncertain" && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200">
                        関連不確実
                      </span>
                    )}
                    {a.relevance === "irrelevant" && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300">
                        除外候補
                      </span>
                    )}
                    {relatedCount > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                        関連記事 {relatedCount}件
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <p className={`text-sm leading-snug ${
                    a.is_read
                      ? "text-zinc-500 dark:text-zinc-400"
                      : "text-zinc-900 dark:text-zinc-100 font-medium"
                  }`}>
                    {a.is_overseas && a.title_ja ? (
                      <>
                        <span className="text-zinc-400 dark:text-zinc-500 font-normal">[{a.title_ja}]</span>{" "}
                        {a.title}
                      </>
                    ) : a.title}
                  </p>

                  {/* Meta */}
                  <p className="text-xs text-zinc-400">
                    {a.publisher && `${a.publisher} · `}
                    {a.published_at ? formatRelative(a.published_at) : ""}
                    {a.published_at && <span className="ml-1 text-zinc-300 dark:text-zinc-600">({formatJST(a.published_at)})</span>}
                  </p>
                </div>
              </div>
            </Link>
            );
          })}
        </section>

        {/* ── Monitoring profile ── */}
        {profile && (
          <section className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-4 space-y-3">
            <h2 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">監視プロフィール</h2>

            {profile.jp_keywords && profile.jp_keywords.length > 0 && (
              <div>
                <p className="text-xs text-zinc-500 mb-1">キーワード (JP)</p>
                <div className="flex flex-wrap gap-1">
                  {profile.jp_keywords.map((kw) => (
                    <span
                      key={kw}
                      className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {profile.en_keywords && profile.en_keywords.length > 0 && (
              <div>
                <p className="text-xs text-zinc-500 mb-1">キーワード (EN)</p>
                <div className="flex flex-wrap gap-1">
                  {profile.en_keywords.map((kw) => (
                    <span
                      key={kw}
                      className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1">
              {profile.official_url && (
                <p className="text-xs text-zinc-500">
                  公式URL:{" "}
                  <a
                    href={profile.official_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                  >
                    {profile.official_url}
                  </a>
                </p>
              )}
              {profile.ir_url && (
                <p className="text-xs text-zinc-500">
                  IR URL:{" "}
                  <a
                    href={profile.ir_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                  >
                    {profile.ir_url}
                  </a>
                </p>
              )}
            </div>
          </section>
        )}

        {/* ── RSS settings ── */}
        <RssUrlsSettings
          stockId={stock.id}
          initialUrls={profile?.rss_urls ?? []}
        />

        {/* ── IR page monitoring settings ── */}
        <IrSourcesSettings
          stockId={stock.id}
          initialSources={irSources ?? []}
        />

        {/* ── Notification settings ── */}
        <NotifyEventTypesSettings
          stockId={stock.id}
          initialTypes={profile?.notify_event_types ?? null}
        />
      </div>
    </div>
  );
}

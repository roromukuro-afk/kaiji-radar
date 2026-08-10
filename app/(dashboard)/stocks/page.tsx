import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

type StockProfile = {
  exchange: string | null;
  sector: string | null;
};

type Stock = {
  id: string;
  code: string;
  name: string;
  status: string;
  // Supabase returns one-to-one joins as an array; we treat it as array here
  stock_profiles: StockProfile[] | StockProfile | null;
};

type ArticleStockRow = {
  stock_id: string;
  articles: {
    id: string;
    is_read: boolean;
    is_important: boolean;
    published_at: string | null;
    created_at: string;
  };
};

export default async function StocksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch all non-deleted stocks with profiles
  const { data: stocksData } = await supabase
    .from("stocks")
    .select("id, code, name, status, stock_profiles (exchange, sector)")
    .neq("status", "deleted")
    .order("code", { ascending: true });

  const stocks = (stocksData ?? []) as unknown as Stock[];

  // Fetch all article_stocks with article metadata in one query
  const { data: articleStocksData } = await supabase
    .from("article_stocks")
    .select("stock_id, articles!inner (id, is_read, is_important, published_at, created_at)")
    .order("articles.published_at", { ascending: false });

  const articleStocks = (articleStocksData ?? []) as unknown as ArticleStockRow[];

  // Aggregate per stock_id
  const now = Date.now();
  const h24ago = now - 24 * 60 * 60 * 1000;

  type StockStats = {
    total: number;
    unread: number;
    last24h: number;
    importantUnread: number;
  };

  const statsMap = new Map<string, StockStats>();

  for (const row of articleStocks) {
    const sid = row.stock_id;
    if (!statsMap.has(sid)) {
      statsMap.set(sid, { total: 0, unread: 0, last24h: 0, importantUnread: 0 });
    }
    const s = statsMap.get(sid)!;
    s.total += 1;
    if (!row.articles.is_read) s.unread += 1;
    if (!row.articles.is_read && row.articles.is_important) s.importantUnread += 1;
    const pub = row.articles.published_at ?? row.articles.created_at;
    if (pub && new Date(pub).getTime() >= h24ago) s.last24h += 1;
  }

  // Sort: active first, then by code
  const active  = stocks.filter((s) => s.status === "active");
  const paused  = stocks.filter((s) => s.status !== "active");
  const sorted  = [...active, ...paused];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
          監視銘柄一覧
        </h1>
        <span className="text-sm text-zinc-400">{stocks.length} 銘柄</span>
      </div>

      <Link
        href="/stocks/calendar"
        className="block rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        開示予定カレンダーを見る →
      </Link>

      {/* Active section */}
      {active.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
            監視中 ({active.length})
          </p>
          {active.map((stock) => (
            <StockCard key={stock.id} stock={stock} stats={statsMap.get(stock.id)} />
          ))}
        </section>
      )}

      {/* Paused/other section */}
      {paused.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mt-4">
            停止中 ({paused.length})
          </p>
          {paused.map((stock) => (
            <StockCard key={stock.id} stock={stock} stats={statsMap.get(stock.id)} />
          ))}
        </section>
      )}

      {stocks.length === 0 && (
        <p className="text-sm text-zinc-400 py-12 text-center">
          監視銘柄がありません
        </p>
      )}
    </div>
  );
}

function StockCard({
  stock,
  stats,
}: {
  stock: Stock;
  stats: { total: number; unread: number; last24h: number; importantUnread: number } | undefined;
}) {
  const total   = stats?.total   ?? 0;
  const unread  = stats?.unread  ?? 0;
  const last24h = stats?.last24h ?? 0;
  const importantUnread = stats?.importantUnread ?? 0;
  // Supabase may return join as array or object depending on client version
  const profile: StockProfile | null = Array.isArray(stock.stock_profiles)
    ? (stock.stock_profiles[0] ?? null)
    : (stock.stock_profiles ?? null);

  return (
    <Link
      href={`/stocks/${stock.code}`}
      className="block rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: code + name + exchange */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {stock.code}
            </span>
            {stock.status !== "active" && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                停止中
              </span>
            )}
            {unread > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-500 text-white font-medium">
                {unread}
              </span>
            )}
            {importantUnread > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 font-semibold border border-red-200 dark:border-red-800">
                ★{importantUnread}
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-800 dark:text-zinc-200 truncate">{stock.name}</p>
          {profile && (profile.exchange || profile.sector) && (
            <p className="text-xs text-zinc-400">
              {[profile.exchange, profile.sector].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        {/* Right: stats */}
        <div className="flex-shrink-0 text-right space-y-0.5">
          <div className="flex items-center gap-2 justify-end text-xs text-zinc-500">
            <span>未読</span>
            <span className={`font-semibold ${unread > 0 ? "text-blue-600 dark:text-blue-400" : "text-zinc-400"}`}>
              {unread}
            </span>
          </div>
          <div className="flex items-center gap-2 justify-end text-xs text-zinc-500">
            <span>24h</span>
            <span className={`font-semibold ${last24h > 0 ? "text-green-600 dark:text-green-400" : "text-zinc-400"}`}>
              {last24h}
            </span>
          </div>
          <div className="flex items-center gap-2 justify-end text-xs text-zinc-500">
            <span>全記事</span>
            <span className="font-semibold text-zinc-600 dark:text-zinc-400">{total}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

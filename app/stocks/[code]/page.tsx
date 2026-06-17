import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { formatJST, sourceTypeLabel, sourceTypeColor } from "@/lib/utils";
import Link from "next/link";

export default async function StockPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: stock } = await supabase
    .from("stocks")
    .select("*, stock_profiles (*)")
    .eq("code", code)
    .neq("status", "deleted")
    .single();

  if (!stock) notFound();

  const { data: articles, count } = await supabase
    .from("articles")
    .select(`
      id, source_type, title, title_ja, publisher, published_at, is_read, is_pdf, relevance, is_overseas, is_paywalled,
      article_stocks!inner (stock_id)
    `, { count: "exact" })
    .eq("article_stocks.stock_id", stock.id)
    .order("published_at", { ascending: false })
    .limit(100);

  const profile = stock.stock_profiles;

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 h-12 flex items-center gap-3">
          <Link href="/manage" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            ← 銘柄一覧
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Stock info */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-bold">{stock.code}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              stock.status === "active" ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" :
              "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
            }`}>
              {stock.status === "active" ? "監視中" : stock.status === "paused" ? "停止中" : stock.status}
            </span>
          </div>
          <h1 className="text-xl font-semibold">{stock.name}</h1>
          {profile && (
            <p className="text-sm text-zinc-500">
              {[profile.exchange, profile.sector].filter(Boolean).join(" · ")}
            </p>
          )}
          {profile?.official_url && (
            <a
              href={profile.official_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400"
            >
              公式IR ↗
            </a>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "全記事", value: count ?? 0 },
            { label: "未読", value: articles?.filter((a) => !a.is_read).length ?? 0 },
            { label: "TDnet", value: articles?.filter((a) => a.source_type === "tdnet").length ?? 0 },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 text-center">
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Article list */}
        <section className="space-y-2">
          <h2 className="font-semibold text-sm text-zinc-500">記事一覧</h2>
          {!articles || articles.length === 0 ? (
            <p className="text-sm text-zinc-400 py-4 text-center">記事がありません</p>
          ) : articles.map((a: any) => (
            <Link
              key={a.id}
              href={`/article/${a.id}`}
              className={`block rounded-xl border p-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                a.is_read
                  ? "border-zinc-100 dark:border-zinc-800"
                  : "border-zinc-300 dark:border-zinc-600"
              }`}
            >
              <div className="flex items-start gap-2">
                {!a.is_read && (
                  <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-blue-500" />
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap gap-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${sourceTypeColor(a.source_type)}`}>
                      {sourceTypeLabel(a.source_type)}
                    </span>
                    {a.is_pdf && <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">PDF</span>}
                    {a.relevance === "uncertain" && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200">関連不確実</span>
                    )}
                  </div>
                  <p className={`text-sm leading-snug ${a.is_read ? "text-zinc-500" : "text-zinc-900 dark:text-zinc-100 font-medium"}`}>
                    {a.is_overseas && a.title_ja ? `[${a.title_ja}] ` : ""}
                    {a.title}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {a.publisher && `${a.publisher} · `}
                    {a.published_at ? formatJST(a.published_at) : ""}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}

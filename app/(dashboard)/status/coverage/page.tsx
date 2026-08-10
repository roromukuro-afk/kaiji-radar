import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatRelative, sourceTypeLabel } from "@/lib/utils";
import { deriveCoverageStatus, COVERAGE_STATUS_LABEL, type CoverageStatus } from "@/lib/coverage/status";

const SOURCE_TYPES = ["tdnet", "edinet", "official", "pr_times", "jp_news", "en_news"] as const;

const STATUS_COLOR: Record<CoverageStatus, string> = {
  normal: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200",
  no_new: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500",
  not_configured: "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 border border-dashed border-zinc-300 dark:border-zinc-700",
  fetch_failed: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
  long_quiet: "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200",
};

type CoverageRow = {
  stock_id: string;
  source_type: string;
  is_configured: boolean;
  last_checked_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
};

type IrSourceRow = {
  stock_id: string;
  enabled: boolean;
  last_checked_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
};

function latest(dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => !!d);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b));
}

export default async function CoveragePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: stocks } = await supabase
    .from("stocks")
    .select("id, code, name")
    .eq("status", "active")
    .order("code");
  const stockList = stocks ?? [];

  const [{ data: coverageRows }, { data: irRows }] = await Promise.all([
    supabase.from("stock_source_coverage").select("*"),
    supabase.from("stock_ir_sources").select("stock_id, enabled, last_checked_at, last_success_at, consecutive_failures, last_error"),
  ]);

  const coverageMap = new Map<string, CoverageRow>();
  for (const row of (coverageRows ?? []) as CoverageRow[]) {
    coverageMap.set(`${row.stock_id}:${row.source_type}`, row);
  }
  const irByStock = new Map<string, IrSourceRow[]>();
  for (const row of (irRows ?? []) as IrSourceRow[]) {
    const list = irByStock.get(row.stock_id) ?? [];
    list.push(row);
    irByStock.set(row.stock_id, list);
  }

  // 銘柄×情報源ごとの「最終記事日時」は毎時ジョブでは記録されないため、ここで実測する
  // (articlesが正のソースなので二重管理せず、都度クエリで求める)
  const lastArticleResults = await Promise.all(
    stockList.flatMap((stock) =>
      SOURCE_TYPES.map(async (sourceType) => {
        const { data } = await supabase
          .from("articles")
          .select("published_at, article_stocks!inner(stock_id)")
          .eq("source_type", sourceType)
          .eq("article_stocks.stock_id", stock.id)
          .order("published_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return { key: `${stock.id}:${sourceType}`, lastArticleAt: (data?.published_at as string | undefined) ?? null };
      })
    )
  );
  const lastArticleMap = new Map(lastArticleResults.map((r) => [r.key, r.lastArticleAt]));

  type Cell = {
    sourceType: string;
    status: CoverageStatus;
    lastChecked: string | null;
    lastSuccess: string | null;
    lastArticle: string | null;
    consecutiveFailures: number;
    lastError: string | null;
  };

  const stockCells = stockList.map((stock) => {
    const cells: Cell[] = SOURCE_TYPES.map((sourceType) => {
      const lastArticle = lastArticleMap.get(`${stock.id}:${sourceType}`) ?? null;

      if (sourceType === "official") {
        // 企業公式RSSとIRページ直接監視(Feature 2)を合成して1つの状態にする
        const rssRow = coverageMap.get(`${stock.id}:official`);
        const irRowsForStock = (irByStock.get(stock.id) ?? []).filter((r) => r.enabled);
        const isConfigured = (rssRow?.is_configured ?? false) || irRowsForStock.length > 0;
        const lastChecked = latest([rssRow?.last_checked_at, ...irRowsForStock.map((r) => r.last_checked_at)]);
        const lastSuccess = latest([rssRow?.last_success_at, ...irRowsForStock.map((r) => r.last_success_at)]);
        const consecutiveFailures = Math.max(
          rssRow?.consecutive_failures ?? 0,
          ...irRowsForStock.map((r) => r.consecutive_failures ?? 0),
          0
        );
        const lastError = irRowsForStock.find((r) => r.last_error)?.last_error ?? rssRow?.last_error ?? null;
        const status = deriveCoverageStatus({
          is_configured: isConfigured,
          last_checked_at: lastChecked,
          last_success_at: lastSuccess,
          last_article_at: lastArticle,
          consecutive_failures: consecutiveFailures,
        });
        return { sourceType, status, lastChecked, lastSuccess, lastArticle, consecutiveFailures, lastError };
      }

      const row = coverageMap.get(`${stock.id}:${sourceType}`);
      const status = deriveCoverageStatus({
        is_configured: row?.is_configured ?? true,
        last_checked_at: row?.last_checked_at ?? null,
        last_success_at: row?.last_success_at ?? null,
        last_article_at: lastArticle,
        consecutive_failures: row?.consecutive_failures ?? 0,
      });
      return {
        sourceType, status,
        lastChecked: row?.last_checked_at ?? null,
        lastSuccess: row?.last_success_at ?? null,
        lastArticle,
        consecutiveFailures: row?.consecutive_failures ?? 0,
        lastError: row?.last_error ?? null,
      };
    });
    return { stock, cells };
  });

  const summary: Record<CoverageStatus, number> = { normal: 0, no_new: 0, not_configured: 0, fetch_failed: 0, long_quiet: 0 };
  for (const { cells } of stockCells) {
    for (const cell of cells) summary[cell.status]++;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/status" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← 状態
        </Link>
      </div>
      <h1 className="text-lg font-semibold">銘柄別情報源カバレッジ</h1>
      <p className="text-xs text-zinc-500">
        銘柄×情報源ごとに、設定状況・最終確認・連続失敗・最終記事日時から状態を判定します。
        official列は企業公式RSSとIRページ直接監視(パイロット)を合成した状態です。
      </p>

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(COVERAGE_STATUS_LABEL) as CoverageStatus[]).map((s) => (
          <span key={s} className={`text-xs px-2 py-1 rounded-lg font-medium ${STATUS_COLOR[s]}`}>
            {COVERAGE_STATUS_LABEL[s]} {summary[s]}
          </span>
        ))}
      </div>

      <div className="space-y-2">
        {stockCells.map(({ stock, cells }) => (
          <div key={stock.id} className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 space-y-2">
            <Link href={`/stocks/${stock.code}`} className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:underline">
              {stock.code} {stock.name}
            </Link>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {cells.map((cell) => (
                <div
                  key={cell.sourceType}
                  title={
                    cell.lastError
                      ? `${cell.lastError}`
                      : cell.lastArticle
                      ? `最終記事: ${formatRelative(cell.lastArticle)}`
                      : "記事なし"
                  }
                  className={`rounded-lg px-1.5 py-1 text-center ${STATUS_COLOR[cell.status]}`}
                >
                  <p className="text-[10px] font-medium leading-tight">{sourceTypeLabel(cell.sourceType)}</p>
                  <p className="text-[10px] leading-tight">{COVERAGE_STATUS_LABEL[cell.status]}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

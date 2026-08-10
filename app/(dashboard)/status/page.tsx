"use client";

import { useEffect, useState } from "react";
import { formatJST, formatRelative } from "@/lib/utils";

type HealthCheck = {
  source: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  status: string;
  error_message: string | null;
};

type SourceStats = {
  candidates: number;
  saved: number;
  skipped: number;
  updated: number;
  errors: number;
};

type TdnetDiag = {
  source_used: "tier1_yanoshin" | "tier2_yahoo" | "mixed" | "failed";
  tier1_ok: boolean;
  tier1_stocks: number;
  tier2_stocks: number;
  failed_stocks: string[];
};

type SourceResults = {
  stocks_count?: number;
  duration_seconds?: number;
  total?: { candidates: number; saved: number; skipped: number; updated: number };
  per_source?: {
    tdnet?: SourceStats;
    edinet?: SourceStats;
    official?: SourceStats;
    jp_news?: SourceStats;
    en_news?: SourceStats;
  };
  tdnet_diag?: TdnetDiag;
};

type FetchJob = {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  articles_found: number;
  articles_saved: number;
  tdnet_count: number;
  edinet_count: number;
  official_count: number;
  jp_news_count: number;
  en_news_count: number;
  error_message: string | null;
  source_results: SourceResults | null;
};

type BackupLog = {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  file_name: string | null;
  file_size_bytes: number | null;
};

type OperationLog = {
  id: string;
  action: string;
  result: string;
  created_at: string;
  details: Record<string, any> | null;
};

type PushSubscription = {
  id: string;
  endpoint: string;
  created_at: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
};

type Capacity = {
  articles: number;
  notification_history: number;
  fetch_jobs: number;
  pdf_bytes: number;
  backup_bytes: number;
};

const SOURCE_LABELS: Record<string, string> = {
  tdnet_yanoshi: "TDnet (やのしん)",
  tdnet_direct: "TDnet (直接)",
  edinet: "EDINET",
  google_news_jp: "Googleニュース (JP)",
  google_news_en: "Googleニュース (EN)",
  google_news_url_resolve: "Google News実URL解決",
  pr_times: "PR TIMES",
  claude_api: "Claude API",
  web_push: "Web Push",
  email_resend: "メール (Resend)",
  supabase_storage: "Supabase Storage",
};

function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StatusPage() {
  const [data, setData] = useState<{
    health_checks: HealthCheck[];
    recent_jobs: FetchJob[];
    recent_backups: BackupLog[];
    last_hourly_run: string | null;
    storage_bytes: number;
    operation_logs: OperationLog[];
    capacity: Capacity;
    push_subscriptions: PushSubscription[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, []);

  if (loading) return <div className="text-center py-12 text-zinc-400">読み込み中…</div>;
  if (!data) return <div className="text-center py-12 text-zinc-400">データ取得失敗</div>;

  // hourly-fetch.ymlは毎時5分実行。3時間(通常ルックバック相当)を超えて
  // 実行記録が無ければ、GitHub Actions自体が止まっている疑いとして扱う。
  const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000;
  const lastRunAt = data.last_hourly_run ? new Date(data.last_hourly_run).getTime() : null;
  const isStale = lastRunAt === null || Date.now() - lastRunAt > STALE_THRESHOLD_MS;

  // key_missing(意図的な未設定)は問題扱いしない。google_news_url_resolveは
  // 失敗時も元のGoogle Newsリンクへフォールバックし記事保存自体は続くため、
  // 全体判定には含めず個別ステータス表示のみに留める。degraded/failedと
  // consecutive_failures>=3は、連続失敗回数だけでは拾えない「一部劣化」も含めて反映する。
  // ir_pageはパイロット運用(少数銘柄のみ)のため、未整備・失敗があっても全体判定には含めない。
  const NON_BLOCKING_SOURCES = new Set(["google_news_url_resolve", "ir_page"]);
  const relevantChecks = data.health_checks.filter((h) => !NON_BLOCKING_SOURCES.has(h.source));
  const degradedSources = relevantChecks.filter((h) => h.status === "degraded");
  const failedSources = relevantChecks.filter(
    (h) => h.status === "failed" || (h.status !== "key_missing" && h.consecutive_failures >= 3)
  );
  const hasProblem = degradedSources.length > 0 || failedSources.length > 0;
  const overallOk = !hasProblem && !isStale;

  const summaryDetail = isStale
    ? `最終実行から${STALE_THRESHOLD_MS / 3600000}時間以上経過(GitHub Actions停止の疑い)`
    : failedSources.length > 0
      ? `${failedSources.map((h) => SOURCE_LABELS[h.source] ?? h.source).join(", ")} が連続失敗中`
      : degradedSources.length > 0
        ? `${degradedSources.map((h) => SOURCE_LABELS[h.source] ?? h.source).join(", ")} が一部劣化中`
        : null;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className={`rounded-xl p-4 ${overallOk ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"}`}>
        <div className="flex items-center gap-2">
          <span className={`text-lg ${overallOk ? "" : "animate-pulse"}`}>{overallOk ? "✓" : "!"}</span>
          <div>
            <p className={`font-semibold text-sm ${overallOk ? "text-green-800 dark:text-green-200" : "text-red-800 dark:text-red-200"}`}>
              {overallOk ? "全システム正常" : "一部に問題があります"}
            </p>
            {summaryDetail && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{summaryDetail}</p>
            )}
            {data.last_hourly_run && (
              <p className="text-xs text-zinc-500 mt-0.5">
                最終更新: {formatRelative(data.last_hourly_run)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Capacity */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
        <h2 className="font-semibold text-sm">容量・使用量</h2>
        {/* Storage bar */}
        {(() => {
          const cap = data.capacity ?? { articles: 0, notification_history: 0, fetch_jobs: 0, pdf_bytes: 0, backup_bytes: 0 };
          const totalStorage = cap.pdf_bytes + cap.backup_bytes;
          const storagePct = Math.min(100, (totalStorage / (1024 * 1024 * 1024)) * 100);
          const warnStorage = storagePct > 70;
          return (
            <>
              <div>
                <div className="flex justify-between text-xs text-zinc-500 mb-1">
                  <span>Supabase Storage</span>
                  <span className={warnStorage ? "text-red-500 font-medium" : ""}>{fmtBytes(totalStorage)} / 1 GB</span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div className={`h-1.5 rounded-full ${warnStorage ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${storagePct}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {[
                  ["記事数", cap.articles.toLocaleString(), cap.articles > 50000],
                  ["通知履歴", cap.notification_history.toLocaleString(), cap.notification_history > 100000],
                  ["PDFストレージ", fmtBytes(cap.pdf_bytes), cap.pdf_bytes > 800 * 1024 * 1024],
                  ["バックアップ", fmtBytes(cap.backup_bytes), false],
                ].map(([label, val, warn]) => (
                  <div key={label as string} className="flex justify-between text-xs">
                    <span className="text-zinc-500">{label as string}</span>
                    <span className={warn ? "text-yellow-600 dark:text-yellow-400 font-medium" : "text-zinc-700 dark:text-zinc-300"}>{val as string}</span>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      {/* Health checks */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm text-zinc-500">ソース別ステータス</h2>
        {data.health_checks.map((h) => (
          <HealthRow key={h.source} check={h} />
        ))}
      </section>

      {/* Push subscriptions (端末別) */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm text-zinc-500">登録デバイス(Push通知)</h2>
        {(data.push_subscriptions ?? []).length === 0 ? (
          <p className="text-sm text-zinc-400">登録済みデバイスなし</p>
        ) : (data.push_subscriptions ?? []).map((s) => {
          const broken = s.consecutive_failures >= 3;
          return (
            <div key={s.id} className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500 font-mono truncate">…{s.endpoint.slice(-24)}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                  broken
                    ? "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
                    : s.consecutive_failures > 0
                      ? "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300"
                      : "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
                }`}>
                  {broken ? "配信不可の疑い" : s.consecutive_failures > 0 ? `連続失敗${s.consecutive_failures}回` : "正常"}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                登録: {formatRelative(s.created_at)}
                {s.last_success_at && ` · 最終成功: ${formatRelative(s.last_success_at)}`}
                {s.last_failure_at && ` · 最終失敗: ${formatRelative(s.last_failure_at)}`}
              </p>
            </div>
          );
        })}
      </section>

      {/* Recent jobs */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm text-zinc-500">最近の取得ジョブ</h2>
        {data.recent_jobs.length === 0 ? (
          <p className="text-sm text-zinc-400">ジョブ履歴なし</p>
        ) : data.recent_jobs.map((j) => (
          <FetchJobCard key={j.id} job={j} />
        ))}
      </section>

      {/* Backups */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm text-zinc-500">バックアップ履歴</h2>
        {data.recent_backups.length === 0 ? (
          <p className="text-sm text-zinc-400">バックアップ履歴なし</p>
        ) : data.recent_backups.map((b) => (
          <div key={b.id} className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-600 dark:text-zinc-400">{b.file_name ?? "—"}</span>
              <div className="flex items-center gap-2">
                {b.file_size_bytes && (
                  <span className="text-xs text-zinc-400">{fmtBytes(b.file_size_bytes)}</span>
                )}
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  b.status === "completed" ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" : "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
                }`}>
                  {b.status === "completed" ? "成功" : "失敗"}
                </span>
              </div>
            </div>
            <p className="text-xs text-zinc-400 mt-1">{formatRelative(b.started_at)}</p>
          </div>
        ))}
      </section>

      {/* Operation logs */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm text-zinc-500">操作履歴</h2>
        {(data.operation_logs ?? []).length === 0 ? (
          <p className="text-sm text-zinc-400">操作履歴なし</p>
        ) : (data.operation_logs ?? []).map((l) => (
          <div key={l.id} className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-700 dark:text-zinc-300 font-medium">
                {l.action === "manual_fetch" ? "手動フェッチ" : l.action}
              </span>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  l.result === "success" ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" : "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
                }`}>
                  {l.result === "success" ? "成功" : l.result}
                </span>
                <span className="text-xs text-zinc-400">{formatRelative(l.created_at)}</span>
              </div>
            </div>
            {l.details?.triggered_by && (
              <p className="text-xs text-zinc-400 mt-0.5">{l.details.triggered_by}</p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function FetchJobCard({ job: j }: { job: FetchJob }) {
  const sr = j.source_results;
  const ps = sr?.per_source;
  return (
    <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
          j.status === "completed" ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" :
          j.status === "running"   ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200" :
          "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
        }`}>
          {j.status === "completed" ? "完了" : j.status === "running" ? "実行中" : "エラー"}
        </span>
        <div className="flex items-center gap-2">
          {sr?.duration_seconds != null && (
            <span className="text-xs text-zinc-400">{sr.duration_seconds}s</span>
          )}
          {sr?.stocks_count != null && (
            <span className="text-xs text-zinc-400">{sr.stocks_count}銘柄</span>
          )}
          <span className="text-xs text-zinc-400">{formatRelative(j.started_at)}</span>
        </div>
      </div>
      {j.status === "completed" && sr?.total && (
        <p className="text-xs text-zinc-500">
          候補 {sr.total.candidates} / 新着 {sr.total.saved} / スキップ {sr.total.skipped}
          {sr.total.updated > 0 && ` / 更新 ${sr.total.updated}`}
        </p>
      )}
      {j.status === "completed" && ps && (
        <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
          {[
            ["TDnet", ps.tdnet],
            ["EDINET", ps.edinet],
            ["国内", ps.jp_news],
            ["海外", ps.en_news],
            ["公式", ps.official],
          ].map(([label, s]) => s && (s as SourceStats).candidates > 0 ? (
            <p key={label as string} className="text-xs text-zinc-400">
              {label as string}: <span className="text-zinc-600 dark:text-zinc-300">{(s as SourceStats).saved}</span>/{(s as SourceStats).candidates}
            </p>
          ) : null)}
        </div>
      )}
      {j.status === "completed" && sr?.tdnet_diag && <TdnetDiagRow diag={sr.tdnet_diag} stocksCount={sr.stocks_count} />}
      {!sr && j.status === "completed" && (
        <p className="text-xs text-zinc-500">
          TDnet {j.tdnet_count} / EDINET {j.edinet_count} / 国内 {j.jp_news_count} / 海外 {j.en_news_count} 件
        </p>
      )}
      {j.error_message && (
        <p className="text-xs text-red-500 truncate">{j.error_message}</p>
      )}
    </div>
  );
}

function TdnetDiagRow({ diag, stocksCount }: { diag: TdnetDiag; stocksCount?: number }) {
  const failed = diag.failed_stocks?.length ?? 0;
  const total = stocksCount ?? (diag.tier1_stocks + diag.tier2_stocks + failed);
  const allFailed = diag.source_used === "failed" || failed > total / 2;
  const partialFail = failed > 0 && !allFailed;

  const label =
    diag.source_used === "tier1_yanoshin" ? "やのしん"
    : diag.source_used === "tier2_yahoo" ? "Yahoo Finance"
    : diag.source_used === "mixed" ? "やのしん+Yahoo"
    : "取得失敗";

  const color = allFailed
    ? "text-red-600 dark:text-red-400"
    : partialFail
      ? "text-yellow-600 dark:text-yellow-400"
      : "text-zinc-400";

  return (
    <div className={`text-xs ${color} border-t border-zinc-100 dark:border-zinc-800 pt-1 mt-0.5`}>
      <span className="font-medium">TDnet取得元:</span> {label}
      {" · "}
      <span title="やのしんRSSで成功した銘柄数">Tier1 {diag.tier1_stocks}</span>
      {diag.tier2_stocks > 0 && <span title="Yahoo Financeフォールバックで取得した銘柄数"> · Tier2 {diag.tier2_stocks}</span>}
      {failed > 0 && (
        <span title="全取得元で失敗した銘柄"> · 失敗 {failed}{diag.failed_stocks?.length ? ` (${diag.failed_stocks.slice(0, 5).join(", ")}${diag.failed_stocks.length > 5 ? "…" : ""})` : ""}</span>
      )}
      {allFailed && <span className="ml-1">⚠ 外部障害の可能性</span>}
    </div>
  );
}

function HealthRow({ check: h }: { check: HealthCheck }) {
  const keyMissing = h.status === "key_missing" || h.error_message === "APIキー未設定";
  const degraded = !keyMissing && h.status === "degraded";
  const ok = !keyMissing && !degraded && h.consecutive_failures === 0 && h.last_success_at != null;
  const warn = !keyMissing && (degraded || (h.consecutive_failures > 0 && h.consecutive_failures < 3));
  const err = !keyMissing && h.consecutive_failures >= 3;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 p-3">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
        keyMissing ? "bg-zinc-300 dark:bg-zinc-600" :
        ok ? "bg-green-500" : warn ? "bg-yellow-500" : err ? "bg-red-500" : "bg-zinc-300"
      }`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm">{SOURCE_LABELS[h.source] ?? h.source}</p>
        <p className="text-xs text-zinc-400">
          {keyMissing
            ? "APIキー未設定 — 取得スキップ中"
            : h.last_success_at
              ? `最終成功: ${formatRelative(h.last_success_at)}`
              : "未確認"}
          {!keyMissing && h.consecutive_failures > 0 && ` · ${h.consecutive_failures}回連続失敗`}
          {degraded && h.consecutive_failures === 0 && " · 一部銘柄で取得失敗 (フォールバック稼働)"}
        </p>
      </div>
      {keyMissing && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 flex-shrink-0">
          キー未設定
        </span>
      )}
      {degraded && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 flex-shrink-0">
          一部失敗
        </span>
      )}
    </div>
  );
}

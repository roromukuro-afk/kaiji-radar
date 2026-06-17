"use client";

import { useEffect, useState } from "react";
import { formatJST, formatRelative } from "@/lib/utils";

type HealthCheck = {
  source: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  status: string;
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
};

type BackupLog = {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  file_name: string | null;
  file_size_bytes: number | null;
};

const SOURCE_LABELS: Record<string, string> = {
  tdnet_yanoshi: "TDnet (やのしん)",
  tdnet_direct: "TDnet (直接)",
  edinet: "EDINET",
  google_news_jp: "Googleニュース (JP)",
  google_news_en: "Googleニュース (EN)",
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
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, []);

  if (loading) return <div className="text-center py-12 text-zinc-400">読み込み中…</div>;
  if (!data) return <div className="text-center py-12 text-zinc-400">データ取得失敗</div>;

  const overallOk = data.health_checks.every((h) => h.consecutive_failures < 3);

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
            {data.last_hourly_run && (
              <p className="text-xs text-zinc-500 mt-0.5">
                最終更新: {formatRelative(data.last_hourly_run)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Storage */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 className="font-semibold text-sm mb-1">PDF ストレージ</h2>
        <p className="text-sm text-zinc-500">{fmtBytes(data.storage_bytes)} / 1 GB (Free)</p>
        <div className="mt-2 h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-2 rounded-full bg-blue-500"
            style={{ width: `${Math.min(100, (data.storage_bytes / (1024 * 1024 * 1024)) * 100)}%` }}
          />
        </div>
      </div>

      {/* Health checks */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm text-zinc-500">ソース別ステータス</h2>
        {data.health_checks.map((h) => (
          <HealthRow key={h.source} check={h} />
        ))}
      </section>

      {/* Recent jobs */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm text-zinc-500">最近の取得ジョブ</h2>
        {data.recent_jobs.length === 0 ? (
          <p className="text-sm text-zinc-400">ジョブ履歴なし</p>
        ) : data.recent_jobs.map((j) => (
          <div key={j.id} className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                j.status === "completed" ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" :
                j.status === "running" ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200" :
                "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
              }`}>
                {j.status === "completed" ? "完了" : j.status === "running" ? "実行中" : "エラー"}
              </span>
              <span className="text-xs text-zinc-400">{formatRelative(j.started_at)}</span>
            </div>
            {j.status === "completed" && (
              <p className="text-xs text-zinc-500">
                TDnet {j.tdnet_count} / EDINET {j.edinet_count} / 公式 {j.official_count} / 国内 {j.jp_news_count} / 海外 {j.en_news_count} 件
              </p>
            )}
            {j.error_message && (
              <p className="text-xs text-red-500 truncate">{j.error_message}</p>
            )}
          </div>
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
    </div>
  );
}

function HealthRow({ check: h }: { check: HealthCheck }) {
  const ok = h.consecutive_failures === 0 && h.last_success_at != null;
  const warn = h.consecutive_failures > 0 && h.consecutive_failures < 3;
  const err = h.consecutive_failures >= 3;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 p-3">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ok ? "bg-green-500" : warn ? "bg-yellow-500" : err ? "bg-red-500" : "bg-zinc-300"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm">{SOURCE_LABELS[h.source] ?? h.source}</p>
        <p className="text-xs text-zinc-400">
          {h.last_success_at ? `最終成功: ${formatRelative(h.last_success_at)}` : "未確認"}
          {h.consecutive_failures > 0 && ` · ${h.consecutive_failures}回連続失敗`}
        </p>
      </div>
    </div>
  );
}

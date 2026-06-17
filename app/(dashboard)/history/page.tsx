"use client";

import { useEffect, useState } from "react";
import { formatJST, formatRelative, sourceTypeLabel } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type LogEntry = {
  id: string;
  action: string;
  result: string;
  details: Record<string, any> | null;
  created_at: string;
};

const ACTION_LABEL: Record<string, string> = {
  add_stock: "銘柄追加",
  remove_stock: "銘柄削除",
  pause_stock: "監視停止",
  resume_stock: "監視再開",
  full_delete_stock: "完全削除",
  manual_fetch: "手動更新",
  update_profile: "プロフィール更新",
  push_subscription: "通知登録",
  push_unsubscription: "通知解除",
};

export default function HistoryPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const LIMIT = 50;

  async function fetchLogs(newOffset = 0) {
    setLoading(true);
    const supabase = createClient();
    const { data, count, error } = await supabase
      .from("operation_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(newOffset, newOffset + LIMIT - 1);

    if (!error) {
      setLogs(newOffset === 0 ? data ?? [] : (prev) => [...prev, ...(data ?? [])]);
      setTotal(count ?? 0);
      setOffset(newOffset);
    }
    setLoading(false);
  }

  useEffect(() => { fetchLogs(0); }, []);

  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-sm text-zinc-500">操作履歴</h1>

      {loading && logs.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">読み込み中…</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">操作履歴がありません</div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    log.result === "success" ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" :
                    log.result === "error" ? "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200" :
                    "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                  }`}>
                    {log.result === "success" ? "成功" : log.result === "error" ? "エラー" : log.result}
                  </span>
                  <span className="text-sm">{ACTION_LABEL[log.action] ?? log.action}</span>
                </div>
                <span className="text-xs text-zinc-400 flex-shrink-0">{formatRelative(log.created_at)}</span>
              </div>

              {log.details && Object.keys(log.details).length > 0 && (
                <LogDetails details={log.details} />
              )}
            </div>
          ))}

          {offset + LIMIT < total && (
            <button
              onClick={() => fetchLogs(offset + LIMIT)}
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

function LogDetails({ details }: { details: Record<string, any> }) {
  const [open, setOpen] = useState(false);

  const preview = Object.entries(details)
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" · ");

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-left"
      >
        {open ? "▲ 詳細を閉じる" : `▶ ${preview}`}
      </button>
      {open && (
        <pre className="mt-1 text-xs bg-zinc-50 dark:bg-zinc-900 rounded p-2 overflow-x-auto">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  );
}

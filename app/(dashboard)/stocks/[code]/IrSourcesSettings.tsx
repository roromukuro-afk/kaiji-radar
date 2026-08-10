"use client";

import { useState } from "react";

interface IrSource {
  id: string;
  url: string;
  enabled: boolean;
  last_checked_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
}

interface Props {
  stockId: string;
  initialSources: IrSource[];
}

// 企業IRページ直接監視(新規実装2)。RSSが無い企業向けに、IR/ニュース一覧ページの
// HTMLを直接巡回して新着リンクを検出する。誤検知の影響を抑えるため、登録直後は
// enabled=falseで追加され、ここで明示的に有効化した銘柄だけが毎時巡回の対象になる
// (少数銘柄でのパイロット運用を想定)。
export function IrSourcesSettings({ stockId, initialSources }: Props) {
  const [sources, setSources] = useState<IrSource[]>(initialSources);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleAdd() {
    const url = input.trim();
    if (!url) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ir-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stock_id: stockId, url }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "追加に失敗しました");
      setSources((prev) => [...prev, j.data]);
      setInput("");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ir-sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "更新に失敗しました");
      }
      setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/ir-sources?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "削除に失敗しました");
      }
      setSources((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-4 space-y-3">
      <h2 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">企業IRページ直接監視(パイロット)</h2>
      <p className="text-xs text-zinc-400">
        RSSが無いIRニュース一覧ページのURLを登録し、有効化すると毎時HTMLを巡回して新着リンクをofficialとして保存します。
        登録直後は無効(監視しない)状態です。まず少数銘柄で有効化して様子を見てください。
      </p>

      {sources.length === 0 ? (
        <p className="text-xs text-zinc-400 py-1">未登録です</p>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="rounded-lg border border-zinc-100 dark:border-zinc-800 p-2 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="flex-1 min-w-0 truncate text-zinc-600 dark:text-zinc-400">{s.url}</span>
                <label className="flex items-center gap-1 flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    disabled={busy}
                    onChange={(e) => handleToggle(s.id, e.target.checked)}
                  />
                  <span className={s.enabled ? "text-green-600 dark:text-green-400" : "text-zinc-400"}>
                    {s.enabled ? "有効" : "無効"}
                  </span>
                </label>
                <button
                  onClick={() => handleRemove(s.id)}
                  disabled={busy}
                  className="flex-shrink-0 px-2 py-1 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
                >
                  削除
                </button>
              </div>
              {s.enabled && (
                <p className="text-[11px] text-zinc-400">
                  {s.last_success_at
                    ? `最終成功: ${new Date(s.last_success_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`
                    : "まだ巡回されていません"}
                  {s.consecutive_failures > 0 && (
                    <span className="text-red-500 dark:text-red-400 ml-2">
                      連続失敗{s.consecutive_failures}回{s.last_error ? `: ${s.last_error}` : ""}
                    </span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          type="url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
          placeholder="https://example.com/ir/news/"
          className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
        />
        <button
          onClick={handleAdd}
          disabled={busy || !input.trim()}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium disabled:opacity-50"
        >
          追加
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

"use client";

import { useState } from "react";

interface Props {
  stockId: string;
  initialUrls: string[];
}

// 企業公式RSSは全29銘柄でrss_urlsが未設定(空配列)なことが確認された
// (officialソースが常に0件保存だった直接の原因)。ここから追加・削除できるようにする。
export function RssUrlsSettings({ stockId, initialUrls }: Props) {
  const [urls, setUrls] = useState<string[]>(initialUrls);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function persist(next: string[]) {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const res = await fetch("/api/stocks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: stockId, action: "update_rss_urls", rss_urls: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "保存に失敗しました");
      }
      setUrls(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  function handleAdd() {
    const v = input.trim();
    if (!v) return;
    if (urls.includes(v)) { setInput(""); return; }
    persist([...urls, v]);
    setInput("");
  }

  function handleRemove(u: string) {
    persist(urls.filter((x) => x !== u));
  }

  return (
    <section className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-4 space-y-3">
      <h2 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">企業公式RSS</h2>
      <p className="text-xs text-zinc-400">
        ここにRSS/AtomフィードのURLを登録すると、毎時取得の対象になります(source_type: official、安全ソース扱い)。
      </p>

      {urls.length === 0 ? (
        <p className="text-xs text-zinc-400 py-1">未登録です</p>
      ) : (
        <ul className="space-y-1.5">
          {urls.map((u) => (
            <li key={u} className="flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate text-zinc-600 dark:text-zinc-400">{u}</span>
              <button
                onClick={() => handleRemove(u)}
                disabled={saving}
                className="flex-shrink-0 px-2 py-1 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
              >
                削除
              </button>
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
          placeholder="https://example.com/rss.xml"
          className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
        />
        <button
          onClick={handleAdd}
          disabled={saving || !input.trim()}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium disabled:opacity-50"
        >
          {saving ? "保存中…" : saved ? "保存しました" : "追加"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

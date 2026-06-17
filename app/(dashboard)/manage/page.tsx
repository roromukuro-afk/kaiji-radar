"use client";

import { useEffect, useState } from "react";

type Stock = {
  id: string;
  code: string;
  name: string;
  status: string;
  created_at: string;
  stock_profiles: { exchange: string | null; sector: string | null; official_url: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: "監視中",
  paused: "一時停止",
  removed: "リストから削除",
};

export default function ManagePage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [confirmAction, setConfirmAction] = useState<{ stockId: string; action: string; label: string } | null>(null);

  async function fetchStocks() {
    const res = await fetch("/api/stocks");
    const json = await res.json();
    setStocks(json.data ?? []);
    setLoading(false);
  }

  useEffect(() => { fetchStocks(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setError("");
    setAdding(true);
    const res = await fetch("/api/stocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: newCode.trim(), name: newName.trim() }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "追加に失敗しました");
    } else {
      setNewCode("");
      setNewName("");
      fetchStocks();
    }
    setAdding(false);
  }

  async function handleAction(stockId: string, action: string) {
    await fetch("/api/stocks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: stockId, action }),
    });
    setConfirmAction(null);
    fetchStocks();
  }

  const active = stocks.filter((s) => s.status === "active");
  const others = stocks.filter((s) => s.status !== "active" && s.status !== "deleted");

  return (
    <div className="space-y-6">
      {/* Add stock form */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
        <h2 className="font-semibold text-sm">銘柄を追加</h2>
        <form onSubmit={handleAdd} className="flex gap-2 flex-wrap">
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="証券コード (例: 6758)"
            maxLength={6}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="銘柄名 (例: ソニーグループ)"
            className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
          />
          <button
            type="submit"
            disabled={adding}
            className="px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-50"
          >
            {adding ? "追加中…" : "追加"}
          </button>
        </form>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </section>

      {/* Active stocks */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm text-zinc-500">監視中 ({active.length})</h2>
        {loading ? (
          <div className="text-zinc-400 text-sm">読み込み中…</div>
        ) : active.length === 0 ? (
          <div className="text-zinc-400 text-sm">銘柄がありません</div>
        ) : active.map((s) => (
          <StockRow
            key={s.id}
            stock={s}
            onAction={(action, label) => setConfirmAction({ stockId: s.id, action, label })}
          />
        ))}
      </section>

      {/* Other (paused/removed) stocks */}
      {others.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold text-sm text-zinc-500">その他</h2>
          {others.map((s) => (
            <StockRow
              key={s.id}
              stock={s}
              onAction={(action, label) => setConfirmAction({ stockId: s.id, action, label })}
            />
          ))}
        </section>
      )}

      {/* Confirm dialog */}
      {confirmAction && (
        <ConfirmDialog
          label={confirmAction.label}
          onConfirm={() => handleAction(confirmAction.stockId, confirmAction.action)}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

function StockRow({
  stock: s,
  onAction,
}: {
  stock: Stock;
  onAction: (action: string, label: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{s.code}</span>
          <span className="text-sm truncate">{s.name}</span>
          {s.status !== "active" && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
              {STATUS_LABEL[s.status] ?? s.status}
            </span>
          )}
        </div>
        {s.stock_profiles?.exchange && (
          <p className="text-xs text-zinc-400 mt-0.5">{s.stock_profiles.exchange} · {s.stock_profiles.sector}</p>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
        >
          ···
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-8 z-20 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-lg py-1 min-w-max">
              {s.status === "active" && (
                <>
                  <button
                    onClick={() => { setMenuOpen(false); onAction("pause", "一時停止にしますか？"); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    一時停止
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); onAction("remove_from_list", "リストから削除しますか？\n（履歴は保持されます）"); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 text-orange-600"
                  >
                    リストから削除
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); onAction("full_delete", "完全削除しますか？\n（全データが消えます）"); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 text-red-600"
                  >
                    完全削除
                  </button>
                </>
              )}
              {s.status === "paused" && (
                <>
                  <button
                    onClick={() => { setMenuOpen(false); onAction("resume", "監視を再開しますか？"); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 text-green-600"
                  >
                    監視再開
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); onAction("full_delete", "完全削除しますか？"); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 text-red-600"
                  >
                    完全削除
                  </button>
                </>
              )}
              {s.status === "removed" && (
                <button
                  onClick={() => { setMenuOpen(false); onAction("full_delete", "完全削除しますか？"); }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 text-red-600"
                >
                  完全削除
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConfirmDialog({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-t-2xl p-6 space-y-4">
        <p className="text-sm whitespace-pre-wrap">{label}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium"
          >
            実行
          </button>
        </div>
      </div>
    </div>
  );
}

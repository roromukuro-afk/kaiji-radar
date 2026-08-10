"use client";

import { useEffect, useState, useCallback } from "react";
import { EVENT_TYPES, eventTypeLabel } from "@/lib/classifiers/event-type";
import { IMPORTANCE_TIERS, importanceLabel } from "@/lib/classifiers/importance";
import { sourceTypeLabel } from "@/lib/utils";

type Stock = { id: string; code: string; name: string };

type NotificationRule = {
  id: string;
  stock_id: string | null;
  importance: string | null;
  event_type: string | null;
  source_type: string | null;
  keyword: string | null;
  action: "notify" | "save_only" | "no_notify";
  priority: number;
  is_active: boolean;
  reason: string | null;
  created_at: string;
  stocks: Stock | null;
};

const SOURCE_TYPES = ["tdnet", "edinet", "official", "pr_times", "jp_news", "en_news"] as const;

const ACTION_LABEL: Record<string, string> = {
  notify: "即時通知",
  save_only: "保存のみ(通知しない)",
  no_notify: "通知しない",
};

const ACTION_COLOR: Record<string, string> = {
  notify: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300",
  save_only: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
  no_notify: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
};

function formatDate(s: string): string {
  return new Date(s).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function NotificationRulesTab() {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [formStock, setFormStock] = useState("");
  const [formImportance, setFormImportance] = useState("");
  const [formEventType, setFormEventType] = useState("");
  const [formSourceType, setFormSourceType] = useState("");
  const [formKeyword, setFormKeyword] = useState("");
  const [formAction, setFormAction] = useState<"notify" | "save_only" | "no_notify">("no_notify");
  const [formPriority, setFormPriority] = useState("0");
  const [formReason, setFormReason] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const fetchRules = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (showInactive) params.set("include_inactive", "true");
    const res = await fetch(`/api/notification-rules?${params}`);
    const j = await res.json();
    setRules(j.data ?? []);
    setLoading(false);
  }, [showInactive]);

  useEffect(() => { fetchRules(); }, [fetchRules]);
  useEffect(() => {
    fetch("/api/stocks").then((r) => r.json()).then((j) => setStocks(j.data ?? []));
  }, []);

  async function toggleRule(id: string, current: boolean) {
    await fetch("/api/notification-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, is_active: !current }),
    });
    fetchRules();
  }

  async function deleteRule(id: string) {
    if (!confirm("このルールを削除しますか?")) return;
    await fetch(`/api/notification-rules?id=${id}`, { method: "DELETE" });
    fetchRules();
  }

  async function addRule() {
    setFormError("");
    if (!formStock && !formImportance && !formEventType && !formSourceType && !formKeyword.trim()) {
      setFormError("少なくとも1つの条件を指定してください");
      return;
    }
    setFormSubmitting(true);
    const res = await fetch("/api/notification-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stock_id: formStock || undefined,
        importance: formImportance || undefined,
        event_type: formEventType || undefined,
        source_type: formSourceType || undefined,
        keyword: formKeyword.trim() || undefined,
        action: formAction,
        priority: parseInt(formPriority, 10) || 0,
        reason: formReason.trim() || undefined,
      }),
    });
    const j = await res.json();
    setFormSubmitting(false);
    if (!res.ok) { setFormError(j.error ?? "追加に失敗しました"); return; }
    setShowForm(false);
    setFormStock(""); setFormImportance(""); setFormEventType(""); setFormSourceType("");
    setFormKeyword(""); setFormAction("no_notify"); setFormPriority("0"); setFormReason("");
    fetchRules();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-zinc-500">
          銘柄・重要度・開示種別・情報源・キーワードを組み合わせ、記事ごとに通知するかどうかを判定します。
          複数一致する場合は優先度(数値が大きい方)、同点なら条件が多い方を優先します。
          一致するルールが無い記事は、従来の銘柄別「通知する開示種別」設定に従います。
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 whitespace-nowrap"
        >
          + ルール追加
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3 bg-zinc-50 dark:bg-zinc-900">
          <p className="text-sm font-medium">新規通知ルール</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-500">銘柄 <span className="text-zinc-400">(空=全銘柄)</span></label>
              <select value={formStock} onChange={(e) => setFormStock(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="">全銘柄</option>
                {stocks.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500">重要度 <span className="text-zinc-400">(空=指定なし)</span></label>
              <select value={formImportance} onChange={(e) => setFormImportance(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="">指定なし</option>
                {IMPORTANCE_TIERS.map((t) => <option key={t} value={t}>{importanceLabel(t)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500">開示種別 <span className="text-zinc-400">(空=指定なし)</span></label>
              <select value={formEventType} onChange={(e) => setFormEventType(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="">指定なし</option>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{eventTypeLabel(t)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500">情報源 <span className="text-zinc-400">(空=指定なし)</span></label>
              <select value={formSourceType} onChange={(e) => setFormSourceType(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="">指定なし</option>
                {SOURCE_TYPES.map((t) => <option key={t} value={t}>{sourceTypeLabel(t)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500">タイトルキーワード <span className="text-zinc-400">(空=指定なし、部分一致)</span></label>
            <input value={formKeyword} onChange={(e) => setFormKeyword(e.target.value)} placeholder="自己株式取得" className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-500">アクション</label>
              <select value={formAction} onChange={(e) => setFormAction(e.target.value as typeof formAction)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                {Object.entries(ACTION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500">優先度 <span className="text-zinc-400">(数値が大きいほど優先)</span></label>
              <input type="number" value={formPriority} onChange={(e) => setFormPriority(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500">メモ</label>
            <input value={formReason} onChange={(e) => setFormReason(e.target.value)} placeholder="夜間の軽微な開示は翌朝まとめて確認したい" className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
          <div className="flex gap-2">
            <button onClick={addRule} disabled={formSubmitting} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 disabled:opacity-50">
              {formSubmitting ? "追加中…" : "追加"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">キャンセル</button>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <label className="flex items-center gap-1 text-xs text-zinc-500 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          無効も表示
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400 text-center py-8">読み込み中…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-8">通知ルールなし</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`rounded-xl border p-3 space-y-1.5 transition-opacity ${
                rule.is_active ? "border-zinc-200 dark:border-zinc-700" : "border-zinc-100 dark:border-zinc-800 opacity-50"
              }`}
            >
              <div className="flex items-start gap-2 flex-wrap">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ACTION_COLOR[rule.action]}`}>
                  {ACTION_LABEL[rule.action]}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">優先度 {rule.priority}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button onClick={() => toggleRule(rule.id, rule.is_active)} className="text-xs px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                    {rule.is_active ? "無効化" : "有効化"}
                  </button>
                  <button onClick={() => deleteRule(rule.id)} className="text-xs px-2 py-1 rounded-lg bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800">
                    削除
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                <span>{rule.stocks ? `${rule.stocks.code} ${rule.stocks.name}` : "全銘柄"}</span>
                {rule.importance && <span>重要度: {importanceLabel(rule.importance)}</span>}
                {rule.event_type && <span>種別: {eventTypeLabel(rule.event_type)}</span>}
                {rule.source_type && <span>情報源: {sourceTypeLabel(rule.source_type)}</span>}
                {rule.keyword && <span>キーワード: &quot;{rule.keyword}&quot;</span>}
                <span>追加: {formatDate(rule.created_at)}</span>
              </div>
              {rule.reason && <p className="text-xs text-zinc-500 dark:text-zinc-400">{rule.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

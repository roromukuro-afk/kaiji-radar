"use client";

import { useEffect, useState, useCallback } from "react";
import { NotificationRulesTab } from "./NotificationRulesTab";

type NoiseRule = {
  id: string;
  stock_id: string | null;
  scope: string;
  rule_name: string | null;
  rule_type: string;
  match_type: string;
  match_value: string;
  language: string;
  reason: string | null;
  is_active: boolean;
  apply_count: number;
  last_applied_at: string | null;
  created_at: string;
  created_by: string;
  stocks?: { id: string; code: string; name: string } | null;
};

const RULE_TYPE_LABEL: Record<string, string> = {
  exclude_candidate: "除外候補",
  block_notify:      "通知停止",
  weaken_source:     "媒体弱化",
  strengthen:        "関連強化",
  different_company: "別会社",
};

const MATCH_TYPE_LABEL: Record<string, string> = {
  keyword:     "キーワード",
  domain:      "ドメイン",
  url_pattern: "URLパターン",
  publisher:   "媒体名",
  source_type: "情報ソース",
};

const RULE_TYPE_COLOR: Record<string, string> = {
  exclude_candidate: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
  block_notify:      "bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200",
  weaken_source:     "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300",
  strengthen:        "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300",
  different_company: "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300",
};

const TAB_FILTERS: { label: string; match_type?: string; rule_type?: string }[] = [
  { label: "すべて" },
  { label: "キーワード", match_type: "keyword" },
  { label: "ドメイン",   match_type: "domain" },
  { label: "媒体",       match_type: "publisher" },
  { label: "関連強化",   rule_type: "strengthen" },
];

function formatDate(s: string | null): string {
  if (!s) return "-";
  return new Date(s).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function RulesPage() {
  const [pageTab, setPageTab] = useState<"noise" | "notification">("noise");
  const [rules, setRules] = useState<NoiseRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyResult, setReclassifyResult] = useState<string>("");

  // New rule form
  const [showForm, setShowForm] = useState(false);
  const [formStock, setFormStock] = useState("");
  const [formType, setFormType] = useState("exclude_candidate");
  const [formMatch, setFormMatch] = useState("keyword");
  const [formValue, setFormValue] = useState("");
  const [formReason, setFormReason] = useState("");
  const [formScope, setFormScope] = useState("this_stock");
  const [formSubmitting, setFormSubmitting] = useState(false);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (showInactive) params.set("include_inactive", "true");
    const cur = TAB_FILTERS[tab];
    if (cur.match_type) params.set("match_type", cur.match_type);
    if (cur.rule_type)  params.set("rule_type",  cur.rule_type);
    const res = await fetch(`/api/noise-rules?${params}`);
    const j = await res.json();
    setRules(j.data ?? []);
    setLoading(false);
  }, [tab, showInactive]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  async function toggleRule(id: string, current: boolean) {
    await fetch("/api/noise-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, is_active: !current }),
    });
    fetchRules();
  }

  async function deleteRule(id: string) {
    if (!confirm("このルールを削除しますか?")) return;
    await fetch(`/api/noise-rules?id=${id}`, { method: "DELETE" });
    fetchRules();
  }

  async function addRule() {
    if (!formValue.trim()) return;
    setFormSubmitting(true);
    await fetch("/api/noise-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stock_code: formStock.trim() || undefined,
        rule_type:  formType,
        match_type: formMatch,
        match_value: formValue.trim(),
        reason: formReason.trim() || undefined,
        scope: formScope,
      }),
    });
    setFormSubmitting(false);
    setShowForm(false);
    setFormValue("");
    setFormReason("");
    fetchRules();
  }

  async function runReclassify(restore = false) {
    setReclassifying(true);
    setReclassifyResult("");
    const res = await fetch("/api/reclassify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restore }),
    });
    const j = await res.json();
    const s = j.stats;
    setReclassifyResult(
      restore
        ? `復元完了: スキャン=${s.scanned} 復元=${s.restored}`
        : `再分類完了: スキャン=${s.scanned} 除外候補追加=${s.marked}`
    );
    setReclassifying(false);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">ルール</h1>

      {/* Page-level tab switcher */}
      <div className="flex gap-1">
        <button
          onClick={() => setPageTab("noise")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            pageTab === "noise"
              ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          }`}
        >
          ノイズ除外ルール
        </button>
        <button
          onClick={() => setPageTab("notification")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            pageTab === "notification"
              ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          }`}
        >
          通知ルール
        </button>
      </div>

      {pageTab === "notification" ? (
        <NotificationRulesTab />
      ) : (
      <>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
          >
            + ルール追加
          </button>
        </div>
      </div>

      {/* New rule form */}
      {showForm && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3 bg-zinc-50 dark:bg-zinc-900">
          <p className="text-sm font-medium">新規ルール</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-500">銘柄コード <span className="text-zinc-400">(空=全銘柄)</span></label>
              <input value={formStock} onChange={(e) => setFormStock(e.target.value)} placeholder="8591" className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="text-xs text-zinc-500">適用範囲</label>
              <select value={formScope} onChange={(e) => setFormScope(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="this_stock">この銘柄だけ</option>
                <option value="all_stocks">全銘柄</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500">ルール種別</label>
              <select value={formType} onChange={(e) => setFormType(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                {Object.entries(RULE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500">マッチ種別</label>
              <select value={formMatch} onChange={(e) => setFormMatch(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                {Object.entries(MATCH_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500">マッチ値</label>
            <input value={formValue} onChange={(e) => setFormValue(e.target.value)} placeholder="バファローズ" className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">理由</label>
            <input value={formReason} onChange={(e) => setFormReason(e.target.value)} placeholder="オリックス球団ニュースは投資情報ではない" className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="flex gap-2">
            <button onClick={addRule} disabled={formSubmitting || !formValue.trim()} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 disabled:opacity-50">
              {formSubmitting ? "追加中…" : "追加"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">キャンセル</button>
          </div>
        </div>
      )}

      {/* Reclassify controls */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
        <span className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">既存記事の再分類:</span>
        <button onClick={() => runReclassify(false)} disabled={reclassifying} className="px-3 py-1.5 text-xs rounded-lg bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 disabled:opacity-50">
          {reclassifying ? "処理中…" : "ルールを適用"}
        </button>
        <button onClick={() => runReclassify(true)} disabled={reclassifying} className="px-3 py-1.5 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 disabled:opacity-50">
          除外を復元
        </button>
        {reclassifyResult && (
          <span className="text-xs text-green-600 dark:text-green-400">{reclassifyResult}</span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {TAB_FILTERS.map((t, i) => (
          <button
            key={i}
            onClick={() => setTab(i)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              tab === i
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {t.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-xs text-zinc-500 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          無効も表示
        </label>
      </div>

      {/* Rules list */}
      {loading ? (
        <p className="text-sm text-zinc-400 text-center py-8">読み込み中…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-8">ルールなし</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`rounded-xl border p-3 space-y-1.5 transition-opacity ${
                rule.is_active
                  ? "border-zinc-200 dark:border-zinc-700"
                  : "border-zinc-100 dark:border-zinc-800 opacity-50"
              }`}
            >
              <div className="flex items-start gap-2 flex-wrap">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${RULE_TYPE_COLOR[rule.rule_type] ?? "bg-zinc-100 text-zinc-600"}`}>
                  {RULE_TYPE_LABEL[rule.rule_type] ?? rule.rule_type}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                  {MATCH_TYPE_LABEL[rule.match_type] ?? rule.match_type}
                </span>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 break-all">
                  {rule.match_value}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={() => toggleRule(rule.id, rule.is_active)}
                    className="text-xs px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  >
                    {rule.is_active ? "無効化" : "有効化"}
                  </button>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="text-xs px-2 py-1 rounded-lg bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800"
                  >
                    削除
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500">
                {rule.stocks ? (
                  <span>{rule.stocks.code} {rule.stocks.name}</span>
                ) : (
                  <span className="text-zinc-400">全銘柄</span>
                )}
                <span>適用 {rule.apply_count} 件</span>
                {rule.last_applied_at && <span>最終: {formatDate(rule.last_applied_at)}</span>}
                <span>追加: {formatDate(rule.created_at)}</span>
                {rule.created_by && <span>by {rule.created_by}</span>}
              </div>

              {rule.reason && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{rule.reason}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Safety notice */}
      <div className="rounded-xl bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3">
        <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">安全ソース保護</p>
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
          TDnet・EDINET・企業公式IRはノイズルールの対象外です。これらは常に保存・通知されます。
        </p>
      </div>
      </>
      )}
    </div>
  );
}

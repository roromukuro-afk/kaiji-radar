"use client";

import { useState } from "react";

interface NoiseReportPanelProps {
  articleId: string;
  stock: { id: string; code: string; name: string };
  articleTitle: string;
  articleUrl: string;
  publisher: string | null;
  onDone?: () => void;
}

type ActionType = "exclude_candidate" | "block_notify" | "strengthen" | "different_company";

const ACTION_LABELS: Record<ActionType, string> = {
  exclude_candidate: "除外候補にする（DB保存・通知停止）",
  block_notify:      "通知を停止する",
  strengthen:        "関連ありとして学習（この種の記事を残す）",
  different_company: "同名別会社として除外",
};

export function NoiseReportPanel({
  articleId,
  stock,
  articleTitle,
  articleUrl,
  publisher,
  onDone,
}: NoiseReportPanelProps) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<ActionType>("exclude_candidate");
  const [keywords, setKeywords] = useState("");
  const [domain, setDomain] = useState("");
  const [pub, setPub] = useState(publisher ?? "");
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"this_stock" | "all_stocks">("this_stock");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [previewResults, setPreviewResults] = useState<
    { match_type: string; match_value: string; matched_count: number | null }[] | null
  >(null);

  if (done) {
    return (
      <div className="rounded-xl border border-green-200 dark:border-green-800 p-3 text-xs text-green-700 dark:text-green-400">
        ✓ ルールを登録しました
        <button onClick={() => setDone(false)} className="ml-2 underline">もう1件</button>
      </div>
    );
  }

  function buildRules(): object[] {
    const kws = keywords.split(/[,、\n]/).map((k) => k.trim()).filter(Boolean);
    const domains = domain.split(/[,、\n]/).map((d) => d.trim()).filter(Boolean);
    const publishers = pub.split(/[,、\n]/).map((p) => p.trim()).filter(Boolean);
    const rules: object[] = [];
    const base = {
      stock_id: scope === "this_stock" ? stock.id : undefined,
      scope,
      rule_type: action,
      reason: reason || `${stock.code} ${stock.name}: 手動ノイズ報告`,
    };
    for (const k of kws)       rules.push({ ...base, match_type: "keyword", match_value: k });
    for (const d of domains)   rules.push({ ...base, match_type: "domain",  match_value: d });
    for (const p of publishers) rules.push({ ...base, match_type: "publisher", match_value: p });
    return rules;
  }

  async function handlePreview() {
    const rules = buildRules();
    if (rules.length === 0) {
      setError("キーワード、ドメイン、媒体のいずれかを入力してください");
      return;
    }
    setPreviewing(true);
    setError("");
    try {
      const res = await fetch("/api/noise-rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      setPreviewResults(j.results ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSubmit() {
    const rules = buildRules();

    if (rules.length === 0) {
      setError("キーワード、ドメイン、媒体のいずれかを入力してください");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/noise-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      if (!res.ok) throw new Error(await res.text());

      // Also mark the current article if action is exclude_candidate/block_notify/different_company
      if (action !== "strengthen") {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            article_id: articleId,
            stock_id: stock.id,
            feedback_type: action === "different_company" ? "different_company" : "irrelevant",
            reason,
          }),
        });
      }

      // Trigger reclassify for this stock
      fetch("/api/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stock_id: stock.id }),
      }).catch(() => {});

      setDone(true);
      setOpen(false);
      onDone?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-orange-200 dark:border-orange-900">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2.5 text-xs font-medium text-orange-700 dark:text-orange-400 flex items-center gap-2"
      >
        <span className="text-base leading-none">⚠</span>
        {open ? "▲ ノイズ報告フォームを閉じる" : "▼ このパターンをルール化（ノイズ報告）"}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            記事: <span className="text-zinc-700 dark:text-zinc-300">{articleTitle.slice(0, 60)}</span>
          </p>

          {/* Action */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">このパターンをどう扱う?</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as ActionType)}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            >
              {(Object.entries(ACTION_LABELS) as [ActionType, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          {/* Keywords */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              除外キーワード <span className="text-zinc-400">（複数はカンマ区切り）</span>
            </label>
            <textarea
              value={keywords}
              onChange={(e) => { setKeywords(e.target.value); setPreviewResults(null); }}
              placeholder={"バファローズ, プロ野球, 試合結果"}
              rows={2}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 resize-none"
            />
          </div>

          {/* Domain */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              除外ドメイン <span className="text-zinc-400">（同名別会社のサイトなど）</span>
            </label>
            <input
              type="text"
              value={domain}
              onChange={(e) => { setDomain(e.target.value); setPreviewResults(null); }}
              placeholder="example.com"
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>

          {/* Publisher */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              除外媒体名 <span className="text-zinc-400">（スポーツ紙など）</span>
            </label>
            <input
              type="text"
              value={pub}
              onChange={(e) => { setPub(e.target.value); setPreviewResults(null); }}
              placeholder="スポーツニッポン"
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>

          {/* Scope */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">適用範囲</label>
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" value="this_stock" checked={scope === "this_stock"} onChange={() => { setScope("this_stock"); setPreviewResults(null); }} />
                <span>この銘柄だけ ({stock.code} {stock.name})</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" value="all_stocks" checked={scope === "all_stocks"} onChange={() => { setScope("all_stocks"); setPreviewResults(null); }} />
                <span>全銘柄</span>
              </label>
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">理由メモ</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="オリックス球団ニュースは投資情報ではない"
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}

          {previewResults && previewResults.length > 0 && (
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-2 space-y-1">
              <p className="text-xs font-medium text-zinc-500">影響件数(既存記事のうち一致する件数)</p>
              {previewResults.map((r, i) => (
                <p key={i} className="text-xs text-zinc-600 dark:text-zinc-400">
                  {r.match_type}=&quot;{r.match_value}&quot;: {r.matched_count === null ? "取得失敗" : `${r.matched_count}件`}
                </p>
              ))}
              <p className="text-xs text-zinc-400">※ドメイン・URLパターンはURL全体への部分一致による概算です</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handlePreview}
              disabled={previewing || submitting}
              className="px-3 py-2 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              {previewing ? "確認中…" : "影響件数を確認"}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 py-2 rounded-lg text-xs font-medium bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? "登録中…" : "ルールとして登録"}
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 disabled:opacity-50"
            >
              閉じる
            </button>
          </div>

          <p className="text-xs text-zinc-400">
            ⚠ TDnet / EDINET / 企業公式はルール対象外です（安全ソース保護）
          </p>
        </div>
      )}
    </div>
  );
}

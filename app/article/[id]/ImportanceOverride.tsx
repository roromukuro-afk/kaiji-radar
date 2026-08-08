"use client";

import { useState } from "react";
import { IMPORTANCE_TIERS, importanceLabel, type ImportanceTier } from "@/lib/classifiers/importance";

interface Props {
  articleId: string;
  importance: string | null;
  importanceReason: string | null;
  importanceSource: string | null;
}

const TIER_STYLE: Record<ImportanceTier, string> = {
  critical: "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-300 dark:border-red-700",
  important: "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700",
  normal: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700",
};

const SOURCE_LABEL: Record<string, string> = {
  rule: "規則判定",
  ai: "AI補助判定",
  manual: "手動設定",
};

export function ImportanceOverride({ articleId, importance, importanceReason, importanceSource }: Props) {
  const [current, setCurrent] = useState<ImportanceTier>((importance as ImportanceTier) ?? "normal");
  const [source, setSource] = useState(importanceSource);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function setTier(tier: ImportanceTier) {
    setSaving(true);
    try {
      await fetch("/api/articles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [articleId], importance: tier }),
      });
      setCurrent(tier);
      setSource("manual");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`text-xs px-2 py-1 rounded-lg font-semibold border ${TIER_STYLE[current]}`}>
        {importanceLabel(current)}
      </span>
      {source && (
        <span className="text-xs text-zinc-400">
          ({SOURCE_LABEL[source] ?? source}{importanceReason && source !== "manual" ? `: ${importanceReason}` : ""})
        </span>
      )}

      {editing ? (
        <div className="flex items-center gap-1">
          {IMPORTANCE_TIERS.map((t) => (
            <button
              key={t}
              onClick={() => setTier(t)}
              disabled={saving}
              className={`text-xs px-2 py-1 rounded-lg border disabled:opacity-50 ${
                t === current ? TIER_STYLE[t] : "border-zinc-200 dark:border-zinc-700 text-zinc-500"
              }`}
            >
              {importanceLabel(t)}
            </button>
          ))}
          <button onClick={() => setEditing(false)} className="text-xs text-zinc-400 px-1">
            キャンセル
          </button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
          変更
        </button>
      )}
    </div>
  );
}

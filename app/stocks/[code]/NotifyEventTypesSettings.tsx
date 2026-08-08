"use client";

import { useState } from "react";
import { EVENT_TYPES, eventTypeLabel } from "@/lib/classifiers/event-type";

interface Props {
  stockId: string;
  initialTypes: string[] | null; // null = 全種別を通知
}

export function NotifyEventTypesSettings({ stockId, initialTypes }: Props) {
  const [allTypes, setAllTypes] = useState(initialTypes === null);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialTypes ?? EVENT_TYPES));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggleType(type: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/stocks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: stockId,
          action: "update_notify_event_types",
          notify_event_types: allTypes ? null : [...selected],
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-4 space-y-3">
      <h2 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">通知する開示種別</h2>
      <p className="text-xs text-zinc-400">
        この銘柄で通知(プッシュ通知)を送る開示種別を選べます。記事の保存自体は種別に関わらず行われます。
      </p>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allTypes}
          onChange={(e) => setAllTypes(e.target.checked)}
          className="w-4 h-4 rounded"
        />
        <span className="text-zinc-700 dark:text-zinc-300">全種別を通知する</span>
      </label>

      {!allTypes && (
        <div className="flex flex-wrap gap-2 pt-1">
          {EVENT_TYPES.map((t) => (
            <label
              key={t}
              className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={selected.has(t)}
                onChange={() => toggleType(t)}
                className="w-3.5 h-3.5 rounded"
              />
              {eventTypeLabel(t)}
            </label>
          ))}
        </div>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-50"
      >
        {saving ? "保存中…" : saved ? "保存しました" : "保存"}
      </button>
    </section>
  );
}

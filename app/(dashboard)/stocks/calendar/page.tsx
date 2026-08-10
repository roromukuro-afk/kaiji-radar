"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { formatJST } from "@/lib/utils";
import { deriveEventStatus, EVENT_STATUS_LABEL, type DisplayEventStatus } from "@/lib/calendar/status";

type Stock = { id: string; code: string; name: string };

type StockEvent = {
  id: string;
  stock_id: string;
  event_type: "earnings" | "agm" | "dividend_record" | "other";
  title: string;
  scheduled_date: string;
  status: "scheduled" | "postponed";
  linked_article_id: string | null;
  note: string | null;
  stocks: Stock | null;
  articles: { id: string; title: string; published_at: string | null } | null;
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  earnings: "決算",
  agm: "株主総会",
  dividend_record: "配当基準日",
  other: "その他",
};

const STATUS_COLOR: Record<DisplayEventStatus, string> = {
  scheduled: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200",
  confirmed: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200",
  postponed: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500",
  unconfirmed: "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200",
};

function monthRange(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const from = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const [view, setView] = useState<"month" | "list">("month");
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [events, setEvents] = useState<StockEvent[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [formStock, setFormStock] = useState("");
  const [formType, setFormType] = useState("earnings");
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    const { from, to } = view === "month" ? monthRange(yearMonth) : { from: undefined, to: undefined };
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const res = await fetch(`/api/stock-events?${params}`);
    const j = await res.json();
    setEvents(j.data ?? []);
    setLoading(false);
  }, [yearMonth, view]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => {
    fetch("/api/stocks").then((r) => r.json()).then((j) => setStocks(j.data ?? []));
  }, []);

  async function addEvent() {
    setFormError("");
    if (!formStock || !formTitle.trim() || !formDate) {
      setFormError("銘柄・タイトル・予定日は必須です");
      return;
    }
    setFormSubmitting(true);
    const res = await fetch("/api/stock-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock_id: formStock, event_type: formType, title: formTitle.trim(), scheduled_date: formDate, note: formNote.trim() || undefined }),
    });
    const j = await res.json();
    setFormSubmitting(false);
    if (!res.ok) { setFormError(j.error ?? "追加に失敗しました"); return; }
    setShowForm(false);
    setFormStock(""); setFormTitle(""); setFormDate(""); setFormNote("");
    fetchEvents();
  }

  async function togglePostponed(ev: StockEvent, status: DisplayEventStatus) {
    const nextStatus = status === "postponed" ? "scheduled" : "postponed";
    await fetch("/api/stock-events", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ev.id, status: nextStatus }),
    });
    fetchEvents();
  }

  async function unlinkEvent(ev: StockEvent) {
    await fetch("/api/stock-events", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ev.id, unlink: true }),
    });
    fetchEvents();
  }

  async function deleteEvent(id: string) {
    if (!confirm("この予定を削除しますか?")) return;
    await fetch(`/api/stock-events?id=${id}`, { method: "DELETE" });
    fetchEvents();
  }

  const eventsWithStatus = useMemo(
    () => events.map((ev) => ({ ev, status: deriveEventStatus(ev) })),
    [events]
  );

  const eventsByDate = useMemo(() => {
    const map = new Map<string, typeof eventsWithStatus>();
    for (const item of eventsWithStatus) {
      const list = map.get(item.ev.scheduled_date) ?? [];
      list.push(item);
      map.set(item.ev.scheduled_date, list);
    }
    return map;
  }, [eventsWithStatus]);

  const selectedDayEvents = selectedDate ? eventsByDate.get(selectedDate) ?? [] : [];

  // 月グリッド用の日付配列(先頭は前月の空セルで埋める)
  const monthCells = useMemo(() => {
    if (view !== "month") return [];
    const [y, m] = yearMonth.split("-").map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const startWeekday = firstDay.getDay();
    const cells: (string | null)[] = Array(startWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${yearMonth}-${String(d).padStart(2, "0")}`);
    }
    return cells;
  }, [yearMonth, view]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/stocks" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← 銘柄一覧
        </Link>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold">開示予定カレンダー</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
        >
          + 予定追加
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3 bg-zinc-50 dark:bg-zinc-900">
          <p className="text-sm font-medium">新規予定</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-500">銘柄</label>
              <select value={formStock} onChange={(e) => setFormStock(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="">選択してください</option>
                {stocks.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500">種別</label>
              <select value={formType} onChange={(e) => setFormType(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                {Object.entries(EVENT_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500">タイトル</label>
            <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="2026年3月期 第2四半期決算発表(予定)" className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">予定日</label>
            <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">メモ</label>
            <input value={formNote} onChange={(e) => setFormNote(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
          <div className="flex gap-2">
            <button onClick={addEvent} disabled={formSubmitting} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 disabled:opacity-50">
              {formSubmitting ? "追加中…" : "追加"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">キャンセル</button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button onClick={() => setView("month")} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${view === "month" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"}`}>月表示</button>
          <button onClick={() => setView("list")} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${view === "list" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"}`}>一覧表示</button>
        </div>
        {view === "month" && (
          <div className="flex items-center gap-2">
            <button onClick={() => setYearMonth((v) => shiftMonth(v, -1))} className="px-2 py-1 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">←</button>
            <span className="text-sm font-medium">{yearMonth}</span>
            <button onClick={() => setYearMonth((v) => shiftMonth(v, 1))} className="px-2 py-1 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">→</button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400 text-center py-8">読み込み中…</p>
      ) : view === "month" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-zinc-400">
            {["日", "月", "火", "水", "木", "金", "土"].map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {monthCells.map((date, i) => {
              const dayEvents = date ? eventsByDate.get(date) ?? [] : [];
              return (
                <button
                  key={i}
                  disabled={!date}
                  onClick={() => date && setSelectedDate(date === selectedDate ? null : date)}
                  className={`aspect-square rounded-lg border text-xs flex flex-col items-center justify-center gap-0.5 ${
                    !date ? "border-transparent" :
                    date === selectedDate ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-100 dark:border-zinc-800"
                  }`}
                >
                  {date && <span>{parseInt(date.split("-")[2], 10)}</span>}
                  {dayEvents.length > 0 && (
                    <span className="flex gap-0.5">
                      {dayEvents.slice(0, 3).map((item, j) => (
                        <span key={j} className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[item.status].split(" ")[0]}`} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedDate && (
            <div className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <p className="text-xs font-medium text-zinc-500">{selectedDate}</p>
              {selectedDayEvents.length === 0 ? (
                <p className="text-xs text-zinc-400">予定なし</p>
              ) : (
                selectedDayEvents.map(({ ev, status }) => (
                  <EventCard key={ev.id} ev={ev} status={status} onTogglePostponed={togglePostponed} onUnlink={unlinkEvent} onDelete={deleteEvent} />
                ))
              )}
            </div>
          )}
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-8">予定がありません</p>
      ) : (
        <div className="space-y-2">
          {eventsWithStatus.map(({ ev, status }) => (
            <EventCard key={ev.id} ev={ev} status={status} onTogglePostponed={togglePostponed} onUnlink={unlinkEvent} onDelete={deleteEvent} showDate />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({
  ev, status, onTogglePostponed, onUnlink, onDelete, showDate,
}: {
  ev: StockEvent;
  status: DisplayEventStatus;
  onTogglePostponed: (ev: StockEvent, status: DisplayEventStatus) => void;
  onUnlink: (ev: StockEvent) => void;
  onDelete: (id: string) => void;
  showDate?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 space-y-1.5">
      <div className="flex items-start gap-2 flex-wrap">
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_COLOR[status]}`}>{EVENT_STATUS_LABEL[status]}</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">{EVENT_TYPE_LABEL[ev.event_type]}</span>
        {ev.stocks && <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{ev.stocks.code} {ev.stocks.name}</span>}
        {showDate && <span className="text-xs text-zinc-400">{ev.scheduled_date}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {status !== "confirmed" && (
            <button onClick={() => onTogglePostponed(ev, status)} className="text-xs px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700">
              {status === "postponed" ? "延期解除" : "延期にする"}
            </button>
          )}
          {ev.linked_article_id && (
            <button onClick={() => onUnlink(ev)} className="text-xs px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700">
              リンク解除
            </button>
          )}
          <button onClick={() => onDelete(ev.id)} className="text-xs px-2 py-1 rounded-lg bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800">
            削除
          </button>
        </div>
      </div>
      <p className="text-sm text-zinc-800 dark:text-zinc-200">{ev.title}</p>
      {ev.note && <p className="text-xs text-zinc-500 dark:text-zinc-400">{ev.note}</p>}
      {ev.articles && (
        <Link href={`/article/${ev.articles.id}`} className="block text-xs text-blue-600 dark:text-blue-400 hover:underline">
          該当記事: {ev.articles.title} {ev.articles.published_at && `(${formatJST(ev.articles.published_at)})`}
        </Link>
      )}
    </div>
  );
}

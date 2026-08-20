import { format, formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";

export function formatJST(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "yyyy/MM/dd HH:mm", { locale: ja });
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true, locale: ja });
}

export function sourceTypeLabel(type: string): string {
  const map: Record<string, string> = {
    tdnet: "TDnet",
    edinet: "EDINET",
    sec_edgar: "SEC EDGAR",
    official: "公式",
    pr_times: "PR TIMES",
    jp_news: "国内",
    en_news: "海外",
  };
  return map[type] ?? type;
}

export function sourceTypeColor(type: string): string {
  const map: Record<string, string> = {
    tdnet: "bg-blue-100 text-blue-800",
    edinet: "bg-purple-100 text-purple-800",
    sec_edgar: "bg-indigo-100 text-indigo-800",
    official: "bg-green-100 text-green-800",
    pr_times: "bg-pink-100 text-pink-800",
    jp_news: "bg-gray-100 text-gray-800",
    en_news: "bg-orange-100 text-orange-800",
  };
  return map[type] ?? "bg-gray-100 text-gray-800";
}

export function relevanceLabel(r: string): string {
  if (r === "uncertain") return "関連不確実";
  return "";
}

export function truncate(text: string | null | undefined, maxLen = 120): string {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// トラッキングパラメータ等を除去してURLを正規化する。
// 同じ記事がパラメータ違い・Google Newsのトークン違い等で重複保存されるのを防ぐための重複判定キー。
const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "oc", "ref", "fbclid", "gclid"];

export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    u.searchParams.sort();
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const query = u.searchParams.toString();
    return `${host}${path}${query ? "?" + query : ""}`;
  } catch {
    return url;
  }
}

export function toJSTISOString(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().replace("Z", "+09:00");
}

export function parseJSTDate(dateStr: string): Date {
  return new Date(dateStr);
}

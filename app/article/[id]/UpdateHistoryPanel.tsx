import { diffChars, diffWords } from "diff";
import { formatJST } from "@/lib/utils";

type UpdateRow = {
  id: string;
  previous_title: string | null;
  new_title: string | null;
  previous_body: string | null;
  new_body: string | null;
  change_type: string | null;
  detected_at: string;
};

type PdfRow = {
  id: string;
  file_hash: string | null;
  file_size_bytes: number | null;
  extraction_method: string | null;
  extracted_text: string | null;
  fetched_at: string;
};

interface Props {
  originalTitle: string;
  originalCreatedAt: string;
  updates: UpdateRow[];
  pdfs: PdfRow[];
}

function TitleDiff({ from, to }: { from: string; to: string }) {
  const parts = diffChars(from, to);
  return (
    <p className="text-sm leading-relaxed break-words">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <span key={i} className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span key={i} className="bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 line-through">
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </p>
  );
}

// 訂正開示の差分表示(新規実装4): 数値・日付らしいトークンは特に見落としやすいため強調する。
// (要約・投資判断は行わない。機械的な文字列パターンでの強調のみ)
const NUMERIC_OR_DATE = /^[▲△+\-−]?[\d,]+(\.\d+)?%?$|^\d{1,4}[年/-]\d{1,2}([月/-]\d{1,2}日?)?$/;

function isNumericOrDateToken(text: string): boolean {
  return NUMERIC_OR_DATE.test(text.trim());
}

// 本文が極端に長い場合(大部の決算資料等)は単語単位diffのレンダリング負荷を避ける
const MAX_DIFF_LENGTH = 20000;

function BodyDiff({ from, to }: { from: string; to: string }) {
  if (from.length > MAX_DIFF_LENGTH || to.length > MAX_DIFF_LENGTH) {
    return (
      <p className="text-xs text-zinc-400">
        本文が長いため差分表示を省略しました({from.length.toLocaleString()}文字 → {to.length.toLocaleString()}文字)
      </p>
    );
  }
  const parts = diffWords(from, to);
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        const flagged = isNumericOrDateToken(part.value);
        if (part.added) {
          return (
            <span
              key={i}
              className={`bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 ${flagged ? "font-bold underline decoration-2" : ""}`}
            >
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span
              key={i}
              className={`bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 line-through ${flagged ? "font-bold" : ""}`}
            >
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </p>
  );
}

type TimelineEvent =
  | { kind: "title"; at: string; ordinal: number; from: string; to: string; bodyFrom: string | null; bodyTo: string | null }
  | { kind: "pdf"; at: string; ordinal: number; hash: string | null; textFrom: string | null; textTo: string | null };

export function UpdateHistoryPanel({ originalTitle, originalCreatedAt, updates, pdfs }: Props) {
  if (updates.length === 0 && pdfs.length <= 1) return null;

  // 訂正履歴: 「初回」の直後のタイトルから、直前のタイトルとの差分を表示する
  const timeline = updates
    .slice()
    .sort((a, b) => new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime());

  const pdfsByTime = pdfs.slice().sort((a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime());

  // タイトル変更とPDF差し替えを時系列で統合表示(どちらが先だったか一目でわかるように)
  const combined: TimelineEvent[] = [
    ...timeline.map((u, i): TimelineEvent => ({
      kind: "title", at: u.detected_at, ordinal: i + 1, from: u.previous_title ?? "", to: u.new_title ?? "",
      bodyFrom: u.previous_body, bodyTo: u.new_body,
    })),
    // 最初のPDF(初回保存分)は「差し替え」ではないので除外し、2件目以降のみ差し替えイベントとする
    ...pdfsByTime.slice(1).map((p, i): TimelineEvent => ({
      kind: "pdf", at: p.fetched_at, ordinal: i + 1, hash: p.file_hash,
      textFrom: pdfsByTime[i].extracted_text, textTo: p.extracted_text,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <section className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-4 space-y-4">
      <h2 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">訂正・更新履歴</h2>

      {(updates.length > 0 || pdfsByTime.length > 1) && (
        <ol className="space-y-3">
          <li className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium">
                初回
              </span>
              <span className="text-xs text-zinc-400">{formatJST(originalCreatedAt)}</span>
            </div>
            <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {timeline[0]?.previous_title ?? originalTitle}
            </p>
          </li>

          {combined.map((ev, idx) =>
            ev.kind === "title" ? (
              <li key={`title-${idx}`} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 font-medium">
                    {ev.ordinal === 1 ? "訂正" : `再訂正 (${ev.ordinal}回目)`}
                  </span>
                  <span className="text-xs text-zinc-400">{formatJST(ev.at)}</span>
                </div>
                <TitleDiff from={ev.from} to={ev.to} />
                {ev.bodyFrom !== null && ev.bodyTo !== null && ev.bodyFrom !== ev.bodyTo && (
                  <div className="mt-1 pl-2 border-l-2 border-zinc-200 dark:border-zinc-700">
                    <p className="text-[11px] text-zinc-400 mb-0.5">概要の差分</p>
                    <BodyDiff from={ev.bodyFrom} to={ev.bodyTo} />
                  </div>
                )}
              </li>
            ) : (
              <li key={`pdf-${idx}`} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-medium">
                    PDF差し替え
                  </span>
                  <span className="text-xs text-zinc-400">{formatJST(ev.at)}</span>
                  {ev.hash && <span className="text-xs text-zinc-400 font-mono">hash:{ev.hash.slice(0, 8)}</span>}
                </div>
                <div className="mt-1 pl-2 border-l-2 border-zinc-200 dark:border-zinc-700">
                  {ev.textFrom && ev.textTo ? (
                    <>
                      <p className="text-[11px] text-zinc-400 mb-0.5">本文の差分(数値・日付の変更を強調表示)</p>
                      <BodyDiff from={ev.textFrom} to={ev.textTo} />
                    </>
                  ) : (
                    <p className="text-xs text-zinc-400">本文抽出データがないため差分表示できません</p>
                  )}
                </div>
              </li>
            )
          )}
        </ol>
      )}

      {pdfs.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
          <p className="text-xs font-medium text-zinc-500">PDFバージョン</p>
          {pdfs
            .slice()
            .sort((a, b) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime())
            .map((pdf, i) => (
              <div key={pdf.id} className="flex items-center gap-2 text-xs text-zinc-500">
                <span
                  className={`px-1.5 py-0.5 rounded font-medium ${
                    i === 0
                      ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {i === 0 ? "最新版" : "過去版"}
                </span>
                <span>{formatJST(pdf.fetched_at)}</span>
                {pdf.file_hash && <span className="font-mono">hash:{pdf.file_hash.slice(0, 8)}</span>}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

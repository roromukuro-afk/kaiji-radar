import { diffChars } from "diff";
import { formatJST } from "@/lib/utils";

type UpdateRow = {
  id: string;
  previous_title: string | null;
  new_title: string | null;
  change_type: string | null;
  detected_at: string;
};

type PdfRow = {
  id: string;
  file_hash: string | null;
  file_size_bytes: number | null;
  extraction_method: string | null;
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

export function UpdateHistoryPanel({ originalTitle, originalCreatedAt, updates, pdfs }: Props) {
  if (updates.length === 0 && pdfs.length <= 1) return null;

  // 訂正履歴: 「初回」の直後のタイトルから、直前のタイトルとの差分を表示する
  const timeline = updates
    .slice()
    .sort((a, b) => new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime());

  return (
    <section className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-4 space-y-4">
      <h2 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">訂正・更新履歴</h2>

      {updates.length > 0 && (
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

          {timeline.map((u, i) => (
            <li key={u.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 font-medium">
                  {i === 0 ? "訂正" : `再訂正 (${i + 1}回目)`}
                </span>
                <span className="text-xs text-zinc-400">{formatJST(u.detected_at)}</span>
              </div>
              <TitleDiff from={u.previous_title ?? ""} to={u.new_title ?? ""} />
            </li>
          ))}
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

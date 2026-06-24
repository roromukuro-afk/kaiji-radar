import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { formatJST, sourceTypeLabel, sourceTypeColor } from "@/lib/utils";
import Link from "next/link";
import { FeedbackPanel } from "./FeedbackPanel";

type Stock = { id: string; code: string; name: string };

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: article } = await supabase
    .from("articles")
    .select(`
      *,
      article_stocks (
        stock_id,
        stocks (id, code, name)
      )
    `)
    .eq("id", id)
    .single();

  if (!article) notFound();

  // Mark as read
  await supabase.from("articles").update({ is_read: true, read_at: new Date().toISOString() }).eq("id", id);

  // Get PDF if exists
  let pdfUrl: string | null = null;
  if (article.is_pdf && article.pdf_document_id) {
    const { data: pdf } = await supabase
      .from("pdf_documents")
      .select("storage_path, extracted_text")
      .eq("id", article.pdf_document_id)
      .single();

    if (pdf?.storage_path) {
      const { data: signed } = await supabase.storage
        .from("pdfs")
        .createSignedUrl(pdf.storage_path, 3600);
      pdfUrl = signed?.signedUrl ?? null;
    }
  }

  const stocks: Stock[] =
    (article.article_stocks as { stock_id: string; stocks: Stock | null }[] | null)
      ?.map((as) => as.stocks)
      .filter((s): s is Stock => s !== null) ?? [];

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 h-12 flex items-center gap-3">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            ← 一覧
          </Link>
          <span className="text-sm text-zinc-300 dark:text-zinc-600">|</span>
          <span className="text-sm text-zinc-500 truncate">{sourceTypeLabel(article.source_type)}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          <span className={`text-xs px-2 py-1 rounded-lg font-medium ${sourceTypeColor(article.source_type)}`}>
            {sourceTypeLabel(article.source_type)}
          </span>
          {stocks.map((s) => (
            <Link
              key={s.id}
              href={`/stocks/${s.code}`}
              className="text-xs px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              {s.code} {s.name}
            </Link>
          ))}
          {article.is_update && (
            <span className="text-xs px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">更新</span>
          )}
          {article.relevance === "uncertain" && (
            <span className="text-xs px-2 py-1 rounded-lg bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200">関連不確実</span>
          )}
          {(article.exclusion_candidate === true) && (
            <span className="text-xs px-2 py-1 rounded-lg bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300">除外候補</span>
          )}
          {article.is_paywalled && (
            <span className="text-xs px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500">有料記事</span>
          )}
          {article.doc_type && (
            <span className="text-xs px-2 py-1 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">{article.doc_type}</span>
          )}
        </div>

        {/* Title */}
        <div className="space-y-1">
          {article.is_overseas && article.title_ja && (
            <p className="text-base text-zinc-500 dark:text-zinc-400">[{article.title_ja}]</p>
          )}
          <h1 className="text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
            {article.title}
          </h1>
        </div>

        {/* Meta */}
        <div className="text-sm text-zinc-500 space-y-0.5">
          {article.publisher && <p>{article.publisher}</p>}
          {article.published_at && <p>{formatJST(article.published_at)}</p>}
        </div>

        {/* Summary */}
        {article.summary && (
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-4">
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">AI要約</p>
            <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">{article.summary}</p>
          </div>
        )}

        {/* Feedback panel — one per linked stock */}
        {stocks.length > 0 && (
          <div className="space-y-3">
            {stocks.map((s) => (
              <FeedbackPanel
                key={s.id}
                articleId={id}
                stock={s}
                systemRelevance={article.relevance as string | null}
                systemExclusion={article.exclusion_candidate === true}
              />
            ))}
          </div>
        )}

        {/* External link */}
        {article.source_url && (
          <a
            href={article.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <span className="flex-1 truncate">{article.source_url}</span>
            <span className="flex-shrink-0">↗</span>
          </a>
        )}

        {/* PDF viewer */}
        {pdfUrl && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">PDF</p>
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400"
              >
                別ウィンドウで開く ↗
              </a>
            </div>
            <iframe
              src={pdfUrl}
              className="w-full h-[600px] rounded-xl border border-zinc-200 dark:border-zinc-700"
              title="PDF viewer"
            />
          </div>
        )}
      </main>
    </div>
  );
}

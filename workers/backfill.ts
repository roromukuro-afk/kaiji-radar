/**
 * 過去1年分 初期取り込みワーカー
 *
 * 初回セットアップ時に一度だけ実行する。
 * - TDnet: やのしんRSSの全履歴（最大50件/銘柄）
 * - EDINET: 過去365日分を1日ずつAPIコール（rate limit付き）
 * - ニュース: Google News RSSは直近のみ。ニュースバックフィルは行わない。
 *
 * 実行方法:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx workers/backfill.ts
 */

import { createClient } from "@supabase/supabase-js";
import { fetchTdnetByCode } from "../lib/fetchers/tdnet.js";
import { fetchEdinetByDate, stockCodeToSecCode, docTypeLabel } from "../lib/fetchers/edinet.js";
import { fetchAndStorePdf } from "../lib/processors/pdf.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DAYS_BACK = 365;

async function main() {
  console.log("[backfill] 開始", new Date().toISOString());
  console.log(`[backfill] 対象期間: 過去 ${DAYS_BACK} 日`);

  // Load active stocks
  const { data: rawStocks, error } = await supabase
    .from("stocks")
    .select("id, code, name, name_en, sec_code, edinet_code")
    .eq("status", "active");

  if (error || !rawStocks) {
    console.error("[backfill] 銘柄取得失敗:", error);
    process.exit(1);
  }

  console.log(`[backfill] 対象銘柄: ${rawStocks.length}件`);

  const sinceDate = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000);

  // ============================
  // 1. TDnet (やのしんRSS 全履歴)
  // ============================
  console.log("\n[backfill] === TDnet ===");
  let tdnetTotal = 0;

  for (const stock of rawStocks) {
    console.log(`  [TDnet] ${stock.code} ${stock.name}...`);
    try {
      // No sinceDate filter - get all available items from RSS
      const items = await fetchTdnetByCode(stock.code);
      let saved = 0;

      for (const item of items) {
        if (item.publishedAt < sinceDate) continue;

        const isDup = await isDuplicate(item.url, item.docId, undefined);
        if (isDup) continue;

        const { data: article, error: insErr } = await supabase
          .from("articles")
          .insert({
            source_type: "tdnet",
            source_url: item.url,
            tdnet_doc_id: item.docId,
            title: item.title,
            publisher: item.submitter,
            published_at: item.publishedAt.toISOString(),
            is_pdf: !!item.pdfUrl,
            doc_type: item.docType,
            relevance: "certain",
          })
          .select("id")
          .single();

        if (insErr) {
          if (insErr.code !== "23505") console.error("  insert error:", insErr.message);
          continue;
        }

        await supabase.from("article_stocks").insert({
          article_id: article!.id,
          stock_id: stock.id,
        });

        // Store PDF (non-blocking)
        if (item.pdfUrl) {
          storePdfAsync(item.pdfUrl, item.docId, "tdnet", article!.id);
        }

        saved++;
        tdnetTotal++;
      }

      console.log(`    → ${saved} 件保存`);
    } catch (err) {
      console.error(`  [TDnet] ${stock.code} 失敗:`, err);
    }
    await sleep(500);
  }

  console.log(`\n[backfill] TDnet 合計: ${tdnetTotal} 件`);

  // ============================
  // 2. EDINET (365日分)
  // ============================
  console.log("\n[backfill] === EDINET ===");
  let edinetTotal = 0;

  const secCodes = rawStocks.map((s) => s.sec_code ?? stockCodeToSecCode(s.code));
  const secToStock = new Map(rawStocks.map((s) => [
    s.sec_code ?? stockCodeToSecCode(s.code),
    s,
  ]));

  // Generate date list: today back to 365 days ago
  const dates: Date[] = [];
  for (let i = 0; i <= DAYS_BACK; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d);
  }

  console.log(`  EDINET: ${dates.length}日分を取得 (rate limit付き)...`);
  let dateIdx = 0;

  for (const date of dates) {
    dateIdx++;
    const dateStr = date.toISOString().split("T")[0];

    // Skip weekends (EDINET doesn't have submissions on weekends usually)
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;

    try {
      const items = await fetchEdinetByDate(date, secCodes);
      let saved = 0;

      for (const item of items) {
        const stock = secToStock.get(item.secCode ?? "") ??
          findStockByEdinetCode(rawStocks, item.edinetCode);
        if (!stock) continue;

        const isDup = await isDuplicate(
          `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S${item.docId}`,
          undefined,
          item.docId
        );
        if (isDup) continue;

        const { data: article, error: insErr } = await supabase
          .from("articles")
          .insert({
            source_type: "edinet",
            source_url: `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S${item.docId}`,
            edinet_doc_id: item.docId,
            edinet_submitter_code: item.edinetCode,
            edinet_doc_type_code: item.docTypeCode,
            title: `${docTypeLabel(item.docTypeCode)}: ${item.docDescription}`,
            publisher: item.filerName,
            published_at: item.submitDateTime.toISOString(),
            is_pdf: !!item.pdfUrl,
            doc_type: docTypeLabel(item.docTypeCode),
            relevance: "certain",
          })
          .select("id")
          .single();

        if (insErr) {
          if (insErr.code !== "23505") console.error("  insert error:", insErr.message);
          continue;
        }

        await supabase.from("article_stocks").insert({
          article_id: article!.id,
          stock_id: stock.id,
        });

        if (item.pdfUrl) {
          storePdfAsync(item.pdfUrl, item.docId, "edinet", article!.id);
        }

        saved++;
        edinetTotal++;
      }

      if (saved > 0) {
        console.log(`  ${dateStr}: ${saved} 件`);
      }
    } catch (err) {
      console.error(`  EDINET ${dateStr} 失敗:`, err);
    }

    // Rate limit: 500ms per day, with progress report every 30 days
    await sleep(500);
    if (dateIdx % 30 === 0) {
      console.log(`  進捗: ${dateIdx}/${dates.length}日処理済み`);
    }
  }

  console.log(`\n[backfill] EDINET 合計: ${edinetTotal} 件`);

  // ============================
  // Mark stocks as initial fetch completed
  // ============================
  for (const stock of rawStocks) {
    await supabase
      .from("stocks")
      .update({
        initial_fetch_completed: true,
        initial_fetch_completed_at: new Date().toISOString(),
        initial_fetch_summary: {
          tdnet: tdnetTotal,
          edinet: edinetTotal,
          completed_at: new Date().toISOString(),
        },
      })
      .eq("id", stock.id);
  }

  console.log("\n[backfill] 完了!");
  console.log(`  TDnet: ${tdnetTotal} 件`);
  console.log(`  EDINET: ${edinetTotal} 件`);
  console.log("  ニュース: バックフィル不可（Google News RSSは直近のみ）");
}

// ============================
// Helpers
// ============================

async function isDuplicate(url: string, tdnetDocId?: string, edinetDocId?: string): Promise<boolean> {
  if (tdnetDocId) {
    const { count } = await supabase
      .from("articles").select("id", { count: "exact", head: true })
      .eq("tdnet_doc_id", tdnetDocId);
    if (count && count > 0) return true;
  }
  if (edinetDocId) {
    const { count } = await supabase
      .from("articles").select("id", { count: "exact", head: true })
      .eq("edinet_doc_id", edinetDocId);
    if (count && count > 0) return true;
  }
  const { count } = await supabase
    .from("articles").select("id", { count: "exact", head: true })
    .eq("source_url", url);
  return (count ?? 0) > 0;
}

function findStockByEdinetCode(stocks: any[], edinetCode: string) {
  return stocks.find((s) => s.edinet_code === edinetCode) ?? null;
}

function storePdfAsync(pdfUrl: string, docId: string, sourceType: string, articleId: string) {
  fetchAndStorePdf(pdfUrl, docId, sourceType)
    .then(async (result) => {
      const { data: pdf } = await supabase
        .from("pdf_documents")
        .insert({
          article_id: articleId,
          source_url: pdfUrl,
          storage_path: result.storagePath,
          file_hash: result.fileHash,
          file_size_bytes: result.fileSizeBytes,
          extracted_text: result.extractedText,
          ocr_text: result.ocrText,
          extraction_method: result.extractionMethod,
          ocr_quality: result.ocrQuality,
        })
        .select("id")
        .single();
      if (pdf) {
        await supabase.from("articles").update({ pdf_document_id: pdf.id }).eq("id", articleId);
      }
    })
    .catch((err) => console.error(`[backfill] PDF失敗 ${docId}:`, err));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("[backfill] FATAL:", err);
  process.exit(1);
});

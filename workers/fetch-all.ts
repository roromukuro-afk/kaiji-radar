/**
 * 毎時巡回ワーカー
 *
 * GitHub Actions から hourly cron で実行される。
 * 全情報ソースを巡回し、新着を保存・通知する。
 *
 * 優先順位 (障害時も維持):
 * 1. TDnet / EDINET
 * 2. 企業公式 / プレスリリース
 * 3. 国内ニュース / 株式メディア
 * 4. 海外英語ニュース
 */

import { createClient } from "@supabase/supabase-js";
import {
  fetchTdnetByCode,
  fetchTdnetRecent,
  fetchTdnetByCodeDirect,
} from "../lib/fetchers/tdnet.js";
import {
  fetchEdinetByDate,
  stockCodeToSecCode,
  docTypeLabel,
} from "../lib/fetchers/edinet.js";
import {
  fetchGoogleNewsJP,
  fetchGoogleNewsEN,
  fetchPRTimes,
  fetchGenericRss,
  detectPaywall,
} from "../lib/fetchers/news.js";
import {
  checkRelevance,
  translateTitleJa,
  quickKeywordMatch,
} from "../lib/processors/relevance.js";
import { fetchAndStorePdf } from "../lib/processors/pdf.js";
import {
  sendPushToAll,
  buildPushPayload,
} from "../lib/notifications/web-push.js";
import { sendErrorEmail, sendRecoveryEmail, sendPendingArticlesEmail } from "../lib/notifications/email.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Lookback window to avoid missing items near boundary
const LOOKBACK_HOURS_NORMAL = 3;
const LOOKBACK_HOURS_RECOVERY = 48; // 障害後の遡及取得上限
const MAX_RETRIES = 3;

interface StockProfile {
  rss_urls: string[];
  jp_keywords: string[];
  en_keywords: string[];
  official_url: string | null;
  ir_url: string | null;
  press_release_url: string | null;
}

interface StockRecord {
  id: string;
  code: string;
  name: string;
  name_en: string | null;
  edinet_code: string | null;
  sec_code: string | null;
  stock_profiles: StockProfile | null;
}

async function main() {
  console.log("[fetch-all] 巡回開始", new Date().toISOString());

  const { data: jobRow } = await supabase
    .from("fetch_jobs")
    .insert({ job_type: "hourly", status: "running" })
    .select("id")
    .single();
  const jobId = jobRow?.id;

  // 障害復旧後の遡及取得: 前回実行からの経過時間を確認
  const { data: lastRunSetting } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "last_hourly_run")
    .single();

  let lookbackHours = LOOKBACK_HOURS_NORMAL;
  if (lastRunSetting?.value && lastRunSetting.value !== "null") {
    const lastRun = new Date(JSON.parse(lastRunSetting.value));
    const hoursSinceLastRun = (Date.now() - lastRun.getTime()) / (60 * 60 * 1000);
    if (hoursSinceLastRun > LOOKBACK_HOURS_NORMAL * 2) {
      // 通常の2倍以上空いていた = 障害・停止後の復旧
      lookbackHours = Math.min(hoursSinceLastRun + 1, LOOKBACK_HOURS_RECOVERY);
      console.log(`[fetch-all] 復旧モード: 直近 ${Math.round(lookbackHours)} 時間を遡及取得`);
    }
  }

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  // Load active stocks
  const { data: stocks, error: stocksErr } = await supabase
    .from("stocks")
    .select(`
      id, code, name, name_en, edinet_code, sec_code,
      stock_profiles (rss_urls, jp_keywords, en_keywords, official_url, ir_url, press_release_url)
    `)
    .eq("status", "active");

  if (stocksErr || !stocks) {
    console.error("[fetch-all] 銘柄取得失敗:", stocksErr);
    if (jobId) await supabase.from("fetch_jobs").update({ status: "failed", error_message: String(stocksErr) }).eq("id", jobId);
    return;
  }

  // Supabase returns related rows as arrays; normalize to single object
  const normalizedStocks: StockRecord[] = stocks.map((s) => ({
    ...s,
    stock_profiles: Array.isArray(s.stock_profiles)
      ? (s.stock_profiles[0] ?? null)
      : s.stock_profiles,
  }));

  const startTime = Date.now();

  type SourceStats = { candidates: number; saved: number; skipped: number; updated: number; errors: number };
  const mkSrc = (): SourceStats => ({ candidates: 0, saved: 0, skipped: 0, updated: 0, errors: 0 });

  const results = {
    per_source: {
      tdnet:    mkSrc(),
      edinet:   mkSrc(),
      official: mkSrc(),
      jp_news:  mkSrc(),
      en_news:  mkSrc(),
    },
    errors: [] as string[],
  };

  // Shorthands for backward-compat
  const src = results.per_source;

  // ============================
  // 1. TDnet
  // ============================
  console.log("[fetch-all] TDnet 取得開始");
  await updateHealth("tdnet", "checking");
  let tdnetOk = false;
  try {
    let recentItems = await withRetry(() => fetchTdnetRecent(since));

    // yanoshinがGitHub Actions IPをブロックしている場合は0件になる
    // その場合はYahoo Finance Japan からスクレイプする
    if (recentItems.length === 0) {
      console.log("[TDnet] yanoshin 0件 → Yahoo Finance Japan フォールバック");
      const directItems: typeof recentItems = [];
      for (const stock of normalizedStocks) {
        const items = await fetchTdnetByCodeDirect(stock.code, since);
        directItems.push(...items);
        await sleep(400);
      }
      if (directItems.length > 0) {
        recentItems = directItems;
        console.log(`[TDnet] Yahoo Finance Japan から ${recentItems.length} 件取得`);
      }
    }

    const byCode = groupByCode(recentItems.filter((i) => normalizedStocks.some((s) => s.code === i.code)));

    for (const stock of normalizedStocks) {
      const allItems = byCode[stock.code] ?? [];

      for (const item of allItems) {
        src.tdnet.candidates++;
        const r = await saveArticle({
          source_type: "tdnet",
          source_url: item.url,
          tdnet_doc_id: item.docId,
          title: item.title,
          publisher: item.submitter,
          published_at: item.publishedAt.toISOString(),
          summary: null,
          is_pdf: !!item.pdfUrl,
          doc_type: item.docType,
          stock,
          relevance: "certain",
        });
        if (r.outcome === "new") {
          src.tdnet.saved++;
          if (item.pdfUrl) await processPdf(item.pdfUrl, item.docId, "tdnet", r.article.id);
          await notifyArticle(r.article, stock);
        } else if (r.outcome === "duplicate") {
          src.tdnet.skipped++;
        } else if (r.outcome === "updated") {
          src.tdnet.updated++;
        } else {
          src.tdnet.errors++;
        }
      }
      await sleep(200);
    }
    console.log(`[TDnet] candidates=${src.tdnet.candidates} saved=${src.tdnet.saved} skipped=${src.tdnet.skipped}`);
    tdnetOk = true;
    await updateHealth("tdnet", "ok");
  } catch (err) {
    results.errors.push(`TDnet: ${err}`);
    await handleSourceError("tdnet", String(err));
  }

  // ============================
  // 2. EDINET
  // ============================
  console.log("[fetch-all] EDINET 取得開始");
  if (!process.env.EDINET_API_KEY) {
    console.log("[EDINET] APIキー未設定 → スキップ");
    // status: "key_missing" は DB の CHECK 制約外のため "failed" + error_message で代替
    await supabase.from("health_checks").upsert(
      {
        source: "edinet",
        status: "failed",
        error_message: "APIキー未設定",
        consecutive_failures: 0,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "source" }
    );
  } else {
  await updateHealth("edinet", "checking");
  try {
    const secCodes = normalizedStocks.map((s) => s.sec_code ?? stockCodeToSecCode(s.code));
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    for (const date of [yesterday, today]) {
      const items = await withRetry(() =>
        fetchEdinetByDate(date, secCodes)
      );

      for (const item of items) {
        const stock = findStockBySecCode(normalizedStocks, item.secCode ?? "");
        if (!stock) continue;

        src.edinet.candidates++;
        const r = await saveArticle({
          source_type: "edinet",
          source_url: `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S${item.docId}`,
          edinet_doc_id: item.docId,
          edinet_submitter_code: item.edinetCode,
          edinet_doc_type_code: item.docTypeCode,
          title: `${docTypeLabel(item.docTypeCode)}: ${item.docDescription}`,
          publisher: item.filerName,
          published_at: item.submitDateTime.toISOString(),
          summary: null,
          is_pdf: !!item.pdfUrl,
          doc_type: docTypeLabel(item.docTypeCode),
          stock,
          relevance: "certain",
        });

        if (r.outcome === "new") {
          src.edinet.saved++;
          if (item.pdfUrl) await processPdf(item.pdfUrl, item.docId, "edinet", r.article.id);
          await notifyArticle(r.article, stock);
        } else if (r.outcome === "duplicate") { src.edinet.skipped++;
        } else if (r.outcome === "updated")   { src.edinet.updated++;
        } else                                { src.edinet.errors++; }
      }
      await sleep(1000);
    }
    await updateHealth("edinet", "ok");
  } catch (err) {
    results.errors.push(`EDINET: ${err}`);
    await handleSourceError("edinet", String(err));
  }
  } // end EDINET key check

  // ============================
  // 3. 国内ニュース
  // ============================
  console.log("[fetch-all] 国内ニュース取得開始");
  await updateHealth("jp_news", "checking");
  try {
    for (const stock of normalizedStocks) {
      const profile = stock.stock_profiles;
      const keywords = [
        stock.name,
        stock.code,
        ...(profile?.jp_keywords ?? []),
      ].filter(Boolean);

      const newsItems = await fetchGoogleNewsJP(keywords.slice(0, 5), since);
      const prItems = await fetchPRTimes(stock.name, since);

      // Custom RSS feeds (企業公式、IR等)
      const customItems = [];
      for (const rssUrl of profile?.rss_urls ?? []) {
        const items = await fetchGenericRss(rssUrl, "official", since);
        customItems.push(...items);
      }

      for (const item of [...newsItems, ...prItems, ...customItems]) {
        src.jp_news.candidates++;
        const isPaywall = detectPaywall(item.url);
        const existing = await findExistingArticle(item.url);
        if (existing) { src.jp_news.skipped++; continue; }

        const match = quickKeywordMatch(
          item.title + (item.summary ?? ""),
          stock.name,
          stock.code,
          profile?.jp_keywords ?? []
        );

        let relevance: "certain" | "uncertain" | "irrelevant" = match ? "certain" : "uncertain";
        let relevanceReason = "";

        if (!match) {
          const check = await checkRelevance(
            item.title, item.summary, stock.code, stock.name, profile?.jp_keywords ?? []
          );
          relevance = check.result;
          relevanceReason = check.reason;
        }

        if (relevance === "irrelevant") {
          await logExclusion(item.url, item.title, "jp_news", stock.code, relevanceReason);
          continue;
        }

        const r = await saveArticle({
          source_type: item.sourceType,
          source_url: item.url,
          title: item.title,
          publisher: item.publisher,
          published_at: item.publishedAt.toISOString(),
          summary: item.summary,
          is_paywalled: isPaywall,
          stock,
          relevance,
          relevance_reason: relevanceReason,
        });

        if (r.outcome === "new") { src.jp_news.saved++; await notifyArticle(r.article, stock);
        } else if (r.outcome === "duplicate") { src.jp_news.skipped++;
        } else if (r.outcome === "updated")   { src.jp_news.updated++;
        } else                                { src.jp_news.errors++; }
      }
      await sleep(500);
    }
    await updateHealth("jp_news", "ok");
  } catch (err) {
    results.errors.push(`JP news: ${err}`);
    await handleSourceError("jp_news", String(err));
  }

  // ============================
  // 4. 海外ニュース (英語)
  // ============================
  console.log("[fetch-all] 海外ニュース取得開始");
  await updateHealth("en_news", "checking");
  try {
    for (const stock of normalizedStocks) {
      const profile = stock.stock_profiles;
      const keywords = [
        stock.name_en ?? stock.name,
        stock.code,
        ...(profile?.en_keywords ?? []),
      ].filter(Boolean);

      const enItems = await fetchGoogleNewsEN(keywords.slice(0, 4), since);

      for (const item of enItems) {
        src.en_news.candidates++;
        const existing = await findExistingArticle(item.url);
        if (existing) { src.en_news.skipped++; continue; }

        const match = quickKeywordMatch(
          item.title + (item.summary ?? ""),
          stock.name_en ?? stock.name,
          stock.code,
          profile?.en_keywords ?? []
        );

        let relevance: "certain" | "uncertain" | "irrelevant" = match ? "certain" : "uncertain";
        let relevanceReason = "";
        let titleJa: string | null = null;

        if (!match) {
          const check = await checkRelevance(
            item.title, item.summary, stock.code, stock.name,
            [...(profile?.jp_keywords ?? []), ...(profile?.en_keywords ?? [])]
          );
          relevance = check.result;
          relevanceReason = check.reason;
        }

        if (relevance === "irrelevant") {
          await logExclusion(item.url, item.title, "en_news", stock.code, relevanceReason);
          continue;
        }

        try { titleJa = await translateTitleJa(item.title); } catch { titleJa = null; }

        const r = await saveArticle({
          source_type: "en_news",
          source_url: item.url,
          title: item.title,
          title_ja: titleJa,
          publisher: item.publisher,
          published_at: item.publishedAt.toISOString(),
          summary: item.summary,
          is_overseas: true,
          is_paywalled: detectPaywall(item.url),
          stock,
          relevance,
          relevance_reason: relevanceReason,
        });

        if (r.outcome === "new") { src.en_news.saved++; await notifyArticle(r.article, stock);
        } else if (r.outcome === "duplicate") { src.en_news.skipped++;
        } else if (r.outcome === "updated")   { src.en_news.updated++;
        } else                                { src.en_news.errors++; }
      }
      await sleep(500);
    }
    await updateHealth("en_news", "ok");
  } catch (err) {
    results.errors.push(`EN news: ${err}`);
    await handleSourceError("en_news", String(err));
  }

  // ============================
  // Check for unsent notifications
  // ============================
  const { count: pendingCount } = await supabase
    .from("articles")
    .select("id", { count: "exact", head: true })
    .eq("notification_sent", false)
    .gte("notification_failed_count", 2);

  if (pendingCount && pendingCount > 0) {
    await sendPendingArticlesEmail(pendingCount);
  }

  // ============================
  // Finalize job
  // ============================
  const durationSeconds = (Date.now() - startTime) / 1000;
  const totalSaved    = src.tdnet.saved + src.edinet.saved + src.official.saved + src.jp_news.saved + src.en_news.saved;
  const totalFound    = src.tdnet.candidates + src.edinet.candidates + src.official.candidates + src.jp_news.candidates + src.en_news.candidates;
  const totalSkipped  = src.tdnet.skipped + src.edinet.skipped + src.official.skipped + src.jp_news.skipped + src.en_news.skipped;
  const totalUpdated  = src.tdnet.updated + src.edinet.updated + src.official.updated + src.jp_news.updated + src.en_news.updated;

  console.log(`[fetch-all] 完了: 対象銘柄=${normalizedStocks.length} 候補=${totalFound} 保存=${totalSaved} スキップ=${totalSkipped} 更新=${totalUpdated} 実行時間=${Math.round(durationSeconds)}s`);

  if (jobId) {
    await supabase
      .from("fetch_jobs")
      .update({
        status: results.errors.length === 0 ? "completed" : "failed",
        completed_at: new Date().toISOString(),
        articles_found: totalFound,
        articles_saved: totalSaved,
        tdnet_count: src.tdnet.saved,
        edinet_count: src.edinet.saved,
        official_count: src.official.saved,
        jp_news_count: src.jp_news.saved,
        en_news_count: src.en_news.saved,
        error_message: results.errors.join("\n") || null,
        source_results: {
          stocks_count: normalizedStocks.length,
          duration_seconds: Math.round(durationSeconds * 10) / 10,
          total: { candidates: totalFound, saved: totalSaved, skipped: totalSkipped, updated: totalUpdated },
          per_source: {
            tdnet:    src.tdnet,
            edinet:   src.edinet,
            official: src.official,
            jp_news:  src.jp_news,
            en_news:  src.en_news,
          },
        },
      })
      .eq("id", jobId);
  }

  await supabase
    .from("system_settings")
    .upsert({ key: "last_hourly_run", value: `"${new Date().toISOString()}"`, updated_at: new Date().toISOString() });
}

// ============================
// Helper functions
// ============================

type ArticleData = { id: string; [key: string]: any };
type SaveResult =
  | { outcome: "new"; article: ArticleData }
  | { outcome: "duplicate" }
  | { outcome: "updated" }
  | { outcome: "error" };

async function saveArticle(params: {
  source_type: string;
  source_url: string;
  tdnet_doc_id?: string;
  edinet_doc_id?: string;
  edinet_submitter_code?: string;
  edinet_doc_type_code?: string;
  title: string;
  title_ja?: string | null;
  publisher?: string | null;
  published_at?: string;
  summary?: string | null;
  is_pdf?: boolean;
  is_paywalled?: boolean;
  is_overseas?: boolean;
  doc_type?: string | null;
  stock: StockRecord;
  relevance: "certain" | "uncertain" | "irrelevant";
  relevance_reason?: string;
}): Promise<SaveResult> {
  // Check for existing article with same doc ID or URL
  const existingInfo = await findExistingArticle(
    params.source_url, params.tdnet_doc_id, params.edinet_doc_id
  );

  if (existingInfo) {
    // Detect updates: title change indicates a correction/update
    const titleChanged = existingInfo.title !== params.title;
    if (titleChanged || existingInfo.is_update_candidate) {
      await supabase.from("article_updates").insert({
        article_id: existingInfo.id,
        previous_title: existingInfo.title,
        new_title: params.title,
        change_type: params.tdnet_doc_id ? "tdnet_correction" : "content_update",
      });
      await supabase.from("articles")
        .update({ is_update: true, updated_at: new Date().toISOString() })
        .eq("id", existingInfo.id);
      return { outcome: "updated" };
    }
    return { outcome: "duplicate" };
  }

  const { data: article, error } = await supabase
    .from("articles")
    .insert({
      source_type: params.source_type,
      source_url: params.source_url,
      tdnet_doc_id: params.tdnet_doc_id,
      edinet_doc_id: params.edinet_doc_id,
      edinet_submitter_code: params.edinet_submitter_code,
      edinet_doc_type_code: params.edinet_doc_type_code,
      title: params.title,
      title_ja: params.title_ja ?? null,
      publisher: params.publisher,
      published_at: params.published_at,
      summary: params.summary,
      is_pdf: params.is_pdf ?? false,
      is_paywalled: params.is_paywalled ?? false,
      is_overseas: params.is_overseas ?? false,
      doc_type: params.doc_type,
      relevance: params.relevance,
      relevance_reason: params.relevance_reason,
    })
    .select("id, source_type, title, title_ja, publisher, published_at, summary, relevance, is_overseas, source_url")
    .single();

  if (error || !article) {
    if (error?.code === "23505") {
      return { outcome: "duplicate" };
    }
    console.error("[fetch-all] 記事保存失敗:", error);
    return { outcome: "error" };
  }

  // Link to stock
  await supabase.from("article_stocks").insert({
    article_id: article.id,
    stock_id: params.stock.id,
  });

  return { outcome: "new", article: { ...article, stock_code: params.stock.code, stock_name: params.stock.name } };
}

async function findExistingArticle(
  url: string,
  tdnetDocId?: string,
  edinetDocId?: string
): Promise<{ id: string; title: string; is_update_candidate: boolean } | null> {
  // Check by TDnet doc ID first (most reliable)
  if (tdnetDocId) {
    const { data } = await supabase
      .from("articles")
      .select("id, title")
      .eq("tdnet_doc_id", tdnetDocId)
      .single();
    if (data) return { ...data, is_update_candidate: false };
  }
  if (edinetDocId) {
    const { data } = await supabase
      .from("articles")
      .select("id, title")
      .eq("edinet_doc_id", edinetDocId)
      .single();
    if (data) return { ...data, is_update_candidate: false };
  }
  // Check by URL (may indicate a content update)
  const { data } = await supabase
    .from("articles")
    .select("id, title")
    .eq("source_url", url)
    .single();
  if (data) return { ...data, is_update_candidate: true };
  return null;
}

async function notifyArticle(
  article: { id: string; [key: string]: any },
  stock: StockRecord
): Promise<void> {
  try {
    const payload = buildPushPayload({
      id: article.id,
      source_type: article.source_type,
      title: article.title,
      title_ja: article.title_ja,
      publisher: article.publisher,
      published_at: article.published_at,
      summary: article.summary,
      relevance: article.relevance,
      is_overseas: article.is_overseas,
      source_url: article.source_url,
      stock_code: stock.code,
      stock_name: stock.name,
    });
    await sendPushToAll(payload, article.id);
  } catch (err) {
    console.error("[fetch-all] 通知失敗:", err);
  }
}

async function processPdf(
  pdfUrl: string,
  docId: string,
  sourceType: string,
  articleId: string
): Promise<void> {
  try {
    const result = await fetchAndStorePdf(pdfUrl, docId, sourceType);
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
  } catch (err) {
    console.error(`[fetch-all] PDF処理失敗 ${docId}:`, err);
  }
}

async function updateHealth(source: string, status: "ok" | "failed" | "checking" | "degraded" | "key_missing"): Promise<void> {
  const now = new Date().toISOString();
  const updateData: Record<string, any> = {
    source,
    status: status === "checking" ? "ok" : status,
    checked_at: now,
  };

  if (status === "ok") {
    updateData.last_success_at = now;
    updateData.consecutive_failures = 0;
    updateData.error_message = null;
  }

  await supabase.from("health_checks").upsert(updateData, { onConflict: "source" });
}

async function handleSourceError(source: string, errMsg: string): Promise<void> {
  const { data: current } = await supabase
    .from("health_checks")
    .select("consecutive_failures")
    .eq("source", source)
    .single();

  const failures = (current?.consecutive_failures ?? 0) + 1;
  const now = new Date().toISOString();

  await supabase.from("health_checks").upsert(
    {
      source,
      status: "failed",
      last_failure_at: now,
      consecutive_failures: failures,
      error_message: errMsg,
      checked_at: now,
    },
    { onConflict: "source" }
  );

  if (failures >= 2) {
    await sendErrorEmail(
      `${source} 取得障害 (${failures}回連続失敗)`,
      `${source} からの情報取得が ${failures} 回連続で失敗しました。\n\nエラー: ${errMsg}\n\n時刻: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`
    );
  }
}

async function logExclusion(
  url: string,
  title: string | null,
  sourceType: string,
  stockCode: string,
  reason: string
): Promise<void> {
  await supabase.from("exclusion_logs").insert({
    source_url: url,
    title,
    source_type: sourceType,
    related_stock_code: stockCode,
    exclusion_reason: reason,
  });
}

function groupByCode<T extends { code: string }>(items: T[]): Record<string, T[]> {
  return items.reduce((acc, item) => {
    if (!acc[item.code]) acc[item.code] = [];
    acc[item.code].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

function deduplicateByDocId<T extends { docId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    if (seen.has(i.docId)) return false;
    seen.add(i.docId);
    return true;
  });
}

function findStockBySecCode(stocks: StockRecord[], secCode: string): StockRecord | null {
  return (
    stocks.find((s) => {
      const expected = s.sec_code ?? s.code.padEnd(5, "0");
      return expected === secCode;
    }) ?? null
  );
}

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(2000 * (i + 1));
    }
  }
  throw new Error("Max retries exceeded");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[fetch-all] FATAL:", err);
    process.exit(1);
  });

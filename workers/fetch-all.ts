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
  fetchTdnetByCodeYanoshin,
  fetchTdnetByCodeDirect,
  type TdnetItem,
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
import { isGoogleNewsUrl, resolveGoogleNewsUrl, getResolveStats } from "../lib/fetchers/google-news-decoder.js";
import { crawlIrPage } from "../lib/fetchers/ir-page.js";
import { canonicalizeUrl } from "../lib/utils.js";
import { classifyEventType, type EventType } from "../lib/classifiers/event-type.js";
import { classifyImportance } from "../lib/classifiers/importance.js";
import { findOrCreateEventGroup, tryMarkEventNotified } from "../lib/classifiers/event-grouping.js";
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
import { GLOBAL_PROTECT_KEYWORDS, isSafeSource, matchesProtection, uniqueProtectCount } from "../lib/noise/protection.js";

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
  notify_event_types: string[] | null;
  force_ai_relevance_check: boolean;
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
      stock_profiles (rss_urls, jp_keywords, en_keywords, official_url, ir_url, press_release_url, notify_event_types, force_ai_relevance_check)
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

  // ============================
  // Load exclusion/noise rules
  // ============================

  // 安全ソース判定・保護キーワードは lib/noise/protection.ts に集約

  function extractDomain(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
  }

  // Phase 3.2 noise_rules (comprehensive) — 唯一のルールソース。
  // stock_keyword_rules (Phase 3.1) は書き込みが一本化され廃止済みのため参照しない。
  type NoiseRule = {
    id: string;
    stock_id: string | null;
    scope: string;
    rule_type: string;
    match_type: string;
    match_value: string;
    is_active: boolean;
  };
  let noiseRules: NoiseRule[] = [];
  try {
    const { data: nrData } = await supabase
      .from("noise_rules")
      .select("id, stock_id, scope, rule_type, match_type, match_value, is_active")
      .eq("is_active", true);
    if (nrData) noiseRules = nrData;
  } catch { /* Table may not exist yet */ }

  // DB の strengthen ルール (= 保護キーワード) を抽出
  const dbProtectKeywords = noiseRules
    .filter((r) => r.rule_type === "strengthen" && r.match_type === "keyword")
    .map((r) => r.match_value);

  if (noiseRules.length > 0) {
    const uniqueKw = uniqueProtectCount(dbProtectKeywords);
    console.log(
      `[fetch-all] ノイズルール: noise_rules=${noiseRules.length} 件ロード ` +
      `(保護KW: コード${GLOBAL_PROTECT_KEYWORDS.length} + DB${dbProtectKeywords.length} → unique${uniqueKw})`
    );
  }

  function applyExclusionRules(
    sourceType: string,
    title: string,
    summary: string | null | undefined,
    url: string,
    publisher: string | null | undefined,
    stockId: string
  ): { exclusion_candidate: boolean; exclusion_reason: string | null } {
    // 1. 安全ソース (TDnet/EDINET/公式) は絶対に除外しない
    if (isSafeSource(sourceType)) {
      return { exclusion_candidate: false, exclusion_reason: null };
    }

    // 2. 保護キーワードがあれば、ノイズ一致しても除外しない
    const protectedBy = matchesProtection(title, summary, dbProtectKeywords);
    if (protectedBy) {
      return { exclusion_candidate: false, exclusion_reason: null };
    }

    const text = (title + " " + (summary ?? "")).toLowerCase();
    const domain = extractDomain(url);

    // 3. Phase 3.2 noise_rules を先にチェック (strengthen は除外ルールではないのでスキップ)
    const stockNoiseRules = noiseRules.filter(
      (r) => r.scope === "all_stocks" || r.stock_id === stockId
    );
    for (const rule of stockNoiseRules) {
      if (rule.rule_type === "strengthen") continue;
      let matched = false;
      switch (rule.match_type) {
        case "keyword":    matched = text.includes(rule.match_value.toLowerCase()); break;
        case "domain":     matched = domain.includes(rule.match_value.toLowerCase()); break;
        case "url_pattern":matched = url.toLowerCase().includes(rule.match_value.toLowerCase()); break;
        case "publisher":  matched = (publisher ?? "").toLowerCase().includes(rule.match_value.toLowerCase()); break;
      }
      if (matched) {
        return {
          exclusion_candidate: true,
          exclusion_reason: `ノイズルール一致: ${rule.match_type}="${rule.match_value}"`,
        };
      }
    }

    return { exclusion_candidate: false, exclusion_reason: null };
  }

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

  // TDnet 取得元の診断情報 (status画面で「外部障害 vs 新着0件」を区別するため)
  const tdnetDiag: {
    source_used: "tier1_yanoshin" | "tier2_yahoo" | "mixed" | "failed";
    tier1_ok: boolean;
    tier1_stocks: number;
    tier2_stocks: number;
    failed_stocks: string[];
  } = { source_used: "tier1_yanoshin", tier1_ok: false, tier1_stocks: 0, tier2_stocks: 0, failed_stocks: [] };

  // Shorthands for backward-compat
  const src = results.per_source;

  // ============================
  // 1. TDnet
  // ============================
  // 1. TDnet  (銘柄別フォールバック)
  //
  //   注: yanoshin recent.rss は docId しか持たず銘柄コードが無いため
  //       28銘柄への紐付けに使えない。銘柄別取得が唯一確実な方法。
  //
  //   Tier 1: yanoshin {code}.rss  — 銘柄別 (throws on error, 1回リトライ)
  //   Tier 2: Yahoo Finance Japan  — Tier1失敗時の銘柄別フォールバック (returns [] on error)
  //
  //   各銘柄の取得結果を tier1/tier2/none で記録し、
  //   「外部障害(全ソース失敗)」と「新着0件(正常)」を区別する。
  // ============================
  console.log("[fetch-all] TDnet 取得開始");
  await updateHealth("tdnet", "checking");

  const tdnetStockResults: Record<string, "tier1" | "tier2" | "none"> = {};
  const tdnetFailedStocks: string[] = [];
  let tier1OkCount = 0;

  for (const stock of normalizedStocks) {
    let stockItems: TdnetItem[] = [];
    let tier1Ok = false;
    let tier2Ok = false;

    // --- Tier 1: yanoshin per-stock RSS (1回リトライ) ---
    try {
      stockItems = await withRetry(() => fetchTdnetByCodeYanoshin(stock.code, since), 2);
      tier1Ok = true;
      tier1OkCount++;
    } catch (err) {
      // --- Tier 2: Yahoo Finance Japan ---
      // 取得成功(0件含む) → tier2Ok=true / HTTPエラー → throw を catch して失敗扱い
      console.log(`[TDnet] Tier1 やのしん ${stock.code} 失敗: ${(err as Error).message} → Tier2 Yahoo`);
      try {
        stockItems = await fetchTdnetByCodeDirect(stock.code, since);
        tier2Ok = true;
      } catch (err2) {
        console.log(`[TDnet] Tier2 Yahoo ${stock.code} も失敗: ${(err2 as Error).message}`);
      }
    }

    if (tier1Ok) {
      tdnetStockResults[stock.code] = "tier1";
    } else if (tier2Ok) {
      // Yahoo 取得成功 (0件でも「新着なし」として正常扱い)
      tdnetStockResults[stock.code] = "tier2";
      if (stockItems.length > 0) console.log(`[TDnet] Tier2 Yahoo ${stock.code}: ${stockItems.length}件`);
    } else {
      // やのしん・Yahoo 両方が HTTPエラー → 真の取得失敗
      tdnetStockResults[stock.code] = "none";
      tdnetFailedStocks.push(stock.code);
    }

    for (const item of stockItems) {
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
        // 訂正等で内容が変わった場合、新しいPDFスナップショットも保存する
        // (過去版は残したまま、articles.pdf_document_id だけ最新版に差し替わる)
        if (item.pdfUrl) await processPdf(item.pdfUrl, item.docId, "tdnet", r.article_id);
      } else {
        src.tdnet.errors++;
      }
    }
    await sleep(250);
  }

  // --- Summary and health ---
  const tier2Stocks = Object.values(tdnetStockResults).filter((v) => v === "tier2").length;
  console.log(
    `[TDnet] candidates=${src.tdnet.candidates} saved=${src.tdnet.saved} skipped=${src.tdnet.skipped} ` +
    `(Tier1=${tier1OkCount} Tier2=${tier2Stocks} 失敗=${tdnetFailedStocks.length})`
  );
  if (tdnetFailedStocks.length > 0) {
    console.log(`[TDnet] 全ソース失敗銘柄: ${tdnetFailedStocks.join(", ")}`);
  }

  // 診断情報を記録 (status画面で「外部障害 vs 新着0件」を区別)
  tdnetDiag.tier1_ok = tier1OkCount > 0;
  tdnetDiag.tier1_stocks = tier1OkCount;
  tdnetDiag.tier2_stocks = tier2Stocks;
  tdnetDiag.failed_stocks = tdnetFailedStocks;
  tdnetDiag.source_used =
    tier1OkCount > 0 && tier2Stocks > 0 ? "mixed"
    : tier1OkCount > 0 ? "tier1_yanoshin"
    : tier2Stocks > 0 ? "tier2_yahoo"
    : "failed";

  // 健全性判定: 半数超の銘柄で全ソース失敗 = 外部障害
  const failRatio = tdnetFailedStocks.length / normalizedStocks.length;
  if (failRatio > 0.5) {
    results.errors.push(`TDnet: ${tdnetFailedStocks.length}/${normalizedStocks.length}銘柄で全取得元失敗`);
    await handleSourceError("tdnet", `${tdnetFailedStocks.length}/${normalizedStocks.length}銘柄で全ソース(やのしん/Yahoo)失敗`);
  } else if (failRatio > 0) {
    await updateHealth("tdnet", "degraded");
  } else {
    await updateHealth("tdnet", "ok");
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
        } else if (r.outcome === "updated")   {
          src.edinet.updated++;
          if (item.pdfUrl) await processPdf(item.pdfUrl, item.docId, "edinet", r.article_id);
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
        const existing = await findExistingArticle(item.url);
        if (existing) { src.jp_news.skipped++; continue; }

        const match = quickKeywordMatch(
          item.title + (item.summary ?? ""),
          stock.name,
          stock.code,
          profile?.jp_keywords ?? []
        );
        // 球団名=社名等の銘柄(ソフトバンク/オリックス等)は、銘柄名の完全一致だけで
        // certain扱いにするとAIの「同名の別会社/無関係」判定をスキップしてしまうため、
        // 常にAIで判定させる
        const forceAi = profile?.force_ai_relevance_check === true;

        let relevance: "certain" | "uncertain" | "irrelevant" = match ? "certain" : "uncertain";
        let relevanceReason = "";

        if (!match || forceAi) {
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

        // Google Newsのリダイレクトリンクは配信元ドメインが分からずノイズ/有料判定が
        // 効かないため、保存が確定した記事だけ実URLへ解決する(全候補で行うと遅すぎる)。
        let resolvedUrl = item.url;
        let discoveredUrl: string | undefined;
        if (isGoogleNewsUrl(item.url)) {
          const real = await resolveGoogleNewsUrl(item.url);
          if (real) { resolvedUrl = real; discoveredUrl = item.url; }
        }

        // Check user-defined exclusion rules (applied after relevance; certain/uncertain articles)
        const excl = applyExclusionRules(item.sourceType, item.title, item.summary, resolvedUrl, item.publisher, stock.id);

        const r = await saveArticle({
          source_type: item.sourceType,
          source_url: resolvedUrl,
          discovered_url: discoveredUrl,
          title: item.title,
          publisher: item.publisher,
          published_at: item.publishedAt.toISOString(),
          summary: item.summary,
          is_paywalled: detectPaywall(resolvedUrl),
          stock,
          relevance,
          relevance_reason: relevanceReason,
          exclusion_candidate: excl.exclusion_candidate || undefined,
          exclusion_reason: excl.exclusion_reason,
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
        const forceAi = profile?.force_ai_relevance_check === true;

        let relevance: "certain" | "uncertain" | "irrelevant" = match ? "certain" : "uncertain";
        let relevanceReason = "";
        let titleJa: string | null = null;

        if (!match || forceAi) {
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

        let resolvedUrl = item.url;
        let discoveredUrl: string | undefined;
        if (isGoogleNewsUrl(item.url)) {
          const real = await resolveGoogleNewsUrl(item.url);
          if (real) { resolvedUrl = real; discoveredUrl = item.url; }
        }

        const enExcl = applyExclusionRules("en_news", item.title, item.summary, resolvedUrl, item.publisher, stock.id);

        const r = await saveArticle({
          source_type: "en_news",
          source_url: resolvedUrl,
          discovered_url: discoveredUrl,
          title: item.title,
          title_ja: titleJa,
          publisher: item.publisher,
          published_at: item.publishedAt.toISOString(),
          summary: item.summary,
          is_overseas: true,
          is_paywalled: detectPaywall(resolvedUrl),
          stock,
          relevance,
          relevance_reason: relevanceReason,
          exclusion_candidate: enExcl.exclusion_candidate || undefined,
          exclusion_reason: enExcl.exclusion_reason,
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
  // 5. 企業IRページ直接監視 (RSS未提供企業向け、パイロット運用)
  // ============================
  //   stock_ir_sources.enabled=true の銘柄のみ対象(現状は少数銘柄でのパイロット運用)。
  //   前回巡回のknown_urlsとの差分だけを新着候補とする。初回巡回はベースライン記録のみ
  //   行い、既存の全過去記事を新着として誤検知しないようにする。
  console.log("[fetch-all] IRページ直接監視 開始");
  await updateHealth("ir_page", "checking");
  try {
    const { data: irSourceRows } = await supabase
      .from("stock_ir_sources")
      .select("id, stock_id, url, known_urls")
      .eq("enabled", true);

    for (const irSource of irSourceRows ?? []) {
      const stock = normalizedStocks.find((s) => s.id === irSource.stock_id);
      if (!stock) continue;
      const profile = stock.stock_profiles;

      try {
        const { items, allUrls } = await crawlIrPage(irSource.url);
        const knownUrls: string[] = irSource.known_urls ?? [];
        const isFirstCrawl = knownUrls.length === 0;
        const knownSet = new Set(knownUrls);
        const newItems = isFirstCrawl ? [] : items.filter((it) => !knownSet.has(it.url));

        for (const item of newItems) {
          src.official.candidates++;
          const existing = await findExistingArticle(item.url);
          if (existing) { src.official.skipped++; continue; }

          const match = quickKeywordMatch(item.title, stock.name, stock.code, profile?.jp_keywords ?? []);
          let relevance: "certain" | "uncertain" | "irrelevant" = match ? "certain" : "uncertain";
          let relevanceReason = "";
          if (!match) {
            const check = await checkRelevance(item.title, null, stock.code, stock.name, profile?.jp_keywords ?? []);
            relevance = check.result;
            relevanceReason = check.reason;
          }
          if (relevance === "irrelevant") {
            await logExclusion(item.url, item.title, "official", stock.code, relevanceReason);
            continue;
          }

          const r = await saveArticle({
            source_type: "official",
            source_url: item.url,
            title: item.title,
            publisher: stock.name,
            published_at: new Date().toISOString(),
            summary: null,
            stock,
            relevance,
            relevance_reason: relevanceReason,
          });

          if (r.outcome === "new") { src.official.saved++; await notifyArticle(r.article, stock);
          } else if (r.outcome === "duplicate") { src.official.skipped++;
          } else if (r.outcome === "updated")   { src.official.updated++;
          } else                                { src.official.errors++; }
        }

        // known_urlsを更新(直近500件に制限し無制限増加を防ぐ)
        const mergedUrls = [...new Set([...knownUrls, ...allUrls])].slice(-500);
        await supabase.from("stock_ir_sources").update({
          known_urls: mergedUrls,
          last_checked_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          consecutive_failures: 0,
          last_error: null,
        }).eq("id", irSource.id);

        if (isFirstCrawl) {
          console.log(`[IRページ] ${stock.code} 初回巡回: ベースライン${allUrls.length}件を記録(新着通知なし)`);
        }
      } catch (err) {
        const errMsg = String(err instanceof Error ? err.message : err);
        console.error(`[IRページ] ${stock.code} 取得失敗 ${irSource.url}:`, errMsg);
        const { data: current } = await supabase
          .from("stock_ir_sources")
          .select("consecutive_failures")
          .eq("id", irSource.id)
          .single();
        await supabase.from("stock_ir_sources").update({
          last_checked_at: new Date().toISOString(),
          consecutive_failures: (current?.consecutive_failures ?? 0) + 1,
          last_error: errMsg,
        }).eq("id", irSource.id);
      }
      await sleep(500);
    }
    await updateHealth("ir_page", "ok");
  } catch (err) {
    results.errors.push(`IRページ: ${err}`);
    await handleSourceError("ir_page", String(err));
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
          tdnet_diag: tdnetDiag,
        },
      })
      .eq("id", jobId);
  }

  await supabase
    .from("system_settings")
    .upsert({ key: "last_hourly_run", value: `"${new Date().toISOString()}"`, updated_at: new Date().toISOString() });

  // Google News実URL解決の状態を記録(非公式APIに依存し壊れやすいため、
  // 状態画面で「解決率が落ちていないか」を追えるようにする)
  const resolveStats = getResolveStats();
  if (resolveStats.attempts > 0) {
    const failureRate = resolveStats.failures / resolveStats.attempts;
    const status = failureRate === 0 ? "ok" : failureRate < 0.5 ? "degraded" : "failed";
    const now = new Date().toISOString();
    await supabase.from("health_checks").upsert(
      {
        source: "google_news_url_resolve",
        status,
        checked_at: now,
        ...(status === "ok"
          ? { last_success_at: now, consecutive_failures: 0, error_message: null }
          : { last_failure_at: now, error_message: `${resolveStats.failures}/${resolveStats.attempts}件が解決失敗` }),
      },
      { onConflict: "source" }
    );
  }
}

// ============================
// Helper functions
// ============================

type ArticleData = { id: string; [key: string]: any };
type SaveResult =
  | { outcome: "new"; article: ArticleData }
  | { outcome: "duplicate" }
  | { outcome: "updated"; article_id: string }
  | { outcome: "error" };

async function saveArticle(params: {
  source_type: string;
  source_url: string;
  discovered_url?: string;
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
  exclusion_candidate?: boolean;
  exclusion_reason?: string | null;
}): Promise<SaveResult> {
  const canonicalUrl = canonicalizeUrl(params.source_url);

  // Check for existing article with same doc ID / canonical URL / URL
  const existingInfo = await findExistingArticle(
    params.source_url, params.tdnet_doc_id, params.edinet_doc_id, canonicalUrl
  );

  if (existingInfo) {
    // タイトルが実際に変わった場合のみ「更新」として記録する。
    // (以前は同一URLの再取得ならタイトルが同じでも一律「更新」扱いにしており、
    //  news/RSSの毎時再取得のたびにpreviouson_title=new_titleの空の更新履歴が
    //  大量に作られていた)
    const titleChanged = existingInfo.title !== params.title;
    if (titleChanged) {
      await supabase.from("article_updates").insert({
        article_id: existingInfo.id,
        previous_title: existingInfo.title,
        new_title: params.title,
        change_type: params.tdnet_doc_id ? "tdnet_correction" : "content_update",
      });
      await supabase.from("articles")
        .update({ is_update: true, updated_at: new Date().toISOString() })
        .eq("id", existingInfo.id);
      return { outcome: "updated", article_id: existingInfo.id };
    }
    return { outcome: "duplicate" };
  }

  // Build insert payload; new columns are included only if available (graceful degradation)
  const insertPayload: Record<string, unknown> = {
    source_type: params.source_type,
    source_url: params.source_url,
    discovered_url: params.discovered_url,
    canonical_url: canonicalUrl,
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
  };
  if (params.exclusion_candidate !== undefined) {
    insertPayload.exclusion_candidate = params.exclusion_candidate;
  }
  if (params.exclusion_reason !== undefined) {
    insertPayload.exclusion_reason = params.exclusion_reason;
  }
  // 重要開示フラグ: 安全ソース(TDnet/EDINET/公式) または 決算・M&A・行政処分等の
  // 重要開示キーワード一致。投資判断ではなく開示カテゴリの客観分類。
  insertPayload.is_important =
    isSafeSource(params.source_type) ||
    matchesProtection(params.title, params.summary) !== null;

  // 開示種別の機械的分類(要約・投資判断ではなく情報整理)
  insertPayload.event_type = classifyEventType({
    title: params.title,
    summary: params.summary,
    tdnetDocType: params.doc_type,
    edinetDocTypeCode: params.edinet_doc_type_code,
  });

  // 重要度3段階分類(投資判断ではなく開示カテゴリ・規模の客観分類)
  const importanceResult = await classifyImportance({
    title: params.title,
    summary: params.summary,
    edinetDocTypeCode: params.edinet_doc_type_code,
    isSafeSource: isSafeSource(params.source_type),
  });
  insertPayload.importance = importanceResult.tier;
  insertPayload.importance_reason = importanceResult.reason;
  insertPayload.importance_source = importanceResult.source;

  const { data: article, error } = await supabase
    .from("articles")
    .insert(insertPayload)
    .select("id, source_type, title, title_ja, publisher, published_at, summary, relevance, is_overseas, source_url, exclusion_candidate, event_type")
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

  // 同一事象の記事統合: この記事が属する出来事を判定・作成する
  let eventGroupId: string | null = null;
  let isEventRepresentative = true;
  try {
    const grouping = await findOrCreateEventGroup(supabase, {
      stockId: params.stock.id,
      eventType: insertPayload.event_type as string,
      title: params.title,
      summary: params.summary,
      publishedAt: params.published_at,
      articleId: article.id,
      sourceType: params.source_type,
    });
    eventGroupId = grouping.eventGroupId;
    isEventRepresentative = grouping.isRepresentative;
    await supabase
      .from("articles")
      .update({ event_group_id: eventGroupId, is_event_representative: isEventRepresentative })
      .eq("id", article.id);
    if (grouping.demotedArticleId) {
      await supabase
        .from("articles")
        .update({ is_event_representative: false })
        .eq("id", grouping.demotedArticleId);
    }
  } catch (err) {
    console.error(`[fetch-all] 出来事グルーピング失敗 (記事は保存済み) ${article.id}:`, err);
  }

  return {
    outcome: "new",
    article: {
      ...article,
      stock_code: params.stock.code,
      stock_name: params.stock.name,
      event_group_id: eventGroupId,
      is_event_representative: isEventRepresentative,
    },
  };
}

async function findExistingArticle(
  url: string,
  tdnetDocId?: string,
  edinetDocId?: string,
  canonicalUrl?: string
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
  // Google Newsが同じ記事に別トークンのリンクを発行するケースに対応
  // (canonical_url は正規化済みのため source_url の表記ゆれよりも確実に一致する)
  if (canonicalUrl) {
    const { data } = await supabase
      .from("articles")
      .select("id, title")
      .eq("canonical_url", canonicalUrl)
      .single();
    if (data) return { ...data, is_update_candidate: true };
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
  // 通知スキップ: 無関係確定 or 除外候補
  if (
    article.relevance === "irrelevant" ||
    article.user_relevance === "irrelevant" ||
    article.exclusion_candidate === true
  ) {
    console.log(`[fetch-all] 通知スキップ (除外): ${article.id} title="${article.title?.slice(0, 40)}"`);
    return;
  }

  // 銘柄別の通知種別設定 (未設定 = 全種別を通知、現状の挙動を維持)
  const notifyTypes = stock.stock_profiles?.notify_event_types;
  if (notifyTypes && notifyTypes.length > 0 && !notifyTypes.includes(article.event_type)) {
    console.log(`[fetch-all] 通知スキップ (種別設定): ${article.id} event_type=${article.event_type}`);
    return;
  }

  // 通知は同じ出来事につき原則1回。既に通知済みの出来事ならスキップする。
  if (article.event_group_id) {
    const firstNotification = await tryMarkEventNotified(supabase, article.event_group_id);
    if (!firstNotification) {
      console.log(`[fetch-all] 通知スキップ (同一出来事の通知済み): ${article.id} event_group_id=${article.event_group_id}`);
      return;
    }
  }

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

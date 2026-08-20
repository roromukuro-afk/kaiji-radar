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
import { fetchSecEdgarFilings, formLabel as secFormLabel } from "../lib/fetchers/sec-edgar.js";
import {
  fetchGoogleNewsJP,
  fetchGoogleNewsEN,
  fetchPRTimes,
  fetchGenericRss,
  detectPaywall,
} from "../lib/fetchers/news.js";
import { isGoogleNewsUrl, resolveGoogleNewsUrl, getResolveStats } from "../lib/fetchers/google-news-decoder.js";
import { crawlIrPage } from "../lib/fetchers/ir-page.js";
import { computeRecoveryWindow } from "../lib/fetchers/recovery.js";
import { isAutoLinkCandidate } from "../lib/calendar/status.js";
import { canonicalizeUrl } from "../lib/utils.js";
import { classifyEventType, type EventType } from "../lib/classifiers/event-type.js";
import { classifyImportance } from "../lib/classifiers/importance.js";
import { findOrCreateEventGroup, tryMarkEventNotified } from "../lib/classifiers/event-grouping.js";
import { resolveNotificationRule, type NotificationRule } from "../lib/notifications/rules.js";
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
  cik: string | null;
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

  // 全情報源の自動取りこぼし回収(新規実装6): 上のlookbackHoursは全ソース共通の
  // 1つの値でしかなく、特定のソースだけが連続失敗した取りこぼしを検知できない。
  // source_checkpoints(ソースごとの最終成功時刻)から、ソースごとに独立した
  // 遡及幅を計算する(通常時はlookbackHours/sinceと同じ挙動になる)。
  const SOURCE_RECOVERY_CAP_HOURS: Record<string, number> = {
    tdnet: 48,
    edinet: 168, // EDINETは日付単位の取得のため、他より広めの上限にする
    sec_edgar: 168, // SEC EDGARも同様に広めの上限
    jp_news: 48,
    en_news: 48,
    pr_times: 48,
    official: 72,
  };
  const { data: checkpointRows } = await supabase
    .from("source_checkpoints")
    .select("source_type, last_success_at");
  const sourceCheckpoints = new Map(
    (checkpointRows ?? []).map((r) => [r.source_type as string, r.last_success_at as string | null])
  );
  function sourceWindow(sourceType: string) {
    return computeRecoveryWindow(
      sourceCheckpoints.get(sourceType) ?? null,
      LOOKBACK_HOURS_NORMAL,
      SOURCE_RECOVERY_CAP_HOURS[sourceType] ?? LOOKBACK_HOURS_NORMAL
    );
  }
  const tdnetWindow = sourceWindow("tdnet");
  const edinetWindow = sourceWindow("edinet");
  const secEdgarWindow = sourceWindow("sec_edgar");
  const jpNewsWindow = sourceWindow("jp_news");
  const enNewsWindow = sourceWindow("en_news");
  const prTimesWindow = sourceWindow("pr_times");
  const officialWindow = sourceWindow("official");
  const recoverySpans = {
    tdnet: { lookback_hours: tdnetWindow.lookbackHours, is_recovery: tdnetWindow.isRecovery },
    edinet: { lookback_hours: edinetWindow.lookbackHours, is_recovery: edinetWindow.isRecovery },
    sec_edgar: { lookback_hours: secEdgarWindow.lookbackHours, is_recovery: secEdgarWindow.isRecovery },
    jp_news: { lookback_hours: jpNewsWindow.lookbackHours, is_recovery: jpNewsWindow.isRecovery },
    en_news: { lookback_hours: enNewsWindow.lookbackHours, is_recovery: enNewsWindow.isRecovery },
    pr_times: { lookback_hours: prTimesWindow.lookbackHours, is_recovery: prTimesWindow.isRecovery },
    official: { lookback_hours: officialWindow.lookbackHours, is_recovery: officialWindow.isRecovery },
  };
  async function markSourceCheckpoint(sourceType: string): Promise<void> {
    await supabase.from("source_checkpoints").upsert(
      { source_type: sourceType, last_success_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "source_type" }
    );
  }
  const recoveringSources = Object.entries(recoverySpans).filter(([, v]) => v.is_recovery).map(([k]) => k);
  if (recoveringSources.length > 0) {
    console.log(`[fetch-all] 復旧モード対象ソース: ${recoveringSources.map((k) => `${k}(${recoverySpans[k as keyof typeof recoverySpans].lookback_hours}h)`).join(", ")}`);
  }

  // Load active stocks
  const { data: stocks, error: stocksErr } = await supabase
    .from("stocks")
    .select(`
      id, code, name, name_en, edinet_code, sec_code, cik,
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

  // 詳細な通知ルール(新規実装3): 一致するルールが無い銘柄・記事は
  // 既存のnotify_event_types設定にフォールバックする(後方互換)。
  let notificationRules: NotificationRule[] = [];
  try {
    const { data: nrData } = await supabase
      .from("notification_rules")
      .select("id, stock_id, importance, event_type, source_type, keyword, action, priority")
      .eq("is_active", true);
    if (nrData) notificationRules = nrData;
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
      tdnet:     mkSrc(),
      edinet:    mkSrc(),
      sec_edgar: mkSrc(),
      official:  mkSrc(),
      jp_news:   mkSrc(),
      en_news:   mkSrc(),
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
      stockItems = await withRetry(() => fetchTdnetByCodeYanoshin(stock.code, tdnetWindow.since), 2);
      tier1Ok = true;
      tier1OkCount++;
    } catch (err) {
      // --- Tier 2: Yahoo Finance Japan ---
      // 取得成功(0件含む) → tier2Ok=true / HTTPエラー → throw を catch して失敗扱い
      console.log(`[TDnet] Tier1 やのしん ${stock.code} 失敗: ${(err as Error).message} → Tier2 Yahoo`);
      try {
        stockItems = await fetchTdnetByCodeDirect(stock.code, tdnetWindow.since);
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
        await notifyArticle(r.article, stock, notificationRules);
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
    await markSourceCheckpoint("tdnet");
  } else {
    await updateHealth("tdnet", "ok");
    await markSourceCheckpoint("tdnet");
  }

  // 銘柄別カバレッジ: TDnetは銘柄ごとにtier1/tier2/noneの結果が既にわかっている
  for (const stock of normalizedStocks) {
    const result = tdnetStockResults[stock.code];
    await recordCoverage([stock.id], "tdnet", result !== "none", result === "none" ? "やのしん/Yahoo両方失敗" : null);
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
  let edinetErr: string | null = null;
  try {
    const secCodes = normalizedStocks.map((s) => s.sec_code ?? stockCodeToSecCode(s.code));
    const today = new Date();
    // 全情報源の自動取りこぼし回収(新規実装6): 従来は「前日+当日」固定だったため、
    // EDINET側だけが2日を超える障害から取りこぼしを回収できなかった。
    // edinetWindow.sinceから当日まで、日単位で巡回する。
    const datesToCheck: Date[] = [];
    for (let d = new Date(edinetWindow.since); d <= today; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
      datesToCheck.push(d);
    }
    if (datesToCheck.length === 0 || datesToCheck[datesToCheck.length - 1].toDateString() !== today.toDateString()) {
      datesToCheck.push(today);
    }

    for (const date of datesToCheck) {
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
          await notifyArticle(r.article, stock, notificationRules);
        } else if (r.outcome === "duplicate") { src.edinet.skipped++;
        } else if (r.outcome === "updated")   {
          src.edinet.updated++;
          if (item.pdfUrl) await processPdf(item.pdfUrl, item.docId, "edinet", r.article_id);
        } else                                { src.edinet.errors++; }
      }
      await sleep(1000);
    }
    await updateHealth("edinet", "ok");
    await markSourceCheckpoint("edinet");
  } catch (err) {
    edinetErr = String(err);
    results.errors.push(`EDINET: ${err}`);
    await handleSourceError("edinet", String(err));
  }
  await recordCoverage(normalizedStocks.map((s) => s.id), "edinet", edinetErr === null, edinetErr);
  } // end EDINET key check

  // ============================
  // 2.5 SEC EDGAR (米国株の一次情報。TDnet/EDINETの米国版)
  // ============================
  //   cikが設定されている銘柄(米国上場企業)のみ対象。銘柄単位のAPIのため
  //   1社ずつ取得し、個別の失敗が他銘柄に波及しないようにする。
  console.log("[fetch-all] SEC EDGAR 取得開始");
  await updateHealth("sec_edgar", "checking");

  const secEdgarStocks = normalizedStocks.filter((s) => s.cik);
  const secEdgarConfiguredMap: Record<string, boolean> = {};
  for (const stock of normalizedStocks) secEdgarConfiguredMap[stock.id] = !!stock.cik;

  let secEdgarErr: string | null = null;
  if (secEdgarStocks.length > 0) {
    try {
      for (const stock of secEdgarStocks) {
        try {
          const items = await fetchSecEdgarFilings(stock.cik!, secEdgarWindow.since);

          for (const item of items) {
            src.sec_edgar.candidates++;
            const r = await saveArticle({
              source_type: "sec_edgar",
              source_url: item.url,
              title: `${secFormLabel(item.form)}: ${item.primaryDocDescription || item.form}`,
              publisher: stock.name_en ?? stock.name,
              published_at: item.filingDate.toISOString(),
              summary: item.items ? `Items: ${item.items}` : null,
              doc_type: item.form,
              stock,
              relevance: "certain",
            });

            if (r.outcome === "new") {
              src.sec_edgar.saved++;
              await notifyArticle(r.article, stock, notificationRules);
            } else if (r.outcome === "duplicate") { src.sec_edgar.skipped++;
            } else if (r.outcome === "updated")   { src.sec_edgar.updated++;
            } else                                { src.sec_edgar.errors++; }
          }
          await recordCoverage([stock.id], "sec_edgar", true, null, secEdgarConfiguredMap);
        } catch (err) {
          console.error(`[SEC EDGAR] ${stock.code} (CIK ${stock.cik}) 取得失敗:`, err);
          await recordCoverage([stock.id], "sec_edgar", false, String(err), secEdgarConfiguredMap);
        }
        // SECのフェアユースポリシー(10リクエスト/秒目安)に配慮し間隔を空ける
        await sleep(300);
      }
      await updateHealth("sec_edgar", "ok");
      await markSourceCheckpoint("sec_edgar");
    } catch (err) {
      secEdgarErr = String(err);
      results.errors.push(`SEC EDGAR: ${err}`);
      await handleSourceError("sec_edgar", String(err));
    }
  } else {
    await updateHealth("sec_edgar", "ok");
  }
  // cikを持たない銘柄(=日本株)もカバレッジ上は「対象外」として記録しておく
  await recordCoverage(
    normalizedStocks.filter((s) => !s.cik).map((s) => s.id),
    "sec_edgar",
    secEdgarErr === null,
    secEdgarErr,
    secEdgarConfiguredMap
  );

  // ============================
  // 3. 国内ニュース
  // ============================
  console.log("[fetch-all] 国内ニュース取得開始");
  await updateHealth("jp_news", "checking");
  let jpNewsErr: string | null = null;
  try {
    for (const stock of normalizedStocks) {
      const profile = stock.stock_profiles;
      const keywords = [
        stock.name,
        stock.code,
        ...(profile?.jp_keywords ?? []),
      ].filter(Boolean);

      const newsItems = await fetchGoogleNewsJP(keywords.slice(0, 5), jpNewsWindow.since);
      const prItems = await fetchPRTimes(stock.name, prTimesWindow.since);

      // Custom RSS feeds (企業公式、IR等)
      const customItems = [];
      for (const rssUrl of profile?.rss_urls ?? []) {
        const items = await fetchGenericRss(rssUrl, "official", officialWindow.since);
        customItems.push(...items);
      }

      for (const item of [...newsItems, ...prItems, ...customItems]) {
        src.jp_news.candidates++;
        const existing = await findExistingArticle(item.url);
        if (existing) { src.jp_news.skipped++; continue; }

        const km = quickKeywordMatch(
          item.title + (item.summary ?? ""),
          stock.name,
          stock.code,
          profile?.jp_keywords ?? []
        );
        // 球団名=社名等の銘柄(ソフトバンク/オリックス等)は、銘柄名の完全一致だけで
        // certain扱いにするとAIの「同名の別会社/無関係」判定をスキップしてしまうため、
        // 常にAIで判定させる
        const forceAi = profile?.force_ai_relevance_check === true;

        // 社名/銘柄コードそのものの一致だけをAI省略可の強い根拠とする。
        // jp_keywordsのみでの一致は(業界共通語を含みうるため)必ずAIで確認する。
        let relevance: "certain" | "uncertain" | "irrelevant" = km.matchedNameOrCode ? "certain" : "uncertain";
        let relevanceReason = "";

        if (!km.matchedNameOrCode || forceAi) {
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

        if (r.outcome === "new") { src.jp_news.saved++; await notifyArticle(r.article, stock, notificationRules);
        } else if (r.outcome === "duplicate") { src.jp_news.skipped++;
        } else if (r.outcome === "updated")   { src.jp_news.updated++;
        } else                                { src.jp_news.errors++; }
      }
      await sleep(500);
    }
    await updateHealth("jp_news", "ok");
    await Promise.all([markSourceCheckpoint("jp_news"), markSourceCheckpoint("pr_times"), markSourceCheckpoint("official")]);
  } catch (err) {
    jpNewsErr = String(err);
    results.errors.push(`JP news: ${err}`);
    await handleSourceError("jp_news", String(err));
  }

  // 銘柄別カバレッジ: jp_news/pr_timesは常に「設定済み」として全銘柄一律で試行される。
  // official(RSS)はstock_profiles.rss_urlsが設定されている銘柄のみ「設定済み」とする
  // (企業IRページ直接監視はstock_ir_sourcesで別途追跡するため、ここでは未設定でも
  //  officialが完全に「未設定」にならないよう、後段でstock_ir_sourcesと合成表示する)。
  const officialConfiguredMap: Record<string, boolean> = {};
  for (const stock of normalizedStocks) {
    officialConfiguredMap[stock.id] = (stock.stock_profiles?.rss_urls?.length ?? 0) > 0;
  }
  const allStockIds = normalizedStocks.map((s) => s.id);
  await recordCoverage(allStockIds, "jp_news", jpNewsErr === null, jpNewsErr);
  await recordCoverage(allStockIds, "pr_times", jpNewsErr === null, jpNewsErr);
  await recordCoverage(allStockIds, "official", jpNewsErr === null, jpNewsErr, officialConfiguredMap);

  // ============================
  // 4. 海外ニュース (英語)
  // ============================
  console.log("[fetch-all] 海外ニュース取得開始");
  await updateHealth("en_news", "checking");
  let enNewsErr: string | null = null;
  try {
    for (const stock of normalizedStocks) {
      const profile = stock.stock_profiles;
      const keywords = [
        stock.name_en ?? stock.name,
        stock.code,
        ...(profile?.en_keywords ?? []),
      ].filter(Boolean);

      const enItems = await fetchGoogleNewsEN(keywords.slice(0, 4), enNewsWindow.since);

      for (const item of enItems) {
        src.en_news.candidates++;
        const existing = await findExistingArticle(item.url);
        if (existing) { src.en_news.skipped++; continue; }

        const km = quickKeywordMatch(
          item.title + (item.summary ?? ""),
          stock.name_en ?? stock.name,
          stock.code,
          profile?.en_keywords ?? []
        );
        const forceAi = profile?.force_ai_relevance_check === true;

        // 社名/銘柄コードそのものの一致だけをAI省略可の強い根拠とする。
        // en_keywordsは「steel」「insurance」等の業界共通語を含み、Google News検索の
        // クエリそのものであるため、これだけでの一致は無関係な海外記事にも高確率で
        // ヒットする。キーワードのみの一致は必ずAIで確認する。
        let relevance: "certain" | "uncertain" | "irrelevant" = km.matchedNameOrCode ? "certain" : "uncertain";
        let relevanceReason = "";
        let titleJa: string | null = null;

        if (!km.matchedNameOrCode || forceAi) {
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

        if (r.outcome === "new") { src.en_news.saved++; await notifyArticle(r.article, stock, notificationRules);
        } else if (r.outcome === "duplicate") { src.en_news.skipped++;
        } else if (r.outcome === "updated")   { src.en_news.updated++;
        } else                                { src.en_news.errors++; }
      }
      await sleep(500);
    }
    await updateHealth("en_news", "ok");
    await markSourceCheckpoint("en_news");
  } catch (err) {
    enNewsErr = String(err);
    results.errors.push(`EN news: ${err}`);
    await handleSourceError("en_news", String(err));
  }
  await recordCoverage(normalizedStocks.map((s) => s.id), "en_news", enNewsErr === null, enNewsErr);

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

          const km = quickKeywordMatch(item.title, stock.name, stock.code, profile?.jp_keywords ?? []);
          let relevance: "certain" | "uncertain" | "irrelevant" = km.matchedNameOrCode ? "certain" : "uncertain";
          let relevanceReason = "";
          if (!km.matchedNameOrCode) {
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

          if (r.outcome === "new") { src.official.saved++; await notifyArticle(r.article, stock, notificationRules);
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
  const totalSaved    = src.tdnet.saved + src.edinet.saved + src.sec_edgar.saved + src.official.saved + src.jp_news.saved + src.en_news.saved;
  const totalFound    = src.tdnet.candidates + src.edinet.candidates + src.sec_edgar.candidates + src.official.candidates + src.jp_news.candidates + src.en_news.candidates;
  const totalSkipped  = src.tdnet.skipped + src.edinet.skipped + src.sec_edgar.skipped + src.official.skipped + src.jp_news.skipped + src.en_news.skipped;
  const totalUpdated  = src.tdnet.updated + src.edinet.updated + src.sec_edgar.updated + src.official.updated + src.jp_news.updated + src.en_news.updated;

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
            tdnet:     src.tdnet,
            edinet:    src.edinet,
            sec_edgar: src.sec_edgar,
            official:  src.official,
            jp_news:   src.jp_news,
            en_news:   src.en_news,
          },
          tdnet_diag: tdnetDiag,
          // 全情報源の自動取りこぼし回収(新規実装6): 各ソースが今回どれだけ遡及したか
          recovery: recoverySpans,
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
    // タイトル or 本文(概要)が実際に変わった場合のみ「更新」として記録する。
    // (以前は同一URLの再取得ならタイトルが同じでも一律「更新」扱いにしており、
    //  news/RSSの毎時再取得のたびにpreviouson_title=new_titleの空の更新履歴が
    //  大量に作られていた)
    const titleChanged = existingInfo.title !== params.title;
    const summaryChanged = (existingInfo.summary ?? null) !== (params.summary ?? null);
    if (titleChanged || summaryChanged) {
      await supabase.from("article_updates").insert({
        article_id: existingInfo.id,
        previous_title: existingInfo.title,
        new_title: params.title,
        previous_body: existingInfo.summary,
        new_body: params.summary,
        change_type: params.tdnet_doc_id ? "tdnet_correction" : "content_update",
      });
      // 訂正開示の差分表示(新規実装4): 過去版はarticle_updatesに記録済みなので、
      // 現在のレコード自体は最新の内容に更新する(以前はタイトルが更新されず、
      // 記事詳細に「訂正前の古いタイトル」が表示され続けるバグがあった)。
      await supabase.from("articles")
        .update({ title: params.title, summary: params.summary, is_update: true, updated_at: new Date().toISOString() })
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
    .select("id, source_type, title, title_ja, publisher, published_at, summary, relevance, is_overseas, source_url, exclusion_candidate, event_type, importance")
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

  // 開示予定カレンダー(新規実装7): この記事が予定イベントの該当記事かどうかを判定する。
  // 安全ソース(TDnet/EDINET/公式)のみを対象にする(投資判断ではなく確実な一致判定のため)。
  if (isSafeSource(params.source_type)) {
    try {
      const { data: candidateEvents } = await supabase
        .from("stock_events")
        .select("id, event_type, scheduled_date, status, linked_article_id")
        .eq("stock_id", params.stock.id)
        .is("linked_article_id", null)
        .neq("status", "postponed");
      for (const ev of candidateEvents ?? []) {
        if (isAutoLinkCandidate(ev, { event_type: insertPayload.event_type as string, published_at: params.published_at ?? null })) {
          await supabase.from("stock_events").update({ linked_article_id: article.id, updated_at: new Date().toISOString() }).eq("id", ev.id);
          break; // 1記事は1イベントにのみリンクする
        }
      }
    } catch (err) {
      console.error(`[fetch-all] カレンダー自動リンク失敗 (記事は保存済み) ${article.id}:`, err);
    }
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
): Promise<{ id: string; title: string; summary: string | null; is_update_candidate: boolean } | null> {
  // Check by TDnet doc ID first (most reliable)
  if (tdnetDocId) {
    const { data } = await supabase
      .from("articles")
      .select("id, title, summary")
      .eq("tdnet_doc_id", tdnetDocId)
      .single();
    if (data) return { ...data, is_update_candidate: false };
  }
  if (edinetDocId) {
    const { data } = await supabase
      .from("articles")
      .select("id, title, summary")
      .eq("edinet_doc_id", edinetDocId)
      .single();
    if (data) return { ...data, is_update_candidate: false };
  }
  // Google Newsが同じ記事に別トークンのリンクを発行するケースに対応
  // (canonical_url は正規化済みのため source_url の表記ゆれよりも確実に一致する)
  if (canonicalUrl) {
    const { data } = await supabase
      .from("articles")
      .select("id, title, summary")
      .eq("canonical_url", canonicalUrl)
      .single();
    if (data) return { ...data, is_update_candidate: true };
  }
  // Check by URL (may indicate a content update)
  const { data } = await supabase
    .from("articles")
    .select("id, title, summary")
    .eq("source_url", url)
    .single();
  if (data) return { ...data, is_update_candidate: true };
  return null;
}

async function notifyArticle(
  article: { id: string; [key: string]: any },
  stock: StockRecord,
  notificationRules: NotificationRule[]
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

  // 詳細な通知ルール(新規実装3): 一致するルールがあればその判定を優先する。
  // 一致するルールが無ければ、既存の銘柄別通知種別設定にフォールバックする(後方互換)。
  const matchedRule = resolveNotificationRule(notificationRules, {
    stock_id: stock.id,
    importance: article.importance ?? null,
    event_type: article.event_type ?? null,
    source_type: article.source_type,
    title: article.title ?? "",
  });

  if (matchedRule) {
    await supabase.from("articles").update({ matched_notification_rule_id: matchedRule.id }).eq("id", article.id);
    if (matchedRule.action !== "notify") {
      console.log(`[fetch-all] 通知スキップ (ルール ${matchedRule.id} action=${matchedRule.action}): ${article.id}`);
      return;
    }
  } else {
    // 銘柄別の通知種別設定 (未設定 = 全種別を通知、現状の挙動を維持)
    const notifyTypes = stock.stock_profiles?.notify_event_types;
    if (notifyTypes && notifyTypes.length > 0 && !notifyTypes.includes(article.event_type)) {
      console.log(`[fetch-all] 通知スキップ (種別設定): ${article.id} event_type=${article.event_type}`);
      return;
    }
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

// 銘柄別情報源カバレッジ(新規実装5): 銘柄×情報源ごとに確認結果を記録する。
// (企業IRページはstock_ir_sourcesで既に同等の粒度を自前追跡しているため対象外)
async function recordCoverage(
  stockIds: string[],
  sourceType: string,
  ok: boolean,
  errMsg: string | null,
  isConfiguredMap?: Record<string, boolean>
): Promise<void> {
  const now = new Date().toISOString();
  for (const stockId of stockIds) {
    const isConfigured = isConfiguredMap ? (isConfiguredMap[stockId] ?? true) : true;
    if (ok) {
      await supabase.from("stock_source_coverage").upsert(
        {
          stock_id: stockId, source_type: sourceType, is_configured: isConfigured,
          last_checked_at: now, last_success_at: now, consecutive_failures: 0, last_error: null, updated_at: now,
        },
        { onConflict: "stock_id,source_type" }
      );
    } else {
      const { data: current } = await supabase
        .from("stock_source_coverage")
        .select("consecutive_failures")
        .eq("stock_id", stockId)
        .eq("source_type", sourceType)
        .single();
      await supabase.from("stock_source_coverage").upsert(
        {
          stock_id: stockId, source_type: sourceType, is_configured: isConfigured,
          last_checked_at: now, consecutive_failures: (current?.consecutive_failures ?? 0) + 1, last_error: errMsg, updated_at: now,
        },
        { onConflict: "stock_id,source_type" }
      );
    }
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

#!/usr/bin/env tsx
/**
 * backfill-classification.ts — 過去記事へのevent_type/importance遡及適用
 *
 * event_type分類・importance分類はどちらも「今後保存される新規記事のみ」を
 * 対象として実装されていた(2026-08-08監査で確認)。既存の約15,000件が
 * 未分類のまま残っていたため、一括で分類する。
 *
 * 使い方:
 *   npx tsx scripts/backfill-classification.ts            # 全件
 *   npx tsx scripts/backfill-classification.ts --limit 500 # 件数を絞って試験実行
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { classifyEventType } from "../lib/classifiers/event-type.js";
import { classifyImportance } from "../lib/classifiers/importance.js";

function loadEnv() {
  for (const envFile of ["scripts/.env.local", ".env.local"]) {
    try {
      const content = readFileSync(resolve(process.cwd(), envFile), "utf-8");
      for (const line of content.split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      break;
    } catch { /* ignore */ }
  }
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SAFE_SOURCE_TYPES = new Set(["tdnet", "edinet", "official"]);

interface ArticleRow {
  id: string;
  title: string;
  summary: string | null;
  source_type: string;
  doc_type: string | null;
  edinet_doc_type_code: string | null;
  event_type: string | null;
  importance_source: string | null;
}

async function fetchBatch(offset: number, limit: number): Promise<ArticleRow[]> {
  const { data, error } = await supabase
    .from("articles")
    .select("id, title, summary, source_type, doc_type, edinet_doc_type_code, event_type, importance_source")
    .or("event_type.is.null,importance_source.is.null")
    .order("id")
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as ArticleRow[];
}

async function processRow(row: ArticleRow) {
  const updates: Record<string, unknown> = {};

  if (!row.event_type) {
    updates.event_type = classifyEventType({
      title: row.title,
      summary: row.summary,
      tdnetDocType: row.doc_type,
      edinetDocTypeCode: row.edinet_doc_type_code,
    });
  }

  if (!row.importance_source) {
    const result = await classifyImportance({
      title: row.title,
      summary: row.summary,
      edinetDocTypeCode: row.edinet_doc_type_code,
      isSafeSource: SAFE_SOURCE_TYPES.has(row.source_type),
    });
    updates.importance = result.tier;
    updates.importance_reason = result.reason;
    updates.importance_source = result.source;
  }

  const { error } = await supabase.from("articles").update(updates).eq("id", row.id);
  if (error) throw error;
}

async function processConcurrent(rows: ArticleRow[], concurrency: number) {
  let i = 0;
  let done = 0;
  const errors: string[] = [];

  async function worker() {
    while (i < rows.length) {
      const row = rows[i++];
      try {
        await processRow(row);
      } catch (err) {
        errors.push(`${row.id}: ${(err as Error).message}`);
      }
      done++;
      if (done % 500 === 0) console.log(`[backfill] ${done}/${rows.length} 件処理`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const hardLimit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;

  console.log("[backfill] 未分類記事の件数を確認中...");
  const { count } = await supabase
    .from("articles")
    .select("id", { count: "exact", head: true })
    .or("event_type.is.null,importance_source.is.null");
  console.log(`[backfill] 対象: ${count ?? 0} 件${Number.isFinite(hardLimit) ? ` (--limit ${hardLimit})` : ""}`);

  const PAGE = 1000;
  let offset = 0;
  let totalProcessed = 0;
  const allErrors: string[] = [];

  while (totalProcessed < hardLimit) {
    const batch = await fetchBatch(0, Math.min(PAGE, hardLimit - totalProcessed));
    // 常にoffset=0で取得: 処理済み行はevent_type/importance_sourceが埋まりOR条件から外れるため、
    // ページングではなく「毎回残りの未分類分を取り直す」方式にする(処理中の更新と競合しない)
    if (batch.length === 0) break;
    const errors = await processConcurrent(batch, 15);
    allErrors.push(...errors);
    totalProcessed += batch.length;
    console.log(`[backfill] 累計 ${totalProcessed} 件処理 (エラー ${allErrors.length} 件)`);
    void offset; // unused, kept for clarity of intent above
  }

  console.log(`\n[backfill] 完了: ${totalProcessed} 件処理, ${allErrors.length} 件エラー`);
  if (allErrors.length > 0) {
    console.log("エラー詳細 (先頭20件):");
    for (const e of allErrors.slice(0, 20)) console.log(`  - ${e}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

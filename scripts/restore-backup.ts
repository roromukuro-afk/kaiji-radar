#!/usr/bin/env tsx
/**
 * restore-backup.ts — バックアップから実際にDBへ書き戻す復元コマンド
 *
 * 従来の scripts/test-backup-restore.mjs はJSON整合性チェックのみで
 * 実際のDB書き込みを行わなかった(2026-08-08監査で確認)。本スクリプトは
 * 実際に upsert(id基準)でテーブルへ書き戻す。
 *
 * 安全策:
 *   - --yes を付けない限りDBへは一切書き込まない(件数確認のみ)
 *   - upsertのみ(delete/truncateは行わない) — バックアップに無い行が
 *     誤って失われることはない
 *   - id列基準のupsertなので、既存行は上書き・無い行は追加になる
 *
 * 使い方:
 *   npx tsx scripts/restore-backup.ts --list
 *   npx tsx scripts/restore-backup.ts --file backup-2026-08-08.json                 # dry-run(件数確認のみ)
 *   npx tsx scripts/restore-backup.ts --file backup-2026-08-08.json --table articles --yes
 *   npx tsx scripts/restore-backup.ts --file backup-2026-08-08.json --all --yes
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

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

const BUCKET = "backups";

function parseArgs() {
  const args = process.argv.slice(2);
  const v: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) { v[key] = true; }
    else { v[key] = next; i++; }
  }
  return v;
}

async function listBackups() {
  const { data: files } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 20, sortBy: { column: "created_at", order: "desc" } });
  if (!files || files.length === 0) { console.log("バックアップファイルなし"); return; }
  console.log("利用可能なバックアップ:");
  for (const f of files) {
    console.log(`  ${f.name}  (${Math.round((f.metadata?.size ?? 0) / 1024)} KB, ${f.created_at})`);
  }
}

async function restore() {
  const args = parseArgs();

  if (args.list) { await listBackups(); return; }

  let fileName = args.file as string | undefined;
  if (!fileName) {
    const { data: files } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: 1, sortBy: { column: "created_at", order: "desc" } });
    fileName = files?.[0]?.name;
    if (!fileName) { console.log("バックアップファイルが見つかりません"); process.exit(1); }
    console.log(`--file 未指定のため最新のバックアップを使用: ${fileName}`);
  }

  const { data: raw, error: dlError } = await supabase.storage.from(BUCKET).download(fileName);
  if (dlError || !raw) { console.error("ダウンロード失敗:", dlError); process.exit(1); }
  const backup: Record<string, Record<string, unknown>[]> = JSON.parse(await raw.text());

  const allTables = Object.keys(backup);
  const targetTable = args.table as string | undefined;
  const doAll = args.all === true;
  const tables = targetTable ? [targetTable] : doAll ? allTables : [];

  if (tables.length === 0) {
    console.log(`バックアップに含まれるテーブル: ${allTables.join(", ")}`);
    console.log("--table <name> または --all で復元対象を指定してください(--yes無しはdry-run)");
    return;
  }

  const confirmed = args.yes === true;
  console.log(`[restore] 対象ファイル: ${fileName}${confirmed ? "" : " (dry-run — 実際の書き込みは行いません)"}`);

  for (const table of tables) {
    const rows = backup[table];
    if (!Array.isArray(rows)) { console.log(`  ✗ ${table}: バックアップに存在しません`); continue; }
    if (rows.length === 0) { console.log(`  - ${table}: 0件(スキップ)`); continue; }

    if (!confirmed) {
      console.log(`  ${table}: ${rows.length}件を復元予定(id基準でupsert)`);
      continue;
    }

    const CHUNK = 500;
    let restored = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase.from(table).upsert(chunk, { onConflict: "id" });
      if (error) {
        console.error(`  ✗ ${table}: ${i}件目付近で失敗:`, error.message);
        break;
      }
      restored += chunk.length;
    }
    console.log(`  ✓ ${table}: ${restored}/${rows.length}件を復元`);
  }

  if (confirmed) {
    await supabase.from("operation_logs").insert({
      action: "restore_backup",
      result: "success",
      details: { file: fileName, tables },
    });
  }
}

restore().catch((err) => { console.error(err); process.exit(1); });

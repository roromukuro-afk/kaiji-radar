#!/usr/bin/env tsx
/**
 * check-migration-drift.ts — 本番DBとマイグレーションの差分検出
 *
 * 2026-08-08監査で「articles.is_important がマイグレーション履歴に無いまま
 * 本番DBに存在する」ドリフトが見つかった。同種の問題(リポジトリ上の
 * migrationファイルと、本番の supabase_migrations.schema_migrations の
 * 適用履歴が食い違う)を検出する。
 *
 * 使い方: npx tsx scripts/check-migration-drift.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";
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

interface MigrationRow { version: string; name: string }
interface ColumnRow { table: string; column: string; type: string; nullable: string }

function localMigrationNames(): { version: string; name: string; file: string }[] {
  const dir = resolve(process.cwd(), "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => {
      const m = f.match(/^(\d+)_(.+)\.sql$/);
      return m ? { version: m[1], name: m[2], file: f } : { version: "", name: f.replace(/\.sql$/, ""), file: f };
    });
}

async function main() {
  const { data, error } = await supabase.rpc("get_schema_diagnostics");
  if (error) {
    console.error("[drift] get_schema_diagnostics RPC呼び出し失敗:", error.message);
    console.error("  (supabase/migrations/*_add_schema_diagnostics_function.sql が未適用の可能性があります)");
    process.exit(1);
  }

  const remoteMigrations: MigrationRow[] = data.migrations ?? [];
  const columns: ColumnRow[] = data.columns ?? [];
  const localFiles = localMigrationNames();

  console.log(`[drift] ローカルmigrationファイル: ${localFiles.length}件 / 本番適用済み: ${remoteMigrations.length}件\n`);

  // 1. 名前ベースでの突き合わせ(apply_migrationはファイル名と異なるversionを
  //    自動採番するため、versionではなくnameで対応させる)
  const remoteByName = new Map(remoteMigrations.map((m) => [m.name, m]));
  const localByName = new Map(localFiles.map((f) => [f.name, f]));

  const remoteOnly = remoteMigrations.filter((m) => !localByName.has(m.name));
  const localOnly = localFiles.filter((f) => !remoteByName.has(f.name));
  const versionMismatch = localFiles
    .filter((f) => remoteByName.has(f.name) && remoteByName.get(f.name)!.version !== f.version);

  if (remoteOnly.length > 0) {
    console.log("⚠ 本番に適用済みだがリポジトリにファイルが無いmigration:");
    for (const m of remoteOnly) console.log(`  - ${m.version} ${m.name}`);
    console.log("  → 別セッション/手動SQLで直接適用された可能性があります。内容の追跡ができません。\n");
  }

  if (localOnly.length > 0) {
    console.log("⚠ リポジトリにあるが本番の適用履歴に無いmigrationファイル:");
    for (const f of localOnly) console.log(`  - ${f.file}`);
    console.log("  → migrate.yml実行時に想定外の変更が走る可能性があります。内容を確認してください。\n");
  }

  if (versionMismatch.length > 0) {
    console.log(`ℹ 名前は一致するがversion番号が異なるmigration(${versionMismatch.length}件、通常は無害):`);
    for (const f of versionMismatch) {
      console.log(`  - ${f.name}: local=${f.version} remote=${remoteByName.get(f.name)!.version}`);
    }
    console.log("  → apply_migrationがファイル名と別のversionを自動採番するため発生。実害なし。\n");
  }

  if (remoteOnly.length === 0 && localOnly.length === 0) {
    console.log("✓ migration名ベースでは差分なし\n");
  }

  // 2. is_important のような「よく知られたドリフト」の再発防止チェック:
  //    articlesテーブルの列のうち、どのmigrationファイルにも一切登場しない列名を報告する
  const migrationsText = localFiles
    .map((f) => {
      try { return readFileSync(resolve(process.cwd(), "supabase/migrations", f.file), "utf-8"); }
      catch { return ""; }
    })
    .join("\n");

  const undocumented = columns.filter(
    (c) => !new RegExp(`\\b${c.column}\\b`, "i").test(migrationsText)
  );

  if (undocumented.length > 0) {
    console.log(`⚠ どのmigrationファイルにも列名が登場しないカラム(${undocumented.length}件、is_importantと同種のドリフトの疑い):`);
    for (const c of undocumented.slice(0, 30)) console.log(`  - ${c.table}.${c.column} (${c.type})`);
    if (undocumented.length > 30) console.log(`  ... 他 ${undocumented.length - 30} 件`);
    console.log("  → migrationファイル中に列名が出てこない列。誤検出(命名ゆらぎ等)の可能性もあるため目視確認推奨。\n");
  } else {
    console.log("✓ 全カラムがいずれかのmigrationファイル内で言及されています\n");
  }

  console.log(`[drift] 本番テーブル数: ${(data.tables ?? []).length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

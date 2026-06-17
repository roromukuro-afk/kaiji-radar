/**
 * 週次バックアップワーカー
 *
 * GitHub Actions から weekly cron で実行される。
 * 主要テーブルを JSON エクスポートし Supabase Storage に保存。
 */

import { createClient } from "@supabase/supabase-js";
import { sendWeeklyBackupReport } from "../lib/notifications/email.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BACKUP_BUCKET = "backups";
const TABLES = [
  "stocks",
  "stock_profiles",
  "articles",
  "article_stocks",
  "pdf_documents",
  "push_subscriptions",
  "notification_history",
  "operation_logs",
  "system_settings",
];

async function main() {
  const startedAt = new Date();
  console.log("[backup] 開始", startedAt.toISOString());

  const { data: logRow } = await supabase
    .from("backup_logs")
    .insert({ status: "running" })
    .select("id")
    .single();
  const logId = logRow?.id;

  try {
    const backup: Record<string, any[]> = {};

    for (const table of TABLES) {
      const { data, error } = await supabase.from(table).select("*");
      if (error) {
        console.error(`[backup] ${table} 取得失敗:`, error);
        backup[table] = [];
      } else {
        backup[table] = data ?? [];
      }
    }

    const dateStr = startedAt.toISOString().split("T")[0];
    const fileName = `backup-${dateStr}.json`;
    const content = JSON.stringify(backup, null, 2);
    const bytes = Buffer.from(content, "utf-8");

    const { error: uploadError } = await supabase.storage
      .from(BACKUP_BUCKET)
      .upload(fileName, bytes, { contentType: "application/json", upsert: true });

    if (uploadError) throw uploadError;

    const completedAt = new Date();
    const details = TABLES.map((t) => `${t}: ${backup[t].length}件`).join("\n");

    if (logId) {
      await supabase
        .from("backup_logs")
        .update({
          status: "completed",
          storage_path: fileName,
          file_size_bytes: bytes.length,
          completed_at: completedAt.toISOString(),
        })
        .eq("id", logId);
    }

    await supabase.from("health_checks").upsert(
      { source: "backup", status: "ok", last_success_at: completedAt.toISOString(), consecutive_failures: 0, checked_at: completedAt.toISOString() },
      { onConflict: "source" }
    );

    await sendWeeklyBackupReport(true, `バックアップ完了\n${details}\nサイズ: ${Math.round(bytes.length / 1024)} KB`);
    console.log("[backup] 完了:", fileName);
  } catch (err) {
    console.error("[backup] 失敗:", err);

    if (logId) {
      await supabase
        .from("backup_logs")
        .update({ status: "failed", error_message: String(err) })
        .eq("id", logId);
    }

    await supabase.from("health_checks").upsert(
      { source: "backup", status: "failed", last_failure_at: new Date().toISOString(), consecutive_failures: 1, error_message: String(err), checked_at: new Date().toISOString() },
      { onConflict: "source" }
    );

    await sendWeeklyBackupReport(false, `バックアップ失敗\nエラー: ${err}`);
  }
}

main().catch((err) => {
  console.error("[backup] FATAL:", err);
  process.exit(1);
});

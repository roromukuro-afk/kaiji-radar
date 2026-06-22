import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { sendWeeklyBackupReport } from "../lib/notifications/email.js";

const envLines = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n");
for (const line of envLines) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const idx = t.indexOf("=");
  if (idx === -1) continue;
  const k = t.slice(0, idx).trim();
  const v = t.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BACKUP_BUCKET = "backups";
const TABLES = ["stocks", "stock_profiles", "articles", "article_stocks", "push_subscriptions", "notification_history", "operation_logs", "system_settings"];

const startedAt = new Date();
console.log("[backup] 開始", startedAt.toISOString());

const { data: logRow } = await supabase.from("backup_logs").insert({ status: "running" }).select("id").single();
const logId = logRow?.id;
console.log("[backup] ログID:", logId);

try {
  const backup = {};
  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) { console.error(`[backup] ${table} 取得失敗:`, error.message); backup[table] = []; }
    else { backup[table] = data ?? []; console.log(`  ${table}: ${backup[table].length}件`); }
  }

  const dateStr = startedAt.toISOString().split("T")[0];
  const fileName = `backup-${dateStr}-manual.json`;
  const content = JSON.stringify(backup, null, 2);
  const bytes = Buffer.from(content, "utf-8");

  console.log(`[backup] アップロード: ${fileName} (${Math.round(bytes.length / 1024)} KB)`);

  const { error: uploadError } = await supabase.storage.from(BACKUP_BUCKET).upload(fileName, bytes, { contentType: "application/json", upsert: true });
  if (uploadError) throw uploadError;

  const completedAt = new Date();
  if (logId) {
    await supabase.from("backup_logs").update({ status: "completed", storage_path: fileName, file_size_bytes: bytes.length, completed_at: completedAt.toISOString() }).eq("id", logId);
  }
  await supabase.from("health_checks").upsert({ source: "backup", status: "ok", last_success_at: completedAt.toISOString(), consecutive_failures: 0, checked_at: completedAt.toISOString() }, { onConflict: "source" });

  console.log("[backup] 完了:", fileName);
} catch (err) {
  console.error("[backup] 失敗:", err);
  if (logId) {
    await supabase.from("backup_logs").update({ status: "failed", error_message: String(err) }).eq("id", logId);
  }
}

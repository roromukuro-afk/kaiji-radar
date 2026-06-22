import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
const envLines = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n");
for (const line of envLines) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const idx = t.indexOf("="); if (idx === -1) continue;
  const k = t.slice(0, idx).trim();
  const v = t.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Articles total
const { count: artCount } = await sb.from("articles").select("id", { count: "exact", head: true });
console.log("articles総数:", artCount);

// notification_history
const { count: nhCount } = await sb.from("notification_history").select("id", { count: "exact", head: true });
console.log("notification_history:", nhCount);

// pdf_documents
const { count: pdfCount } = await sb.from("pdf_documents").select("id", { count: "exact", head: true });
const { data: pdfSize } = await sb.from("pdf_documents").select("file_size_bytes").not("file_size_bytes", "is", null);
const totalPdfBytes = (pdfSize ?? []).reduce((s, p) => s + (p.file_size_bytes ?? 0), 0);
console.log("pdf_documents:", pdfCount, "件, 合計", Math.round(totalPdfBytes / 1024), "KB");

// storage buckets
const { data: backupFiles } = await sb.storage.from("backups").list("", { limit: 100 });
const backupBytes = (backupFiles ?? []).reduce((s, f) => s + (f.metadata?.size ?? 0), 0);
console.log("バックアップストレージ:", Math.round(backupBytes / 1024), "KB (", backupFiles?.length, "件)");

// Supabase free tier limits reminder
console.log("\n--- Supabase Free Tier ---");
console.log("DB: 500MB / Storage: 1GB / Bandwidth: 5GB/month");
console.log("Estimated DB rows: articles=" + artCount + " + notification_history=" + nhCount);

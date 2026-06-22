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
const { data } = await sb.from("backup_logs").select("*").order("started_at", { ascending: false }).limit(5);
console.log("=== backup_logs ===");
for (const b of data ?? []) {
  console.log(JSON.stringify({ status: b.status, path: b.storage_path, size_kb: b.file_size_bytes ? Math.round(b.file_size_bytes/1024) : null, started: b.started_at?.slice(0,19), completed: b.completed_at?.slice(0,19) }));
}
// list storage files
const { data: files } = await sb.storage.from("backups").list("", { limit: 10, sortBy: { column: "created_at", order: "desc" } });
console.log("\n=== storage backups ===");
for (const f of files ?? []) {
  console.log(f.name, Math.round((f.metadata?.size ?? 0) / 1024) + " KB");
}

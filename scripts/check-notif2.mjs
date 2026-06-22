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

// Select all columns without order - check column names
const { data, error } = await sb.from("notification_history").select("*").limit(3);
if (error) console.log("error:", error.message);
else if (data && data.length > 0) {
  console.log("columns:", Object.keys(data[0]));
  console.log("sample:", JSON.stringify(data[0]));
}

// status counts
const { data: all } = await sb.from("notification_history").select("status");
const counts = {};
for (const r of all ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log("status counts:", counts);

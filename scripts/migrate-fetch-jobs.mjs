/**
 * Migration: add stats columns to fetch_jobs.
 * Run: npx tsx scripts/migrate-fetch-jobs.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

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

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Use Supabase Management API via REST to run SQL
// (service role key allows rpc calls)
const sql = `
  ALTER TABLE fetch_jobs
    ADD COLUMN IF NOT EXISTS duplicates_skipped INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updates_detected INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS stocks_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC;
`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL.replace("https://", "https://");
const resp = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
  body: JSON.stringify({ sql }),
});

if (!resp.ok) {
  const text = await resp.text();
  // Likely no exec_sql function — try via management API
  console.log("rpc/exec_sql not available:", text.slice(0, 200));
  console.log("\nマイグレーションは Supabase SQL Editor で以下を実行してください:\n");
  console.log(sql);
} else {
  console.log("Migration applied:", await resp.json());
}

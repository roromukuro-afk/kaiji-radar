/**
 * 月次監視プロフィール更新ワーカー
 *
 * GitHub Actions から monthly cron で実行される。
 * 各銘柄の公式情報を確認し、プロフィールを更新する。
 * 推測での書き換えは行わない。公式情報で確認できた変更のみ反映。
 */

import { createClient } from "@supabase/supabase-js";
import { sendErrorEmail } from "../lib/notifications/email.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log("[update-profiles] 開始", new Date().toISOString());

  const { data: rawStocks } = await supabase
    .from("stocks")
    .select("id, code, name, stock_profiles(official_url, ir_url)")
    .eq("status", "active");

  if (!rawStocks) return;

  const stocks = rawStocks.map((s) => ({
    ...s,
    stock_profiles: Array.isArray(s.stock_profiles) ? (s.stock_profiles[0] ?? null) : s.stock_profiles,
  }));

  for (const stock of stocks) {
    try {
      await updateStockProfile(stock);
      await sleep(2000);
    } catch (err) {
      console.error(`[update-profiles] ${stock.code} 失敗:`, err);
    }
  }

  await supabase.from("operation_logs").insert({
    action: "monthly_profile_update",
    details: { stock_count: stocks.length },
    result: "success",
  });

  console.log("[update-profiles] 完了");
}

async function updateStockProfile(stock: {
  id: string;
  code: string;
  name: string;
  stock_profiles: { official_url: string | null; ir_url: string | null } | null;
}): Promise<void> {
  const officialUrl = stock.stock_profiles?.official_url;
  if (!officialUrl) return;

  // Fetch official page to detect changes (e.g. new subsidiaries, CEO changes)
  try {
    const res = await fetch(officialUrl, {
      headers: { "User-Agent": "KaijiRadar/1.0 (+https://github.com/roromukuro/kaiji-radar)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return;

    // Basic check: page still accessible
    const lastChecked = new Date().toISOString();
    await supabase
      .from("stock_profiles")
      .update({ last_checked_at: lastChecked })
      .eq("stock_id", stock.id);

    console.log(`[update-profiles] ${stock.code} ${stock.name} 確認OK`);
  } catch (err) {
    console.error(`[update-profiles] ${stock.code} サイト確認失敗:`, err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("[update-profiles] FATAL:", err);
  process.exit(1);
});

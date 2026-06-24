/**
 * 9984 ソフトバンクグループ 追加スクリプト (Phase 3.3)
 *
 * 9434 ソフトバンク(通信)とは別法人。投資持株会社として登録する。
 *   npx tsx scripts/add-9984.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

for (const f of [".env.local", "scripts/.env.local"]) {
  try {
    const content = readFileSync(resolve(process.cwd(), f), "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    break;
  } catch { /* ignore */ }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const STOCK = {
  code: "9984",
  name: "ソフトバンクグループ",
  name_en: "SoftBank Group",
  sec_code: "99840",
  edinet_code: "E02778",
  exchange: "東証プライム",
  sector: "情報・通信業",
  official_url: "https://group.softbank/",
  ir_url: "https://group.softbank/ir",
  press_release_url: "https://group.softbank/news",
  // 投資持株会社としてのキーワード (通信会社の9434とは区別)
  jp_keywords: ["ソフトバンクグループ", "SBG", "ビジョンファンド", "Vision Fund", "孫正義", "ARM", "アーム", "半導体", "投資", "出資", "アリババ", "自社株買い", "持株会社"],
  en_keywords: ["SoftBank Group", "Vision Fund", "Masayoshi Son", "ARM Holdings", "Alibaba", "investment", "AI", "semiconductor", "buyback"],
};

async function main() {
  const { data: existing } = await supabase.from("stocks").select("id").eq("code", STOCK.code).single();
  if (existing) {
    console.log(`SKIP: ${STOCK.code} ${STOCK.name} は既に存在 (id=${existing.id})`);
    return;
  }

  const { data: stock, error } = await supabase
    .from("stocks")
    .insert({
      code: STOCK.code,
      name: STOCK.name,
      name_en: STOCK.name_en,
      sec_code: STOCK.sec_code,
      edinet_code: STOCK.edinet_code,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !stock) {
    console.error("FAIL:", error);
    process.exit(1);
  }

  const { error: profileErr } = await supabase.from("stock_profiles").insert({
    stock_id: stock.id,
    exchange: STOCK.exchange,
    sector: STOCK.sector,
    jp_keywords: STOCK.jp_keywords,
    en_keywords: STOCK.en_keywords,
    rss_urls: [],
    official_url: STOCK.official_url,
    ir_url: STOCK.ir_url,
    press_release_url: STOCK.press_release_url,
  });
  if (profileErr) console.error("WARN profile:", profileErr);

  await supabase.from("operation_logs").insert({
    action: "add_stock",
    result: "success",
    details: { code: STOCK.code, name: STOCK.name, triggered_by: "script:add-9984", phase: "3.3" },
  });

  console.log(`OK: ${STOCK.code} ${STOCK.name} 追加完了 (id=${stock.id})`);

  const { data: all } = await supabase.from("stocks").select("code").eq("status", "active");
  console.log(`監視中銘柄数: ${all?.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

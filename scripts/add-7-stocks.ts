/**
 * 7銘柄追加スクリプト (合計28銘柄へ)
 *
 * 使用方法:
 *   npx tsx scripts/add-7-stocks.ts
 *
 * 必要な環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const NEW_STOCKS = [
  {
    code: "9104",
    name: "商船三井",
    name_en: "Mitsui O.S.K. Lines",
    sec_code: "91040",
    edinet_code: "E04236",
    exchange: "東証プライム",
    sector: "海運業",
    official_url: "https://www.mol.co.jp/",
    ir_url: "https://ir.mol.co.jp/",
    press_release_url: "https://www.mol.co.jp/pr/",
    jp_keywords: ["商船三井", "MOL", "海運", "LNG船", "自動車運搬船", "コンテナ船", "クルーズ"],
    en_keywords: ["Mitsui O.S.K", "MOL", "shipping", "LNG carrier", "car carrier", "container"],
  },
  {
    code: "4183",
    name: "三井化学",
    name_en: "Mitsui Chemicals",
    sec_code: "41830",
    edinet_code: "E00840",
    exchange: "東証プライム",
    sector: "化学",
    official_url: "https://jp.mitsuichemicals.com/",
    ir_url: "https://jp.mitsuichemicals.com/jp/ir/",
    press_release_url: "https://jp.mitsuichemicals.com/jp/release/",
    jp_keywords: ["三井化学", "化学品", "機能性化学", "ポリプロピレン", "医薬品", "電子材料", "モビリティ"],
    en_keywords: ["Mitsui Chemicals", "polypropylene", "functional materials", "battery materials", "pharmaceuticals"],
  },
  {
    code: "1911",
    name: "住友林業",
    name_en: "Sumitomo Forestry",
    sec_code: "19110",
    edinet_code: "E00011",
    exchange: "東証プライム",
    sector: "建設業",
    official_url: "https://sfc.jp/",
    ir_url: "https://sfc.jp/ir/",
    press_release_url: "https://sfc.jp/information/news/",
    jp_keywords: ["住友林業", "木材", "注文住宅", "土地活用", "賃貸住宅", "林業", "不動産", "サステナブル"],
    en_keywords: ["Sumitomo Forestry", "timber", "housing", "lumber", "real estate", "construction", "sustainable"],
  },
  {
    code: "5110",
    name: "住友ゴム工業",
    name_en: "Sumitomo Rubber Industries",
    sec_code: "51100",
    edinet_code: "E01110",
    exchange: "東証プライム",
    sector: "ゴム製品",
    official_url: "https://www.srigroup.co.jp/",
    ir_url: "https://www.srigroup.co.jp/ir/",
    press_release_url: "https://www.srigroup.co.jp/newsrelease/",
    jp_keywords: ["住友ゴム", "DUNLOP", "ダンロップ", "タイヤ", "ゴルフ", "テニス", "スポーツ"],
    en_keywords: ["Sumitomo Rubber", "Dunlop", "tire", "tyre", "golf", "tennis", "sports equipment"],
  },
  {
    code: "4272",
    name: "日本化薬",
    name_en: "Nippon Kayaku",
    sec_code: "42720",
    edinet_code: "E01189",
    exchange: "東証プライム",
    sector: "化学",
    official_url: "https://www.nipponkayaku.co.jp/",
    ir_url: "https://www.nipponkayaku.co.jp/ir/",
    press_release_url: "https://www.nipponkayaku.co.jp/information/",
    jp_keywords: ["日本化薬", "医薬品", "農薬", "機能性化学品", "エアバッグ", "自動車安全", "火工品"],
    en_keywords: ["Nippon Kayaku", "pharmaceuticals", "agrochemicals", "airbag inflators", "fine chemicals", "safety systems"],
  },
  {
    code: "5401",
    name: "日本製鉄",
    name_en: "Nippon Steel",
    sec_code: "54010",
    edinet_code: "E01225",
    exchange: "東証プライム",
    sector: "鉄鋼",
    official_url: "https://www.nipponsteel.com/",
    ir_url: "https://www.nipponsteel.com/ir/",
    press_release_url: "https://www.nipponsteel.com/news/",
    jp_keywords: ["日本製鉄", "鉄鋼", "鋼材", "高炉", "電炉", "鉄鉱石", "製鉄"],
    en_keywords: ["Nippon Steel", "steel", "iron ore", "blast furnace", "electric furnace", "automotive steel"],
  },
  {
    code: "8766",
    name: "東京海上ホールディングス",
    name_en: "Tokio Marine Holdings",
    sec_code: "87660",
    edinet_code: "E03847",
    exchange: "東証プライム",
    sector: "保険業",
    official_url: "https://www.tokiomarinehd.com/",
    ir_url: "https://www.tokiomarinehd.com/ir/",
    press_release_url: "https://www.tokiomarinehd.com/newsroom/release/",
    jp_keywords: ["東京海上", "東京海上日動", "保険", "損保", "生命保険", "国際保険", "資産運用"],
    en_keywords: ["Tokio Marine", "insurance", "non-life insurance", "property insurance", "asset management"],
  },
];

async function main() {
  console.log("7銘柄の追加を開始...");
  let success = 0;
  let skip = 0;
  const addedIds: string[] = [];

  for (const s of NEW_STOCKS) {
    const { data: existing } = await supabase
      .from("stocks")
      .select("id")
      .eq("code", s.code)
      .single();

    if (existing) {
      console.log(`  SKIP ${s.code} ${s.name} (既存)`);
      skip++;
      continue;
    }

    const { data: stock, error: stockErr } = await supabase
      .from("stocks")
      .insert({
        code: s.code,
        name: s.name,
        name_en: s.name_en,
        sec_code: s.sec_code,
        edinet_code: s.edinet_code,
        status: "active",
      })
      .select("id")
      .single();

    if (stockErr || !stock) {
      console.error(`  FAIL ${s.code} ${s.name}:`, stockErr);
      continue;
    }

    const { error: profileErr } = await supabase.from("stock_profiles").insert({
      stock_id: stock.id,
      exchange: s.exchange,
      sector: s.sector,
      jp_keywords: s.jp_keywords,
      en_keywords: s.en_keywords,
      rss_urls: [],
      official_url: s.official_url,
      ir_url: s.ir_url,
      press_release_url: s.press_release_url,
    });

    if (profileErr) {
      console.error(`  WARN ${s.code} profile失敗:`, profileErr);
    }

    // operation_logs に記録
    await supabase.from("operation_logs").insert({
      action: "add_stock",
      result: "success",
      details: {
        code: s.code,
        name: s.name,
        triggered_by: "script:add-7-stocks",
      },
    });

    console.log(`  OK   ${s.code} ${s.name}`);
    success++;
    addedIds.push(stock.id);
    await new Promise((r) => setTimeout(r, 200));
  }

  // 追加後の全銘柄確認
  const { data: allStocks } = await supabase
    .from("stocks")
    .select("code, name, status")
    .eq("status", "active")
    .order("code");

  console.log(`\n完了: ${success} 件追加, ${skip} 件スキップ`);
  console.log(`\n監視中銘柄 (${allStocks?.length ?? 0} 件):`);
  allStocks?.forEach((s) => console.log(`  ${s.code} ${s.name}`));

  if (addedIds.length > 0) {
    console.log(`\n新規追加銘柄ID (バックフィルに使用):`, addedIds);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

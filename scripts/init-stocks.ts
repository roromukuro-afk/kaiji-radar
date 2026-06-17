/**
 * 21銘柄の初期登録スクリプト
 *
 * 使用方法:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/init-stocks.ts
 *
 * 本番Supabaseプロジェクト作成後、スキーマ適用後に一度だけ実行する。
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const STOCKS = [
  {
    code: "8136",
    name: "サンリオ",
    name_en: "Sanrio",
    sec_code: "81360",
    jp_keywords: ["サンリオ", "ハローキティ", "キャラクター"],
    en_keywords: ["Sanrio", "Hello Kitty"],
    exchange: "東証プライム",
    sector: "その他製品",
  },
  {
    code: "9602",
    name: "東宝",
    name_en: "Toho",
    sec_code: "96020",
    jp_keywords: ["東宝", "映画", "ゴジラ"],
    en_keywords: ["Toho", "Godzilla"],
    exchange: "東証プライム",
    sector: "サービス業",
  },
  {
    code: "7272",
    name: "ヤマハ発動機",
    name_en: "Yamaha Motor",
    sec_code: "72720",
    jp_keywords: ["ヤマハ発動機", "ヤマハ", "バイク", "二輪"],
    en_keywords: ["Yamaha Motor", "motorcycle"],
    exchange: "東証プライム",
    sector: "輸送用機器",
  },
  {
    code: "8309",
    name: "三井住友トラスト・ホールディングス",
    name_en: "Sumitomo Mitsui Trust",
    sec_code: "83090",
    jp_keywords: ["三井住友トラスト", "住友信託", "信託銀行"],
    en_keywords: ["Sumitomo Mitsui Trust"],
    exchange: "東証プライム",
    sector: "銀行業",
  },
  {
    code: "8729",
    name: "ソニーフィナンシャルグループ",
    name_en: "Sony Financial Group",
    sec_code: "87290",
    jp_keywords: ["ソニーフィナンシャル", "ソニー生命", "ソニー損保"],
    en_keywords: ["Sony Financial Group"],
    exchange: "東証プライム",
    sector: "保険業",
  },
  {
    code: "1605",
    name: "INPEX",
    name_en: "INPEX",
    sec_code: "16050",
    jp_keywords: ["INPEX", "インペックス", "石油", "天然ガス"],
    en_keywords: ["INPEX", "oil", "natural gas"],
    exchange: "東証プライム",
    sector: "鉱業",
  },
  {
    code: "6501",
    name: "日立製作所",
    name_en: "Hitachi",
    sec_code: "65010",
    jp_keywords: ["日立", "日立製作所"],
    en_keywords: ["Hitachi"],
    exchange: "東証プライム",
    sector: "電気機器",
  },
  {
    code: "8316",
    name: "三井住友フィナンシャルグループ",
    name_en: "SMFG",
    sec_code: "83160",
    jp_keywords: ["三井住友", "SMFG", "SMBC"],
    en_keywords: ["SMFG", "Sumitomo Mitsui Financial Group", "SMBC"],
    exchange: "東証プライム",
    sector: "銀行業",
  },
  {
    code: "6758",
    name: "ソニーグループ",
    name_en: "Sony Group",
    sec_code: "67580",
    jp_keywords: ["ソニー", "ソニーグループ"],
    en_keywords: ["Sony", "Sony Group"],
    exchange: "東証プライム",
    sector: "電気機器",
  },
  {
    code: "9434",
    name: "ソフトバンク",
    name_en: "SoftBank Corp",
    sec_code: "94340",
    jp_keywords: ["ソフトバンク"],
    en_keywords: ["SoftBank Corp"],
    exchange: "東証プライム",
    sector: "情報・通信業",
  },
  {
    code: "6584",
    name: "三桜工業",
    name_en: "Sanoh Industrial",
    sec_code: "65840",
    jp_keywords: ["三桜工業", "サンオー"],
    en_keywords: ["Sanoh Industrial"],
    exchange: "東証プライム",
    sector: "輸送用機器",
  },
  {
    code: "6616",
    name: "トレックス・セミコンダクター",
    name_en: "Torex Semiconductor",
    sec_code: "66160",
    jp_keywords: ["トレックス", "トレックスセミコンダクター"],
    en_keywords: ["Torex Semiconductor"],
    exchange: "東証プライム",
    sector: "電気機器",
  },
  {
    code: "3967",
    name: "エルテス",
    name_en: "ELTES",
    sec_code: "39670",
    jp_keywords: ["エルテス", "ELTES", "デジタルリスク"],
    en_keywords: ["ELTES"],
    exchange: "東証グロース",
    sector: "情報・通信業",
  },
  {
    code: "4398",
    name: "ブロードバンドセキュリティ",
    name_en: "Broadband Security",
    sec_code: "43980",
    jp_keywords: ["ブロードバンドセキュリティ", "BBSec", "セキュリティ"],
    en_keywords: ["Broadband Security", "BBSec"],
    exchange: "東証スタンダード",
    sector: "情報・通信業",
  },
  {
    code: "5132",
    name: "pluszero",
    name_en: "pluszero",
    sec_code: "51320",
    jp_keywords: ["pluszero", "プラスゼロ", "AI"],
    en_keywords: ["pluszero"],
    exchange: "東証グロース",
    sector: "情報・通信業",
  },
  {
    code: "5803",
    name: "フジクラ",
    name_en: "Fujikura",
    sec_code: "58030",
    jp_keywords: ["フジクラ", "電線", "光ファイバ"],
    en_keywords: ["Fujikura"],
    exchange: "東証プライム",
    sector: "非鉄金属",
  },
  {
    code: "2914",
    name: "JT",
    name_en: "Japan Tobacco",
    sec_code: "29140",
    jp_keywords: ["JT", "日本たばこ産業"],
    en_keywords: ["Japan Tobacco", "JT"],
    exchange: "東証プライム",
    sector: "食料品",
  },
  {
    code: "8592",
    name: "オリックス",
    name_en: "ORIX",
    sec_code: "85920",
    jp_keywords: ["オリックス", "ORIX"],
    en_keywords: ["ORIX"],
    exchange: "東証プライム",
    sector: "その他金融業",
  },
  {
    code: "7011",
    name: "三菱重工業",
    name_en: "Mitsubishi Heavy Industries",
    sec_code: "70110",
    jp_keywords: ["三菱重工", "三菱重工業"],
    en_keywords: ["Mitsubishi Heavy Industries", "MHI"],
    exchange: "東証プライム",
    sector: "機械",
  },
  {
    code: "4005",
    name: "住友化学",
    name_en: "Sumitomo Chemical",
    sec_code: "40050",
    jp_keywords: ["住友化学"],
    en_keywords: ["Sumitomo Chemical"],
    exchange: "東証プライム",
    sector: "化学",
  },
  {
    code: "8473",
    name: "SBIホールディングス",
    name_en: "SBI Holdings",
    sec_code: "84730",
    jp_keywords: ["SBI", "SBIホールディングス", "SBI証券"],
    en_keywords: ["SBI Holdings"],
    exchange: "東証プライム",
    sector: "証券・商品先物取引業",
  },
];

async function main() {
  console.log("21銘柄の初期登録を開始...");
  let success = 0;
  let skip = 0;

  for (const s of STOCKS) {
    // Check if already exists
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

    // Insert stock
    const { data: stock, error: stockErr } = await supabase
      .from("stocks")
      .insert({
        code: s.code,
        name: s.name,
        name_en: s.name_en,
        sec_code: s.sec_code,
        edinet_code: null,
        status: "active",
      })
      .select("id")
      .single();

    if (stockErr || !stock) {
      console.error(`  FAIL ${s.code} ${s.name}:`, stockErr);
      continue;
    }

    // Insert profile
    const { error: profileErr } = await supabase.from("stock_profiles").insert({
      stock_id: stock.id,
      exchange: s.exchange,
      sector: s.sector,
      jp_keywords: s.jp_keywords,
      en_keywords: s.en_keywords,
      rss_urls: [],
      official_url: null,
      ir_url: null,
      press_release_url: null,
    });

    if (profileErr) {
      console.error(`  WARN ${s.code} profile失敗:`, profileErr);
    }

    console.log(`  OK   ${s.code} ${s.name}`);
    success++;

    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\n完了: ${success} 件追加, ${skip} 件スキップ`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

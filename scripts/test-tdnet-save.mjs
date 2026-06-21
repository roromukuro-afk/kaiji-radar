import { createClient } from "@supabase/supabase-js";
import https from "https";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function httpsGet(url, ms = 20000) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.9" } }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        r.destroy(); httpsGet(resp.headers.location, ms).then(res).catch(rej); return;
      }
      if (!resp.statusCode || resp.statusCode >= 400) {
        r.destroy(); rej(new Error("HTTP " + resp.statusCode)); return;
      }
      const c = []; resp.on("data", d => c.push(d));
      resp.on("end", () => res(Buffer.concat(c).toString()));
      resp.on("error", rej);
    });
    r.setTimeout(ms, () => { r.destroy(); rej(new Error("timeout")); });
    r.on("error", rej);
  });
}

function parseItems(html, code, since) {
  const items = [];
  const re = /<article[^>]*>[\s\S]*?<\/article>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const a = m[0];
    if (!a.includes("TDnet")) continue;
    const hm = a.match(/href="(https:\/\/finance-frontend[^"]+\.pdf)"/);
    const tm = a.match(/<h3[^>]*>([^<]+)<\/h3>/);
    const dm = a.match(/dateTime="([^"]+)"/);
    if (!hm || !tm || !dm) continue;
    const d = new Date(dm[1]);
    if (since && d <= since) continue;
    const fm = hm[1].match(/\/(\d+)\.pdf$/);
    const yid = fm?.[1];
    const docId = yid && yid.length === 14 ? "1401" + yid : (yid || ("yahoo-" + code + "-" + d.getTime()));
    items.push({ docId, code, title: tm[1].trim(), publishedAt: d, url: hm[1] });
  }
  return items;
}

const { data: stocks, error: se } = await supabase.from("stocks").select("id,code,name").eq("status", "active");
if (se) { console.error("stocks error:", se); process.exit(1); }

const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
let saved = 0, skipped = 0, errors = [];
console.log("銘柄数:", stocks.length, "| since:", since.toISOString().slice(0, 10));

for (const stock of stocks) {
  await new Promise(r => setTimeout(r, 300));
  try {
    const html = await httpsGet("https://finance.yahoo.co.jp/quote/" + stock.code + ".T/disclosure");
    const items = parseItems(html, stock.code, since);
    for (const item of items) {
      const { data: ex } = await supabase.from("articles").select("id").eq("tdnet_doc_id", item.docId).maybeSingle();
      if (ex) { skipped++; continue; }
      const { data: art, error } = await supabase.from("articles").insert({
        source_type: "tdnet",
        source_url: item.url,
        tdnet_doc_id: item.docId,
        title: item.title,
        published_at: item.publishedAt.toISOString(),
        is_pdf: true,
        relevance: "certain",
      }).select("id").single();
      if (error) { errors.push(stock.code + ":" + error.message); }
      else {
        await supabase.from("article_stocks").insert({ article_id: art.id, stock_id: stock.id });
        saved++;
      }
    }
    if (items.length > 0) console.log(stock.code, stock.name + ":", items.length + "件取得");
    else console.log(stock.code, stock.name + ": 0件");
  } catch (e) {
    console.log(stock.code, "ERROR:", e.message);
  }
}

console.log("\n=== 結果 ===");
console.log("保存:", saved, "| スキップ(重複):", skipped, "| エラー:", errors.length);
if (errors.length > 0) console.log("エラー詳細:", errors.slice(0, 5));

// 保存確認
const { count } = await supabase.from("articles").select("*", { count: "exact", head: true }).eq("source_type", "tdnet");
console.log("Supabase TDnet記事総数:", count);

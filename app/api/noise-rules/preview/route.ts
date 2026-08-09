import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// 保存前に「このルールが今何件の既存記事に一致するか」を確認するプレビュー。
// noise_rulesへの実際の保存は行わない(件数確認のみ)。
// TDnet/EDINET/公式(安全ソース)は本番の除外ロジックと同様に対象外とする。
const SAFE_SOURCE_TYPES = ["tdnet", "edinet", "official"];

interface RuleInput {
  stock_code?: string;
  stock_id?: string;
  scope?: "this_stock" | "all_stocks";
  match_type: "keyword" | "domain" | "url_pattern" | "publisher";
  match_value: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const inputs: RuleInput[] = body.rules ?? [body];
  if (!inputs.length) return NextResponse.json({ error: "No rules provided" }, { status: 400 });

  const results = [];
  for (const input of inputs) {
    let stockId: string | null = input.stock_id ?? null;
    if (!stockId && input.stock_code) {
      const { data: s } = await supabase.from("stocks").select("id").eq("code", input.stock_code).single();
      stockId = s?.id ?? null;
    }
    const scope = input.scope ?? (stockId ? "this_stock" : "all_stocks");
    const scopedToStock = scope === "this_stock" && !!stockId;

    // stock指定がある場合のみarticle_stocksをinner joinする(joinすると1記事が
    // 複数銘柄に紐づく場合に count が重複するため、絞り込まない時は付けない)
    let query = supabase
      .from("articles")
      .select(
        scopedToStock ? "id, article_stocks!inner(stock_id)" : "id",
        { count: "exact", head: true }
      )
      .not("source_type", "in", `(${SAFE_SOURCE_TYPES.join(",")})`);

    if (scopedToStock) {
      query = query.eq("article_stocks.stock_id", stockId as string);
    }

    const v = input.match_value;
    if (input.match_type === "keyword") {
      query = query.or(`title.ilike.%${v}%,summary.ilike.%${v}%`);
    } else if (input.match_type === "publisher") {
      query = query.ilike("publisher", `%${v}%`);
    } else {
      // domain / url_pattern: 完全なホスト名解析はしないため、URL全体への部分一致で近似する
      query = query.ilike("source_url", `%${v}%`);
    }

    const { count, error } = await query;
    results.push({
      match_type: input.match_type,
      match_value: input.match_value,
      scope,
      matched_count: error ? null : (count ?? 0),
      error: error?.message ?? null,
    });
  }

  return NextResponse.json({ results });
}

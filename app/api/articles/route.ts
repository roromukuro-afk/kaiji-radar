import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const stockId = searchParams.get("stock_id");
  const sourceType = searchParams.get("source_type");
  const isRead = searchParams.get("is_read");
  const relevance = searchParams.get("relevance");
  const search = searchParams.get("q");
  const limit = parseInt(searchParams.get("limit") ?? "50");
  const offset = parseInt(searchParams.get("offset") ?? "0");

  let query = supabase
    .from("articles")
    .select(`
      id, source_type, source_url, title, title_ja, publisher,
      published_at, fetched_at, summary, is_paywalled, is_overseas,
      is_read, is_update, is_pdf, doc_type, relevance, notification_sent,
      notification_failed_count, created_at,
      article_stocks!inner (stock_id, stocks!inner (id, code, name))
    `, { count: "exact" })
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (stockId) query = query.eq("article_stocks.stock_id", stockId);
  if (sourceType) query = query.eq("source_type", sourceType);
  if (isRead !== null) query = query.eq("is_read", isRead === "true");
  if (relevance) query = query.eq("relevance", relevance);
  if (search) {
    query = query.or(
      `title.ilike.%${search}%,summary.ilike.%${search}%,publisher.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, count, limit, offset });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { ids, is_read } = body;

  if (!ids || !Array.isArray(ids)) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  const updateData: Record<string, any> = { is_read };
  if (is_read) updateData.read_at = new Date().toISOString();

  const { error } = await supabase
    .from("articles")
    .update(updateData)
    .in("id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

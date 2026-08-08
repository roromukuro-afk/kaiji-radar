import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// GET一覧とPATCH(mark_all_read)で同じフィルター条件を使い回すための共通処理。
// ここがズレると「一覧に見えている条件」と「一括更新される条件」が食い違うバグになる。
function applyListFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  searchParams: URLSearchParams,
  opts: { includeIsRead?: boolean } = {}
) {
  const { includeIsRead = true } = opts;
  const stockId = searchParams.get("stock_id");
  const sourceType = searchParams.get("source_type");
  const isRead = searchParams.get("is_read");
  const relevance = searchParams.get("relevance");
  const search = searchParams.get("q");
  const isPaywalled = searchParams.get("is_paywalled");
  const isUpdate = searchParams.get("is_update");
  const isImportant = searchParams.get("is_important");
  const eventType = searchParams.get("event_type");
  const importance = searchParams.get("importance");
  const publishedAfter = searchParams.get("published_after");

  if (stockId) query = query.eq("article_stocks.stock_id", stockId);
  if (sourceType) query = query.eq("source_type", sourceType);
  if (includeIsRead && isRead !== null) query = query.eq("is_read", isRead === "true");
  if (relevance === "irrelevant") {
    query = query.or("user_relevance.eq.irrelevant,exclusion_candidate.eq.true");
  } else if (relevance) {
    query = query.eq("relevance", relevance);
  }
  if (isPaywalled === "true") query = query.eq("is_paywalled", true);
  if (isUpdate === "true") query = query.eq("is_update", true);
  if (isImportant === "true") query = query.eq("is_important", true);
  if (eventType) query = query.eq("event_type", eventType);
  if (importance) query = query.eq("importance", importance);
  if (publishedAfter) query = query.gte("published_at", publishedAfter);
  if (searchParams.get("exclude_irrelevant") === "true") query = query.neq("relevance", "irrelevant");
  if (search) {
    query = query.or(
      `title.ilike.%${search}%,summary.ilike.%${search}%,publisher.ilike.%${search}%`
    );
  }
  return query;
}

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
  const isPaywalled = searchParams.get("is_paywalled");
  const isUpdate = searchParams.get("is_update");
  const publishedAfter = searchParams.get("published_after");
  const limit = parseInt(searchParams.get("limit") ?? "50");
  const offset = parseInt(searchParams.get("offset") ?? "0");

  let query = supabase
    .from("articles")
    .select(`
      id, source_type, source_url, title, title_ja, publisher,
      published_at, fetched_at, summary, is_paywalled, is_overseas,
      is_read, is_update, is_pdf, doc_type, relevance, notification_sent,
      notification_failed_count, created_at, user_relevance, exclusion_candidate,
      is_important, event_type, importance, importance_reason, importance_source,
      article_stocks!inner (stock_id, stocks!inner (id, code, name))
    `, { count: "exact" })
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  query = applyListFilters(query, searchParams);

  const { data, error, count } = await query;

  if (error) {
    // Graceful fallback: if new columns don't exist, retry without them
    if (error.message.includes("user_relevance") || error.message.includes("exclusion_candidate")) {
      let fallbackQuery = supabase
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

      if (stockId) fallbackQuery = fallbackQuery.eq("article_stocks.stock_id", stockId);
      if (sourceType) fallbackQuery = fallbackQuery.eq("source_type", sourceType);
      if (isRead !== null) fallbackQuery = fallbackQuery.eq("is_read", isRead === "true");
      if (relevance && relevance !== "irrelevant") fallbackQuery = fallbackQuery.eq("relevance", relevance);
      if (isPaywalled === "true") fallbackQuery = fallbackQuery.eq("is_paywalled", true);
      if (isUpdate === "true") fallbackQuery = fallbackQuery.eq("is_update", true);
      if (publishedAfter) fallbackQuery = fallbackQuery.gte("published_at", publishedAfter);
      if (search) {
        fallbackQuery = fallbackQuery.or(
          `title.ilike.%${search}%,summary.ilike.%${search}%,publisher.ilike.%${search}%`
        );
      }

      const { data: fbData, error: fbError, count: fbCount } = await fallbackQuery;
      if (fbError) return NextResponse.json({ error: fbError.message }, { status: 500 });
      return NextResponse.json({ data: fbData, count: fbCount, limit, offset });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data, count, limit, offset });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const body = await request.json();

  if (body.mark_all_read === true) {
    // 現在表示中の50件だけでなく、フィルター条件に一致する未読記事を
    // DB側ですべて既読にする(Supabaseの1000件上限を避けるためID解決をページング)。
    const ids = new Set<string>();
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      let idQuery = supabase
        .from("articles")
        .select("id, article_stocks!inner(stock_id)")
        .eq("is_read", false)
        .range(offset, offset + PAGE - 1);
      idQuery = applyListFilters(idQuery, searchParams, { includeIsRead: false });

      const { data, error } = await idQuery;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      for (const row of data as { id: string }[]) ids.add(row.id);
      if (data.length < PAGE) break;
    }

    const idList = [...ids];
    const CHUNK = 500;
    for (let i = 0; i < idList.length; i += CHUNK) {
      const { error } = await supabase
        .from("articles")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in("id", idList.slice(i, i + CHUNK));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, updated: idList.length });
  }

  const { ids, is_read, importance } = body;

  if (!ids || !Array.isArray(ids)) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (is_read !== undefined) {
    updateData.is_read = is_read;
    if (is_read) updateData.read_at = new Date().toISOString();
  }
  if (importance !== undefined) {
    if (!["critical", "important", "normal"].includes(importance)) {
      return NextResponse.json({ error: "invalid importance value" }, { status: 400 });
    }
    updateData.importance = importance;
    updateData.importance_source = "manual";
    updateData.importance_overridden_at = new Date().toISOString();
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("articles")
    .update(updateData)
    .in("id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

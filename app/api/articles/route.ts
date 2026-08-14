import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// キーワード検索にPDF抽出本文(pdf_documents.extracted_text)も含めるため、
// 該当するpdf_document_idを1回だけ解決してフィルターへ渡す(呼び出し側でキャッシュする)。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveSearchPdfDocIds(supabase: any, search: string | null): Promise<string[]> {
  if (!search) return [];
  const { data } = await supabase
    .from("pdf_documents")
    .select("id")
    .ilike("extracted_text", `%${search}%`)
    .limit(500);
  return (data ?? []).map((d: { id: string }) => d.id);
}

// 既読状態は記事単位ではなく出来事単位で扱う: 対象記事が出来事に属する場合、
// 同じ出来事の他の記事(一覧には代表記事しか出ないため通常は非表示の記事)も
// まとめて既読にする。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function expandToEventGroupMembers(supabase: any, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return ids;
  const { data: rows } = await supabase
    .from("articles")
    .select("event_group_id")
    .in("id", ids)
    .not("event_group_id", "is", null);
  const groupIds = [...new Set((rows ?? []).map((r: { event_group_id: string }) => r.event_group_id))];
  if (groupIds.length === 0) return ids;

  const { data: memberRows } = await supabase
    .from("articles")
    .select("id")
    .in("event_group_id", groupIds);
  const expanded = new Set(ids);
  for (const row of (memberRows ?? []) as { id: string }[]) expanded.add(row.id);
  return [...expanded];
}

// GET一覧とPATCH(mark_all_read)で同じフィルター条件を使い回すための共通処理。
// ここがズレると「一覧に見えている条件」と「一括更新される条件」が食い違うバグになる。
function applyListFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  searchParams: URLSearchParams,
  opts: { includeIsRead?: boolean } = {},
  searchPdfDocIds: string[] = []
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
  const eventGroupId = searchParams.get("event_group_id");

  if (eventGroupId) {
    // 出来事の「関連記事N件」展開: そのグループの全記事を返す(代表記事のみフィルターは適用しない)
    query = query.eq("event_group_id", eventGroupId);
  } else {
    // 通常の一覧表示: 出来事の代表記事(または出来事に属さない記事)だけを表示する
    query = query.eq("is_event_representative", true);
  }
  if (stockId) query = query.eq("article_stocks.stock_id", stockId);
  if (sourceType) query = query.eq("source_type", sourceType);
  if (includeIsRead && isRead !== null) query = query.eq("is_read", isRead === "true");
  if (relevance === "irrelevant") {
    // 除外候補ビュー: ノイズルール一致・ユーザー報告のいずれかで除外対象になった記事だけを表示
    query = query.or("user_relevance.eq.irrelevant,user_relevance.eq.different_company,exclusion_candidate.eq.true");
  } else {
    // 通常表示: ノイズルール一致(exclusion_candidate)・ユーザーが無関係と報告した記事は隠す。
    // (これまでは一覧に「除外候補」バッジを付けるだけで表示自体は隠していなかったため、
    //  ノイズ判定が実質機能していなかった。確認したい場合は「除外候補」フィルターを選ぶ)
    query = query
      .not("exclusion_candidate", "is", true)
      .or("user_relevance.is.null,and(user_relevance.neq.irrelevant,user_relevance.neq.different_company)");
    if (relevance) query = query.eq("relevance", relevance);
  }
  if (isPaywalled === "true") query = query.eq("is_paywalled", true);
  if (isUpdate === "true") query = query.eq("is_update", true);
  if (isImportant === "true") query = query.eq("is_important", true);
  if (eventType) query = query.eq("event_type", eventType);
  if (importance) query = query.eq("importance", importance);
  if (publishedAfter) query = query.gte("published_at", publishedAfter);
  if (searchParams.get("exclude_irrelevant") === "true") query = query.neq("relevance", "irrelevant");
  if (search) {
    const searchOr = [
      `title.ilike.%${search}%`,
      `summary.ilike.%${search}%`,
      `publisher.ilike.%${search}%`,
    ];
    if (searchPdfDocIds.length > 0) {
      searchOr.push(`pdf_document_id.in.(${searchPdfDocIds.join(",")})`);
    }
    query = query.or(searchOr.join(","));
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
      event_group_id, is_event_representative, article_events (member_count),
      article_stocks!inner (stock_id, stocks!inner (id, code, name))
    `, { count: "exact" })
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const searchPdfDocIds = await resolveSearchPdfDocIds(supabase, search);
  query = applyListFilters(query, searchParams, {}, searchPdfDocIds);

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
    const searchPdfDocIds = await resolveSearchPdfDocIds(supabase, searchParams.get("q"));
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      let idQuery = supabase
        .from("articles")
        .select("id, article_stocks!inner(stock_id)")
        .eq("is_read", false)
        .range(offset, offset + PAGE - 1);
      idQuery = applyListFilters(idQuery, searchParams, { includeIsRead: false }, searchPdfDocIds);

      const { data, error } = await idQuery;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      for (const row of data as { id: string }[]) ids.add(row.id);
      if (data.length < PAGE) break;
    }

    const idList = await expandToEventGroupMembers(supabase, [...ids]);
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

  let didUpdate = false;

  // is_readは出来事単位で扱うため、対象を同一event_group_idの記事へ展開する。
  // importance(手動上書き)は記事ごとの個別判断のため展開しない。
  if (is_read !== undefined) {
    const readUpdate: Record<string, unknown> = { is_read };
    if (is_read) readUpdate.read_at = new Date().toISOString();
    const targetIds = is_read ? await expandToEventGroupMembers(supabase, ids) : ids;
    const { error } = await supabase.from("articles").update(readUpdate).in("id", targetIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    didUpdate = true;
  }

  // 手動上書き前の状態を記録しておく(規則ベース分類のチューニング材料にするため)
  let priorRows: { id: string; title: string; event_type: string | null; importance: string | null; importance_source: string | null }[] = [];
  if (importance !== undefined) {
    if (!["critical", "important", "normal"].includes(importance)) {
      return NextResponse.json({ error: "invalid importance value" }, { status: 400 });
    }
    const { data } = await supabase
      .from("articles")
      .select("id, title, event_type, importance, importance_source")
      .in("id", ids);
    priorRows = data ?? [];

    const { error } = await supabase
      .from("articles")
      .update({
        importance,
        importance_source: "manual",
        importance_overridden_at: new Date().toISOString(),
      })
      .in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    didUpdate = true;
  }

  if (!didUpdate) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  if (importance !== undefined && priorRows.length > 0) {
    // 規則/AI判定と手動判定がズレたケースだけ記録(既に人間が同じ判定を再選択しただけの場合は除く)
    const changed = priorRows.filter((r) => r.importance !== importance);
    if (changed.length > 0) {
      await supabase.from("operation_logs").insert(
        changed.map((r) => ({
          action: "importance_manual_override",
          target_id: r.id,
          result: "success",
          details: {
            title: r.title,
            event_type: r.event_type,
            previous_importance: r.importance,
            previous_source: r.importance_source,
            new_importance: importance,
          },
        }))
      );
    }
  }

  return NextResponse.json({ ok: true });
}

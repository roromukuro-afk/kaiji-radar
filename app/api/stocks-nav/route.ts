import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

interface ArticleLinkRow {
  stock_id: string;
  articles: Array<{
    id: string;
    is_read: boolean;
    published_at: string | null;
    created_at: string;
  }>;
}

interface UnreadLinkRow {
  stock_id: string;
  articles: Array<{
    id: string;
    is_read: boolean;
  }>;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch all non-deleted stocks
  const { data: stocks } = await supabase
    .from("stocks")
    .select("id, code, name, status")
    .neq("status", "deleted")
    .order("code");

  if (!stocks) return NextResponse.json([]);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Fetch article_stocks for articles created in the last 24h
  const { data: articleLinks } = await supabase
    .from("article_stocks")
    .select("stock_id, articles!inner(id, is_read, published_at, created_at)")
    .gte("articles.created_at", since24h);

  // Fetch article_stocks for unread articles
  const { data: unreadLinks } = await supabase
    .from("article_stocks")
    .select("stock_id, articles!inner(id, is_read)")
    .eq("articles.is_read", false);

  const nav = stocks.map((s) => {
    const new24h = ((articleLinks ?? []) as unknown as ArticleLinkRow[]).filter(
      (l) => l.stock_id === s.id
    ).length;
    const unread = ((unreadLinks ?? []) as unknown as UnreadLinkRow[]).filter(
      (l) => l.stock_id === s.id
    ).length;
    return {
      id: s.id as string,
      code: s.code as string,
      name: s.name as string,
      status: s.status as string,
      unread_count: unread,
      new_24h_count: new24h,
    };
  });

  return NextResponse.json(nav);
}

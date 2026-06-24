import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type FeedbackType =
  | "relevant"
  | "uncertain"
  | "irrelevant"
  | "different_company"
  | "weaken_domain"
  | "exclude_keyword"
  | "add_keyword"
  | "cancel";

interface FeedbackBody {
  article_id: string;
  stock_id: string;
  feedback_type: FeedbackType;
  target_keyword?: string;
  target_domain?: string;
  reason?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: FeedbackBody = await request.json();
  const { article_id, stock_id, feedback_type, target_keyword, target_domain, reason } = body;

  if (!article_id || !stock_id || !feedback_type) {
    return NextResponse.json({ error: "article_id, stock_id, and feedback_type are required" }, { status: 400 });
  }

  // Determine article update fields
  let articleUpdate: Record<string, unknown> | null = null;
  if (feedback_type === "relevant" || feedback_type === "uncertain") {
    articleUpdate = { user_relevance: feedback_type, exclusion_candidate: false };
  } else if (feedback_type === "irrelevant" || feedback_type === "different_company") {
    articleUpdate = { user_relevance: feedback_type, exclusion_candidate: true };
  } else if (feedback_type === "cancel") {
    articleUpdate = { user_relevance: null, exclusion_candidate: false };
  }

  // 1. Try to insert into relevance_feedback table
  let feedbackId: string | null = null;
  try {
    const { data: fbData, error: fbError } = await supabase
      .from("relevance_feedback")
      .insert({
        article_id,
        stock_id,
        user_id: user.id,
        feedback_type,
        target_keyword: target_keyword ?? null,
        target_domain: target_domain ?? null,
        reason: reason ?? null,
      })
      .select("id")
      .single();

    if (!fbError && fbData) {
      feedbackId = fbData.id as string;
    }
  } catch {
    // Table may not exist yet — log below
  }

  // 2. Update articles.user_relevance / exclusion_candidate
  if (articleUpdate) {
    try {
      await supabase.from("articles").update(articleUpdate).eq("id", article_id);
    } catch {
      // Columns may not exist yet — ignore
    }
  }

  // 3. Handle keyword/domain rules
  if (feedback_type === "exclude_keyword" || feedback_type === "add_keyword") {
    if (target_keyword) {
      try {
        await supabase.from("stock_keyword_rules").upsert(
          {
            stock_id,
            keyword: target_keyword,
            action: feedback_type === "exclude_keyword" ? "exclude" : "add",
            is_active: true,
            created_by: user.id,
          },
          { onConflict: "stock_id,keyword" }
        );
      } catch {
        // Table may not exist yet — continue
      }
    }
  }

  if (feedback_type === "weaken_domain" && target_domain) {
    try {
      await supabase.from("stock_keyword_rules").upsert(
        {
          stock_id,
          keyword: target_domain,
          action: "weaken_domain",
          is_active: true,
          created_by: user.id,
        },
        { onConflict: "stock_id,keyword" }
      );
    } catch {
      // Table may not exist yet — continue
    }
  }

  // 4. Log to operation_logs
  await supabase.from("operation_logs").insert({
    action: "relevance_feedback",
    target_id: article_id,
    result: "success",
    details: {
      stock_id,
      feedback_type,
      target_keyword: target_keyword ?? null,
      target_domain: target_domain ?? null,
      reason: reason ?? null,
      feedback_id: feedbackId,
    },
  });

  return NextResponse.json({ ok: true, feedback_id: feedbackId });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  // GET /api/feedback?type=log&limit=50 — feedback log list
  if (type === "log") {
    const limit = parseInt(searchParams.get("limit") ?? "50");
    const { data, error } = await supabase
      .from("operation_logs")
      .select("*")
      .eq("action", "relevance_feedback")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ data: [], error: error.message });
    return NextResponse.json({ data: data ?? [] });
  }

  // GET /api/feedback?type=rules — keyword rules list
  if (type === "rules") {
    try {
      const { data, error } = await supabase
        .from("stock_keyword_rules")
        .select(`*, stocks (id, code, name)`)
        .order("created_at", { ascending: false });

      if (error) return NextResponse.json({ data: [] });
      return NextResponse.json({ data: data ?? [] });
    } catch {
      return NextResponse.json({ data: [] });
    }
  }

  // GET /api/feedback?article_id=X&stock_id=Y — single article feedback
  const article_id = searchParams.get("article_id");
  const stock_id = searchParams.get("stock_id");

  if (!article_id) {
    return NextResponse.json({ error: "article_id required" }, { status: 400 });
  }

  let feedback: unknown[] = [];
  try {
    const fbQuery = supabase
      .from("relevance_feedback")
      .select("*")
      .eq("article_id", article_id)
      .order("created_at", { ascending: false });

    if (stock_id) fbQuery.eq("stock_id", stock_id);

    const { data: fbData } = await fbQuery;
    feedback = fbData ?? [];
  } catch {
    // Table doesn't exist yet
    const { data: logData } = await supabase
      .from("operation_logs")
      .select("*")
      .eq("action", "relevance_feedback")
      .eq("target_id", article_id)
      .order("created_at", { ascending: false })
      .limit(10);

    feedback = (logData ?? []).filter((log) => {
      if (!stock_id) return true;
      return log.details?.stock_id === stock_id;
    });
  }

  // Also fetch article's user_relevance
  let userRelevance: string | null = null;
  try {
    const { data: artData } = await supabase
      .from("articles")
      .select("user_relevance")
      .eq("id", article_id)
      .single();
    userRelevance = artData?.user_relevance ?? null;
  } catch {
    // Column doesn't exist
  }

  return NextResponse.json({ feedback, user_relevance: userRelevance });
}

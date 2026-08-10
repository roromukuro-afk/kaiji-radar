import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const VALID_ACTIONS = new Set(["notify", "save_only", "no_notify"]);

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get("include_inactive") === "true";

  let query = supabase
    .from("notification_rules")
    .select("*, stocks (id, code, name)")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });
  if (!includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { stock_id, importance, event_type, source_type, keyword, action, priority, reason } = body;

  if (!action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json({ error: "action must be one of notify/save_only/no_notify" }, { status: 400 });
  }
  if (!stock_id && !importance && !event_type && !source_type && !keyword) {
    return NextResponse.json({ error: "少なくとも1つの条件(銘柄・重要度・開示種別・情報源・キーワード)が必要です" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("notification_rules")
    .insert({
      stock_id: stock_id || null,
      importance: importance || null,
      event_type: event_type || null,
      source_type: source_type || null,
      keyword: keyword?.trim() || null,
      action,
      priority: Number.isFinite(priority) ? priority : 0,
      reason: reason?.trim() || null,
    })
    .select("*, stocks (id, code, name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { id, is_active } = body;
  if (!id || typeof is_active !== "boolean") {
    return NextResponse.json({ error: "id and boolean is_active required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("notification_rules")
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("notification_rules").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

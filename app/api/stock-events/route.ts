import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const EVENT_TYPES = new Set(["earnings", "agm", "dividend_record", "other"]);

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const stockId = searchParams.get("stock_id");
  const from = searchParams.get("from"); // YYYY-MM-DD
  const to = searchParams.get("to"); // YYYY-MM-DD

  let query = supabase
    .from("stock_events")
    .select("*, stocks (id, code, name), articles (id, title, published_at)")
    .order("scheduled_date", { ascending: true });

  if (stockId) query = query.eq("stock_id", stockId);
  if (from) query = query.gte("scheduled_date", from);
  if (to) query = query.lte("scheduled_date", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { stock_id, event_type, title, scheduled_date, note } = body;

  if (!stock_id || !event_type || !title || !scheduled_date) {
    return NextResponse.json({ error: "stock_id, event_type, title, scheduled_date required" }, { status: 400 });
  }
  if (!EVENT_TYPES.has(event_type)) {
    return NextResponse.json({ error: "invalid event_type" }, { status: 400 });
  }
  if (Number.isNaN(new Date(scheduled_date).getTime())) {
    return NextResponse.json({ error: "invalid scheduled_date" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("stock_events")
    .insert({ stock_id, event_type, title: title.trim(), scheduled_date, note: note?.trim() || null })
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
  const { id, status, scheduled_date, title, note, unlink } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    if (!["scheduled", "postponed"].includes(status)) {
      return NextResponse.json({ error: "status must be scheduled or postponed" }, { status: 400 });
    }
    updateData.status = status;
  }
  if (scheduled_date !== undefined) updateData.scheduled_date = scheduled_date;
  if (title !== undefined) updateData.title = title.trim();
  if (note !== undefined) updateData.note = note?.trim() || null;
  if (unlink === true) updateData.linked_article_id = null;

  const { error } = await supabase.from("stock_events").update(updateData).eq("id", id);
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

  const { error } = await supabase.from("stock_events").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

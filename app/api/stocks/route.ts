import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("stocks")
    .select("*, stock_profiles(*)")
    .neq("status", "deleted")
    .order("code");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { code, name, name_en, edinet_code, sec_code } = body;

  if (!code || !name) {
    return NextResponse.json({ error: "code and name are required" }, { status: 400 });
  }

  const { data: stock, error } = await supabase
    .from("stocks")
    .insert({ code, name, name_en, edinet_code, sec_code: sec_code ?? `${code}0` })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("stock_profiles").insert({ stock_id: stock.id });
  await supabase.from("operation_logs").insert({
    action: "add_stock",
    target_id: code,
    target_name: name,
    result: "success",
  });

  return NextResponse.json(stock);
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { id, action } = body;

  if (!id || !action) {
    return NextResponse.json({ error: "id and action required" }, { status: 400 });
  }

  let updateData: Record<string, any> = {};
  let logAction = "";

  if (action === "pause") {
    updateData = { status: "paused" };
    logAction = "pause_stock";
  } else if (action === "resume") {
    updateData = { status: "active" };
    logAction = "resume_stock";
  } else if (action === "remove_from_list") {
    updateData = { status: "removed", removed_at: new Date().toISOString(), removed_type: "remove_from_list" };
    logAction = "remove_stock_from_list";
  } else if (action === "full_delete") {
    // Delete article_stocks first, then stock
    await supabase.from("article_stocks").delete().eq("stock_id", id);
    await supabase.from("stock_profiles").delete().eq("stock_id", id);
    const { error } = await supabase.from("stocks").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabase.from("operation_logs").insert({
      action: "full_delete_stock",
      target_id: id,
      result: "success",
    });
    return NextResponse.json({ ok: true });
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const { error } = await supabase.from("stocks").update(updateData).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("operation_logs").insert({
    action: logAction,
    target_id: id,
    result: "success",
  });

  return NextResponse.json({ ok: true });
}

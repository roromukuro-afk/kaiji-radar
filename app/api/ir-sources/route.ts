import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// 企業IRページ直接監視(新規実装2)の登録・パイロット有効化を管理するAPI。
// 追加直後はenabled=falseとし、パイロット対象として明示的に有効化した銘柄のみ
// 毎時巡回の対象になる(いきなり全銘柄で未検証のスクレイピングを走らせない)。
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { stock_id, url } = await request.json();
  if (!stock_id || !url) {
    return NextResponse.json({ error: "stock_id and url required" }, { status: 400 });
  }
  try { new URL(url); } catch {
    return NextResponse.json({ error: `不正なURL: ${url}` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("stock_ir_sources")
    .insert({ stock_id, url, enabled: false })
    .select("id, url, enabled, last_checked_at, last_success_at, consecutive_failures, last_error")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "このURLは既に登録済みです" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, enabled } = await request.json();
  if (!id || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "id and boolean enabled required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("stock_ir_sources")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("operation_logs").insert({
    action: enabled ? "enable_ir_source" : "disable_ir_source",
    target_id: id,
    result: "success",
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("stock_ir_sources").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

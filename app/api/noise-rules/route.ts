import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Safe sources — never returned as excluded even if rules match
const SAFE_SOURCE_TYPES = new Set(["tdnet", "edinet", "official"]);

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function matchesRule(
  matchType: string,
  matchValue: string,
  title: string,
  summary: string | null,
  url: string,
  publisher: string | null
): boolean {
  const text = (title + " " + (summary ?? "")).toLowerCase();
  const mv = matchValue.toLowerCase();
  switch (matchType) {
    case "keyword":    return text.includes(mv);
    case "domain":     return extractDomain(url).includes(mv);
    case "url_pattern":return url.toLowerCase().includes(mv);
    case "publisher":  return (publisher ?? "").toLowerCase().includes(mv);
    default:           return false;
  }
}

// =====================
// GET /api/noise-rules
// ?stock_id=X &rule_type=X &match_type=X &include_inactive=true
// =====================
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const stockId        = searchParams.get("stock_id");
  const ruleType       = searchParams.get("rule_type");
  const matchType      = searchParams.get("match_type");
  const includeInactive = searchParams.get("include_inactive") === "true";
  const stockCode      = searchParams.get("stock_code");

  try {
    let query = supabase
      .from("noise_rules")
      .select("*, stocks(id, code, name)")
      .order("created_at", { ascending: false });

    if (!includeInactive) query = query.eq("is_active", true);
    if (stockId)   query = query.or(`stock_id.eq.${stockId},scope.eq.all_stocks`);
    if (ruleType)  query = query.eq("rule_type", ruleType);
    if (matchType) query = query.eq("match_type", matchType);

    if (stockCode && !stockId) {
      // Resolve stock_id from code
      const { data: s } = await supabase.from("stocks").select("id").eq("code", stockCode).single();
      if (s) {
        query = supabase
          .from("noise_rules")
          .select("*, stocks(id, code, name)")
          .or(`stock_id.eq.${s.id},scope.eq.all_stocks`)
          .order("created_at", { ascending: false });
        if (!includeInactive) query = query.eq("is_active", true);
        if (ruleType)  query = query.eq("rule_type", ruleType);
        if (matchType) query = query.eq("match_type", matchType);
      }
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ data: [], error: error.message });
    return NextResponse.json({ data: data ?? [] });
  } catch {
    return NextResponse.json({ data: [] });
  }
}

// =====================
// POST /api/noise-rules
// Create one or multiple rules
// Body: { stock_code?, stock_id?, rule_type, match_type, match_value, reason?, scope?, language?, rule_name? }
//   OR  { rules: [...] }  for batch
// =====================
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  // Normalize to array
  const inputs: {
    stock_code?: string;
    stock_id?: string;
    rule_name?: string;
    rule_type: string;
    match_type: string;
    match_value: string;
    language?: string;
    scope?: string;
    reason?: string;
  }[] = body.rules ?? [body];

  if (!inputs.length) {
    return NextResponse.json({ error: "No rules provided" }, { status: 400 });
  }

  const rows: Record<string, unknown>[] = [];

  for (const input of inputs) {
    let stockId: string | null = input.stock_id ?? null;

    if (!stockId && input.stock_code) {
      const { data: s } = await supabase
        .from("stocks")
        .select("id")
        .eq("code", input.stock_code)
        .single();
      stockId = s?.id ?? null;
    }

    const scope = input.scope ?? (stockId ? "this_stock" : "all_stocks");

    rows.push({
      stock_id: stockId,
      scope,
      rule_name: input.rule_name ?? null,
      rule_type: input.rule_type,
      match_type: input.match_type,
      match_value: input.match_value,
      language: input.language ?? "any",
      reason: input.reason ?? null,
      created_by: user.email ?? "user",
    });
  }

  const { data: inserted, error } = await supabase
    .from("noise_rules")
    .insert(rows)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log
  await supabase.from("operation_logs").insert({
    action: "add_noise_rule",
    result: "success",
    details: { inserted_count: inserted?.length ?? 0, created_by: user.email },
  });

  return NextResponse.json({ ok: true, inserted: inserted ?? [] });
}

// =====================
// PATCH /api/noise-rules
// Update a rule (enable/disable/edit)
// Body: { id, is_active?, reason?, match_value?, rule_name? }
// =====================
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const allowed = ["is_active", "reason", "match_value", "rule_name", "rule_type", "language", "scope"];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (k in updates) patch[k] = updates[k];
  }

  const { error } = await supabase.from("noise_rules").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// =====================
// DELETE /api/noise-rules?id=X
// =====================
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("noise_rules").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

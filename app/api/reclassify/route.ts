import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { runReclassify } from "@/lib/reclassify";

/**
 * POST /api/reclassify
 * Body: { stock_id?, rule_id?, dry_run?, restore? }
 * - dry_run=true: count only, no DB writes
 * - restore=true: revert auto-exclusion to not excluded
 *
 * ロジック本体は lib/reclassify.ts に一本化(scripts/reclassify-articles.ts と共通)。
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Use service role key for bulk updates (bypasses RLS)
  const adminClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const body = await request.json().catch(() => ({}));
  const { stock_id, rule_id, dry_run = false, restore = false } = body;

  const result = await runReclassify(adminClient, {
    stockId: stock_id,
    ruleId: rule_id,
    dryRun: dry_run,
    restore,
  });

  return NextResponse.json({
    ok: true,
    dry_run,
    restore,
    stats: {
      scanned: result.scanned,
      marked: result.marked,
      restored: result.restored,
      skipped: result.skipped,
    },
  });
}

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [healthRes, jobsRes, storageRes, settingsRes, logsRes] = await Promise.all([
    supabase.from("health_checks").select("*").order("source"),
    supabase.from("fetch_jobs").select("*").order("started_at", { ascending: false }).limit(10),
    supabase.from("backup_logs").select("*").order("started_at", { ascending: false }).limit(5),
    supabase.from("system_settings").select("*").eq("key", "last_hourly_run"),
    supabase.from("operation_logs").select("*").order("created_at", { ascending: false }).limit(20),
  ]);

  // Estimate storage usage
  const { data: pdfCount } = await supabase
    .from("pdf_documents")
    .select("file_size_bytes")
    .not("file_size_bytes", "is", null);

  const totalPdfBytes = (pdfCount ?? []).reduce(
    (sum: number, p: any) => sum + (p.file_size_bytes ?? 0),
    0
  );

  return NextResponse.json({
    health_checks: healthRes.data ?? [],
    recent_jobs: jobsRes.data ?? [],
    recent_backups: storageRes.data ?? [],
    last_hourly_run: settingsRes.data?.[0]?.value ?? null,
    storage_bytes: totalPdfBytes,
    operation_logs: logsRes.data ?? [],
  });
}

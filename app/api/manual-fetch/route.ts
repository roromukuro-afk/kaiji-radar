import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Manual fetch triggers GitHub Actions dispatch (or calls worker directly in Vercel)
// Since we run workers via GitHub Actions, we record the request and notify user
// In production, this can trigger a GitHub Actions workflow_dispatch

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Check for ongoing job (debounce)
  const { count } = await supabase
    .from("fetch_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "running");

  if (count && count > 0) {
    return NextResponse.json({ error: "fetch_in_progress" }, { status: 429 });
  }

  // Trigger GitHub Actions via repository_dispatch (or workflow_dispatch)
  const ghToken = process.env.GITHUB_ACTIONS_TOKEN;
  const ghRepo = process.env.GITHUB_REPOSITORY; // e.g. "roromukuro/kaiji-radar"

  if (ghToken && ghRepo) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${ghRepo}/actions/workflows/hourly-fetch.yml/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ref: "main" }),
        }
      );
      if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    } catch (err) {
      console.error("[manual-fetch] GitHub dispatch 失敗:", err);
      // Fall through - log the attempt anyway
    }
  }

  // Log the manual fetch request
  await supabase.from("operation_logs").insert({
    action: "manual_fetch",
    result: "success",
    details: { triggered_by: user.email },
  });

  return NextResponse.json({ ok: true, message: "手動更新を開始しました" });
}

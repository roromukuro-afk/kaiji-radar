import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const allowedEmail = process.env.ALLOWED_EMAIL;
  if (user.email !== allowedEmail) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}

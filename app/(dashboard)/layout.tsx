"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const NAV = [
  { href: "/", label: "新着", icon: "📋" },
  { href: "/manage", label: "銘柄", icon: "🏢" },
  { href: "/status", label: "状態", icon: "📊" },
  { href: "/history", label: "履歴", icon: "📝" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top header */}
      <header className="sticky top-0 z-40 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 safe-top">
        <div className="max-w-3xl mx-auto px-4 h-12 flex items-center justify-between">
          <span className="font-semibold text-base tracking-tight">開示レーダー</span>
          <button
            onClick={handleSignOut}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            ログアウト
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-4">
        {children}
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="sticky bottom-0 z-40 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 safe-bottom">
        <div className="max-w-3xl mx-auto grid grid-cols-4">
          {NAV.map((item) => {
            const active = item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center py-2 text-xs gap-0.5 transition-colors ${
                  active
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                <span className="text-lg leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

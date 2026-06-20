"use client";

import { createClient } from "@/lib/supabase/client";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useCallback } from "react";
import Script from "next/script";

declare global {
  interface Window {
    google: {
      accounts: {
        id: {
          initialize: (config: object) => void;
          renderButton: (element: HTMLElement, config: object) => void;
        };
      };
    };
  }
}

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const router = useRouter();

  const handleCredential = useCallback(
    async (response: { credential: string }) => {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: response.credential,
      });
      if (signInError) {
        router.push("/login?error=auth_failed");
        return;
      }
      const verifyResp = await fetch("/api/auth/verify", { method: "POST" });
      if (!verifyResp.ok) {
        const body = await verifyResp.json().catch(() => ({}));
        router.push(`/login?error=${body.error ?? "auth_failed"}`);
      } else {
        router.push("/");
      }
    },
    [router]
  );

  const initGIS = useCallback(() => {
    window.google?.accounts?.id?.initialize({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      callback: handleCredential,
      auto_select: true,
    });
    const btn = document.getElementById("google-signin-btn");
    if (btn) {
      window.google.accounts.id.renderButton(btn, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "pill",
        locale: "ja",
        width: 320,
      });
    }
  }, [handleCredential]);

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={initGIS}
      />
      <main className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-950 px-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            <div className="text-4xl mb-3">📡</div>
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              開示レーダー
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              日本株 適時開示・IR・ニュース監視
            </p>
          </div>

          {error === "unauthorized" && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              このGoogleアカウントはアクセスが許可されていません。
            </div>
          )}

          {error === "auth_failed" && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              認証に失敗しました。もう一度お試しください。
            </div>
          )}

          <div id="google-signin-btn" className="flex justify-center" />

          <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
            許可されたGoogleアカウントのみアクセス可能です
          </p>
        </div>
      </main>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

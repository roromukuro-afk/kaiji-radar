"use client";

import { useEffect, useState } from "react";

export function PushNotificationButton() {
  const [state, setState] = useState<"loading" | "unsupported" | "denied" | "subscribed" | "unsubscribed">("loading");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    Notification.requestPermission().then((perm) => {
      if (perm === "denied") { setState("denied"); return; }
    });
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "subscribed" : "unsubscribed");
    });
  }, []);

  async function subscribe() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    });
    await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    setState("subscribed");
  }

  async function unsubscribe() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      await fetch("/api/push", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    }
    setState("unsubscribed");
  }

  if (state === "loading") return null;
  if (state === "unsupported") return (
    <span className="text-xs text-zinc-400">プッシュ通知非対応</span>
  );
  if (state === "denied") return (
    <span className="text-xs text-zinc-400">通知がブロックされています</span>
  );

  return (
    <button
      onClick={state === "subscribed" ? unsubscribe : subscribe}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm ${
        state === "subscribed"
          ? "border-green-300 dark:border-green-700 text-green-700 dark:text-green-300"
          : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
      }`}
    >
      {state === "subscribed" ? "通知ON" : "通知OFF"}
    </button>
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

"use client";

import { useEffect, useRef } from "react";

interface Props {
  articleId: string;
  isRead: boolean;
}

// 記事詳細の閲覧(GET)自体には副作用を持たせず、クライアント側から明示的に
// 既読化APIを呼ぶ。マウント時1回のみ・すでに既読なら呼ばない。
export function MarkAsRead({ articleId, isRead }: Props) {
  const sent = useRef(false);

  useEffect(() => {
    if (isRead || sent.current) return;
    sent.current = true;
    fetch("/api/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [articleId], is_read: true }),
    }).catch(() => {
      sent.current = false;
    });
  }, [articleId, isRead]);

  return null;
}

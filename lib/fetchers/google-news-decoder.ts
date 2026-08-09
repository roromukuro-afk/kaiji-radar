/**
 * Google News RSSのリダイレクトリンク (news.google.com/rss/articles/CBMi...) を
 * 配信元の実記事URLへ解決する。
 *
 * Googleの非公開・非公式な内部エンドポイントに依存しており(公式APIは存在しない)、
 * Google側の実装変更で壊れる可能性がある。失敗時は null を返し、呼び出し側は
 * 元のGoogle Newsリンクをそのまま使い続ける(処理は止めない)。
 *
 * 手順 (参考: https://github.com/SSujitX/google-news-url-decoder):
 *   1. リンクのパスから base64 風の記事IDを取り出す
 *   2. 記事ページのHTMLから署名(data-n-a-sg)とタイムスタンプ(data-n-a-ts)を取得
 *   3. Googleの内部 batchexecute エンドポイントへPOSTし、実URLを含む応答を得る
 *
 * コスト・リスク上、全候補ではなく「保存が確定した記事」だけに適用すること。
 */

import { parse as parseHtml } from "node-html-parser";
import { isGoogleNewsCircuitOpen, recordGoogleNewsFailure, recordGoogleNewsSuccess } from "./news.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const TIMEOUT_MS = 8000;

// 今回の実行でのURL解決試行・失敗件数(状態画面に表示するため)。
// worker起動ごとにモジュールが再ロードされるため、実行間で自動的にリセットされる。
let resolveAttempts = 0;
let resolveFailures = 0;

export function getResolveStats(): { attempts: number; failures: number } {
  return { attempts: resolveAttempts, failures: resolveFailures };
}

export function isGoogleNewsUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "news.google.com";
  } catch {
    return false;
  }
}

function extractArticleId(googleNewsUrl: string): string | null {
  try {
    const u = new URL(googleNewsUrl);
    if (u.hostname !== "news.google.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const marker = parts[parts.length - 2];
    if (marker !== "articles" && marker !== "read") return null;
    return parts[parts.length - 1] ?? null;
  } catch {
    return null;
  }
}

async function fetchDecodingParams(
  articleId: string
): Promise<{ signature: string; timestamp: string } | null> {
  const candidateUrls = [
    `https://news.google.com/articles/${articleId}`,
    `https://news.google.com/rss/articles/${articleId}`,
  ];

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const html = await res.text();

      const root = parseHtml(html);
      const el =
        root.querySelector("c-wiz > div[jscontroller]") ??
        root.querySelector("div[data-n-a-sg]");
      let signature = el?.getAttribute("data-n-a-sg");
      let timestamp = el?.getAttribute("data-n-a-ts");

      // querySelector が拾えなかった場合の保険 (HTML構造の細かな変化に対する耐性)
      if (!signature || !timestamp) {
        signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
        timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
      }

      if (signature && timestamp) return { signature, timestamp };
    } catch {
      // 次の候補URLを試す
    }
  }
  return null;
}

async function decodeViaBatchExecute(
  signature: string,
  timestamp: string,
  articleId: string
): Promise<string | null> {
  try {
    const innerPayload = JSON.stringify([
      "garturlreq",
      [
        ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
        "X",
        "X",
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0,
      ],
      articleId,
      Number(timestamp),
      signature,
    ]);
    const fReq = JSON.stringify([[["Fbv4je", innerPayload]]]);

    const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": UA,
      },
      body: `f.req=${encodeURIComponent(fReq)}`,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const text = await res.text();
    const parts = text.split("\n\n");
    if (parts.length < 2) return null;

    const parsed = JSON.parse(parts[1]);
    const trimmed = parsed.slice(0, -2);
    const inner = JSON.parse(trimmed[0][2]);
    const decodedUrl = inner?.[1];
    return typeof decodedUrl === "string" ? decodedUrl : null;
  } catch {
    return null;
  }
}

/**
 * Google Newsのリダイレクトリンクを配信元の実記事URLへ解決する。
 * 解決できない場合(非Google Newsリンク・タイムアウト・仕様変更等)は null。
 */
export async function resolveGoogleNewsUrl(googleNewsUrl: string): Promise<string | null> {
  // Google News検索自体が連続失敗中(レート制限/一時ブロック)なら、
  // この解決処理もどうせ失敗する可能性が高いのでスキップして時間を浪費しない。
  if (isGoogleNewsCircuitOpen()) return null;

  const articleId = extractArticleId(googleNewsUrl);
  if (!articleId) return null;

  resolveAttempts++;

  const params = await fetchDecodingParams(articleId);
  if (!params) {
    recordGoogleNewsFailure();
    resolveFailures++;
    return null;
  }

  const decoded = await decodeViaBatchExecute(params.signature, params.timestamp, articleId);
  if (decoded) {
    recordGoogleNewsSuccess();
  } else {
    recordGoogleNewsFailure();
    resolveFailures++;
  }
  return decoded;
}

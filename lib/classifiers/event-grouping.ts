/**
 * 同一事象の記事統合(新規実装1)
 *
 * 同じ決算・提携・訂正等の「出来事」を`article_events`に集約する。
 * 判定方法:
 *   1. 同一銘柄・同一event_type・日付が近い(±5日)候補を検索
 *   2. タイトルの類似度(文字2-gramのJaccard係数)が高ければ機械的に同一事象と判定
 *   3. 類似度が曖昧な範囲のときだけGeminiに判定させる(株価判断は行わない)
 *   4. どれにも一致しなければ新しい出来事を作る
 * TDnet/EDINET/公式を代表記事として優先し、後から到着してもそちらへ差し替える。
 */

import { callGemini } from "../ai/gemini.js";

const WINDOW_DAYS = 5;
const HIGH_SIMILARITY = 0.5;
const LOW_SIMILARITY = 0.2;

const SAFE_SOURCE_TYPES = new Set(["tdnet", "edinet", "official"]);

function tokenize(title: string): Set<string> {
  const clean = title.replace(/[【】[\]()（）「」\s　:：、,，。.]/g, "");
  const grams = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) grams.add(clean.slice(i, i + 2));
  return grams;
}

function titleSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const g of setA) if (setB.has(g)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface CandidateEvent {
  id: string;
  title: string;
  representative_article_id: string | null;
  representative_is_safe_source: boolean;
  member_count: number;
}

export interface GroupingParams {
  stockId: string;
  eventType: string;
  title: string;
  summary?: string | null;
  publishedAt?: string | null;
  articleId: string;
  sourceType: string;
}

export interface GroupingResult {
  eventGroupId: string;
  isRepresentative: boolean;
  /** 昇格により代表の座を明け渡した旧代表記事のID(is_event_representative=falseへ更新が必要) */
  demotedArticleId: string | null;
}

/**
 * 曖昧な類似度のときだけAIに「同じ出来事か」を尋ねる。投資判断は問わない。
 */
async function judgeSameEventByAI(titleA: string, titleB: string): Promise<boolean> {
  const { text } = await callGemini(
    `次の2つの企業開示・ニュースのタイトルは、同じ出来事(同じ決算発表・同じ業務提携・同じ不祥事など)について書かれたものですか。株価への影響は判断しないでください。\n\nタイトルA: ${titleA}\nタイトルB: ${titleB}\n\n"yes"または"no"のみで回答してください。`,
    10
  );
  return !!text && /yes/i.test(text.trim());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findOrCreateEventGroup(supabase: any, params: GroupingParams): Promise<GroupingResult> {
  const occurredAt = params.publishedAt ?? new Date().toISOString();
  const windowStart = new Date(new Date(occurredAt).getTime() - WINDOW_DAYS * 86400000).toISOString();
  const windowEnd = new Date(new Date(occurredAt).getTime() + WINDOW_DAYS * 86400000).toISOString();
  const isSafe = SAFE_SOURCE_TYPES.has(params.sourceType);

  const { data: candidates } = await supabase
    .from("article_events")
    .select("id, title, representative_article_id, representative_is_safe_source, member_count")
    .eq("stock_id", params.stockId)
    .eq("event_type", params.eventType)
    .gte("occurred_at", windowStart)
    .lte("occurred_at", windowEnd)
    .limit(20);

  const list: CandidateEvent[] = candidates ?? [];

  let bestMatch: CandidateEvent | null = null;
  let bestScore = 0;
  for (const c of list) {
    const score = titleSimilarity(params.title, c.title);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = c;
    }
  }

  let matched: CandidateEvent | null = null;
  if (bestMatch && bestScore >= HIGH_SIMILARITY) {
    matched = bestMatch;
  } else if (bestMatch && bestScore >= LOW_SIMILARITY && params.eventType !== "other") {
    // "other"分類は事象特定性が低く誤爆しやすいため、曖昧域でのAI判定は対象外にする
    if (await judgeSameEventByAI(bestMatch.title, params.title)) {
      matched = bestMatch;
    }
  }

  if (matched) {
    const becomesRepresentative = isSafe && !matched.representative_is_safe_source;
    const demotedArticleId = becomesRepresentative ? matched.representative_article_id : null;

    const updatePayload: Record<string, unknown> = {
      member_count: matched.member_count + 1,
      updated_at: new Date().toISOString(),
    };
    if (becomesRepresentative) {
      updatePayload.representative_article_id = params.articleId;
      updatePayload.representative_is_safe_source = true;
      updatePayload.title = params.title;
    }

    await supabase.from("article_events").update(updatePayload).eq("id", matched.id);
    return { eventGroupId: matched.id, isRepresentative: becomesRepresentative, demotedArticleId };
  }

  // 新しい出来事を作成(最初の1件は常にその時点の代表)
  const { data: created } = await supabase
    .from("article_events")
    .insert({
      stock_id: params.stockId,
      event_type: params.eventType,
      representative_article_id: params.articleId,
      representative_is_safe_source: isSafe,
      title: params.title,
      occurred_at: occurredAt,
      member_count: 1,
    })
    .select("id")
    .single();

  return { eventGroupId: created!.id, isRepresentative: true, demotedArticleId: null };
}

/**
 * 出来事への初回通知を記録する。既に通知済みなら false を返し、呼び出し側は通知をスキップする。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function tryMarkEventNotified(supabase: any, eventGroupId: string): Promise<boolean> {
  const { data: event } = await supabase
    .from("article_events")
    .select("notified_at")
    .eq("id", eventGroupId)
    .single();
  if (event?.notified_at) return false;
  await supabase.from("article_events").update({ notified_at: new Date().toISOString() }).eq("id", eventGroupId);
  return true;
}

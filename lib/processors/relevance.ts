/**
 * AI 関連性判定 (Google Gemini API・無料枠)
 *
 * 判定結果: 'certain' | 'uncertain' | 'irrelevant'
 * - 'irrelevant' のみ通知除外 (除外ログへ記録)
 * - 'uncertain' も通知する (表示に「関連不確実」を付与)
 *
 * コスト最小化のためGemini Flash(無料枠)を使用。
 * 関連性判定にのみ使用し、投資判断・重要度評価は行わない。
 */

import { callGemini } from "../ai/gemini";

export type RelevanceResult = "certain" | "uncertain" | "irrelevant";

export interface RelevanceCheck {
  result: RelevanceResult;
  reason: string;
  titleJa?: string;
}

export async function checkRelevance(
  articleTitle: string,
  articleSummary: string | null,
  stockCode: string,
  stockName: string,
  stockKeywords: string[]
): Promise<RelevanceCheck> {
  const keywordStr = stockKeywords.slice(0, 20).join("、");

  const prompt = `次の記事と日本株銘柄の関連性を判定してください。

銘柄: ${stockCode} ${stockName}
関連キーワード: ${keywordStr}

記事タイトル: ${articleTitle}
記事概要: ${articleSummary ?? "(概要なし)"}

以下のJSON形式のみで回答してください:
{"result": "certain"|"uncertain"|"irrelevant", "reason": "理由（30文字以内）"}

判定基準:
- "certain": 会社名、銘柄コード、ブランド、子会社、取引先との具体的関係が明確で、かつ投資家がこの上場企業の状況を把握する上で意味のある内容
- "uncertain": 関連する可能性があるが断定できない
- "irrelevant": 明らかに無関係（同名の別会社、無関係な話題）。プロ野球球団など、この企業が命名権・冠スポンサーを持つだけの対象(球団・チーム・施設等)についての、試合結果・選手個人の成績やコメント・出場記録・怪我等のスポーツニュースは、たとえ球団名にこの企業のブランド名が含まれていても "irrelevant" とすること。ただし球団の売却・買収、命名権契約自体、球団運営が本業の業績に与える影響など、企業の経営・財務に関わる内容は対象外(certain/uncertain)。

注意: 投資判断・重要度は評価しないこと。`;

  const { text, error } = await callGemini(prompt, 150);
  if (!text) {
    console.error("[Relevance] AI判定失敗:", error);
    // AI失敗時は 'uncertain' として通知する (取りこぼし防止)
    return { result: "uncertain", reason: "AI判定失敗" };
  }

  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    if (!["certain", "uncertain", "irrelevant"].includes(parsed.result)) {
      return { result: "uncertain", reason: "判定エラー" };
    }
    return {
      result: parsed.result as RelevanceResult,
      reason: parsed.reason ?? "",
    };
  } catch (err) {
    console.error("[Relevance] AI応答のパース失敗:", err, text);
    return { result: "uncertain", reason: "判定エラー" };
  }
}

export async function translateTitleJa(englishTitle: string): Promise<string> {
  const { text } = await callGemini(
    `次の英語ニュースタイトルを日本語に簡潔に翻訳してください。翻訳文のみ回答すること:\n${englishTitle}`,
    100
  );
  return text?.trim() || englishTitle;
}

export interface KeywordMatch {
  /** 何らかの形で一致した(社名/銘柄コード/キーワードのいずれか) */
  matched: boolean;
  /** 社名そのものに一致(=AI判定を省略してよいほど強い根拠) */
  matchedNameOrCode: boolean;
}

// キーワードマッチによる高速事前フィルタ。
// 社名の一致はAI省略可(certain確定)だが、銘柄コードや業界共通語の
// キーワードリストのみの一致はAI省略の根拠にしない。
// 日本株の銘柄コードは4桁の裸の数字で、製品型番・西暦・スポーツクラブの
// 創設年(例: 1911 = 住友林業のコードだが「Springfield Armory 1911」
// 「Kiev, 1911」「Solbiatese Calcio 1911」等と無差別に一致する)等に
// 高確率で誤爆するため、社名ほど信頼できる根拠にならない。
export function quickKeywordMatch(
  text: string,
  stockName: string,
  stockCode: string,
  keywords: string[]
): KeywordMatch {
  const haystack = text.toLowerCase();
  if (haystack.includes(stockName.toLowerCase())) {
    return { matched: true, matchedNameOrCode: true };
  }
  const keywordHit =
    haystack.includes(stockCode.toLowerCase()) ||
    keywords.some((kw) => kw.length >= 2 && haystack.includes(kw.toLowerCase()));
  return { matched: keywordHit, matchedNameOrCode: false };
}

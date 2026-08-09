/**
 * Google Gemini API 呼び出し (無料枠)
 *
 * Anthropic API(有料)からの切り替え先。Gemini FlashはAI Studio発行の
 * APIキーで無料枠(1日あたり数百〜千リクエスト程度、モデルにより変動)が
 * あり、本アプリのAI判定量(1日数十件程度)なら収まる想定。
 *
 * モデル名は Google 側の提供状況が変わることがあるため、ここ1箇所だけ
 * 直せば全体に反映されるようにまとめている。無料枠の詳細は
 * https://ai.google.dev/gemini-api/docs/pricing を参照。
 */

const MODEL = "gemini-2.0-flash";
const TIMEOUT_MS = 15000;

// 無料枠のRPM(1分あたりリクエスト数)上限に収めるための最小呼び出し間隔。
// workerがhourly-fetch中に間隔なく連続呼び出しし、実測で429(quota exceeded)が
// 大量発生したため導入(gemini-2.0-flash無料枠は目安15RPM程度 → 余裕を見て13RPM相当)。
const MIN_INTERVAL_MS = 4600;
let lastCallAt = 0;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 20000;

export interface GeminiResult {
  text: string | null;
  error?: string;
}

async function throttle(): Promise<void> {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function requestOnce(prompt: string, maxOutputTokens: number, apiKey: string): Promise<GeminiResult & { status?: number }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens, temperature: 0 },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { text: null, error: `HTTP ${res.status}: ${body.slice(0, 200)}`, status: res.status };
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    return { text: typeof text === "string" ? text : null };
  } catch (err) {
    return { text: null, error: String(err) };
  }
}

/**
 * プロンプトを送り、テキスト応答を1つ返す。失敗時は text: null (呼び出し側で
 * 安全側フォールバックすること — 既存のAnthropic呼び出しと同じ設計)。
 * 無料枠のレート制限に収めるため呼び出し間隔を空け、429時はリトライする。
 */
export async function callGemini(prompt: string, maxOutputTokens = 200): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { text: null, error: "GEMINI_API_KEY未設定" };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();
    const result = await requestOnce(prompt, maxOutputTokens, apiKey);
    if (result.status !== 429 || attempt === MAX_RETRIES) return result;
    console.error(`[Gemini] 429 quota exceeded、${RETRY_DELAY_MS / 1000}秒待って再試行 (${attempt + 1}/${MAX_RETRIES})`);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  // unreachable
  return { text: null, error: "unreachable" };
}

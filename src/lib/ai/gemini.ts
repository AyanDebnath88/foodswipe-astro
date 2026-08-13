// Direct Gemini REST client -- no Genkit, no SDK wrapper, per the
// build-log decision to keep AI calls lightweight (plain fetch only).
// Server-only: callers live in src/pages/api/*.ts, which have
// `export const prerender = false` and never ship this key to the client.

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export class GeminiError extends Error {}

/**
 * Calls Gemini with a plain-text prompt and a JSON response schema
 * (Gemini's structured-output mode), and returns the parsed JSON.
 *
 * thinkingBudget is set to 0: these are simple classification/generation
 * tasks (suggest cuisines, draft a menu) that don't need the model's
 * extended-thinking mode, and skipping it cuts both latency and token
 * cost substantially (verified: ~950 total tokens with thinking enabled
 * vs. ~50 with it disabled, for the same suggest-cuisines prompt).
 */
export async function generateGeminiJson<T>(params: {
  prompt: string;
  responseSchema: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<T> {
  const apiKey = import.meta.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError("GEMINI_API_KEY is not configured");
  }

  // The key goes in a header, NOT `?key=...` in the URL. A URL with the key
  // in it ends up inside thrown fetch errors, stack traces and any log line
  // that prints the request -- and every caller of this function logs the
  // error before falling back. Same endpoint, same auth, one fewer place the
  // key can turn up.
  const response = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: params.prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: params.responseSchema,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? 8000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GeminiError(`Gemini API returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new GeminiError("Gemini response had no text content (possibly blocked/empty)");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError(`Gemini response was not valid JSON: ${text.slice(0, 300)}`);
  }
}

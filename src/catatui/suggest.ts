// Suggestions in the message box: while the student types, a fast model completes the message.
// The terminal program (suggest-editor.ts) and the desktop app (desktop/main.js) use this request.
// See src/md/features/suggest.md.
// This file does not import pi, so the desktop app can load it without loading pi.

import { CATCHAT_API } from "./config.ts";
import { readSettings } from "./settings.ts";

// gemma4 answers in about 0.5 s. Qwen and gpt-oss think first, so they are too slow for this.
export const SUGGEST_MODEL = "gemma4-31B-it";
// The pause in typing before a request.
export const SUGGEST_DELAY_MS = 450;

// "suggest" in catatui.json: on by default. false turns it off.
export const suggestOn = () => readSettings().suggest !== false;

// Only for a message of 3 or more characters, and not for /commands or !shell commands.
export const wantsSuggestion = (text: string) => text.trim().length >= 3 && !/^\s*[/!]/.test(text);

const SYSTEM = "A student types a message to an AI coding and study assistant at Montana State University. " +
  "Complete the message with the most likely next words (at most 10). Reply with the full message: the student's text exactly as given, then the new words. " +
  "No quotes and no explanation. If the message looks complete, reply with the student's text only.";

// The rest of the message (one line), or "" if there is no suggestion or the request fails.
// context: the last answer of the assistant (the student often answers it).
export async function fetchSuggestion(text: string, context: string | undefined, key: string, signal?: AbortSignal): Promise<string> {
  if (!wantsSuggestion(text)) return "";
  try {
    const res = await fetch(`${CATCHAT_API}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SUGGEST_MODEL, max_tokens: 40, temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${context ? `The assistant said before: ${String(context).slice(-600)}\n\n` : ""}The student's text: ${text}` },
        ],
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const full = data?.choices?.[0]?.message?.content?.replace(/^["']|["']$/g, "") ?? "";
    // Only a continuation of the exact text. One line.
    return full.startsWith(text) ? full.slice(text.length).split("\n")[0].replace(/\s+$/, "") : "";
  } catch {
    return "";
  }
}

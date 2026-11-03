// CatChat endpoints and defaults. Change these for a different deployment.

export const PROVIDER_ID = "catchat";
export const CATCHAT_API = "https://catchat-api.msu.montana.edu";
export const CATCHAT_ACCESS = "https://catchat-access.msu.montana.edu";
// The app name that SSO sign-in registers with CatChat.
export const CLIENT_NAME = "catatui";

// Used when CatChat does not report model limits.
export const DEFAULT_CONTEXT_WINDOW = 32768;
export const DEFAULT_MAX_TOKENS = 8192;

// pi selects this model after /login catchat.
// This must be the exact CatChat model id. If CatChat renames it, pi asks the student to use /model after /login.
export const DEFAULT_MODEL = "Qwen3.8-27B";

// At startup, the first match in this list becomes the model, if the student did not save one with /model.
// Qwen is first by choice. The rest are in order from a tool-call test on 2026-10-28 (read, edit, and no edit when told not to).
export const PREFERRED_MODELS = [/^qwen3\.\d+-27b$/i, /^gpt-oss:120b$/, /^gemma4-31b/i];

// Notes shown after the model id in /model. Keys are CatChat model ids. Keep them short: /model shows one line.
// Each note gives the maker and type, then the result of a small tool-call test on 2026-10-28. The test is a guide only.
// CatChat does not describe muse-glimmer and nimble. Ask RCI, then update the notes.
// The README and docs/index.html have the same list. Change all three together.
export const MODEL_NOTES: Record<string, string> = {
  "Qwen3.8-27B": "Alibaba. General and coding model, with thinking. Recommended. Passed all tool tests.",
  "gpt-oss:120b": "OpenAI open-weight model, with thinking. Good for coding. Passed all tool tests. Fastest.",
  "gemma4-31B-it": "Google. General model, long context. Good for coding. Passed all tool tests.",
  "muse-glimmer:30b": "Unknown Model. Passed all tool tests, but very slow.",
  "nimble:9b": "Unknown Model.",
  "mistral-small:24b": "Mistral. General chat model. Weak at file edits.",
  "llama3.1:8b": "Meta. Small general model. Can change files when you do not ask.",
  "codegemma:7b": "Google. Code completion model. Not for agent work. Can change files when you do not ask.",
  "medgemma:4b": "Google. Medical model for text and images. Not for coding.",
  "Goedel-Prover-V2": "Theorem prover (Lean). Not for general coding.",
};

// CatChat lists some alias names (for example "opus") that are not the real model. Hide them in /model.
// Add a pattern here if a new alias shows up.
// Embedding models cannot chat, so hide them too.
export const HIDDEN_MODELS = [/claude/i, /opus/i, /sonnet/i, /haiku/i, /embed/i];

// CatChat endpoints and defaults. Change these for a different deployment.

export const PROVIDER_ID = "catchat";
export const CATCHAT_API = "https://catchat-api.msu.montana.edu";
export const CATCHAT_ACCESS = "https://catchat-access.msu.montana.edu";
export const CLIENT_NAME = "catatui";

// Used when CatChat does not report model limits.
export const DEFAULT_CONTEXT_WINDOW = 32768;
export const DEFAULT_MAX_TOKENS = 8192;

// pi selects this model after /login catchat.
export const DEFAULT_MODEL = "gpt-oss:120b";

// At startup, the first match in this list becomes the model, if the student did not save one with /model.
// Order from a tool-call test on 2026-10-28 (read, edit, and no edit when told not to).
export const PREFERRED_MODELS = [/^gpt-oss:120b$/, /^qwen3\.\d+-27b$/i, /^gemma4-31b/i];

// Notes shown under "Model Name" in /model. Keys are CatChat model ids.
// Source: the same tool-call test. It is a small test, so the notes are a guide only.
export const MODEL_NOTES: Record<string, string> = {
  "gpt-oss:120b": "Recommended for coding. Passed all tool tests. Fastest.",
  "Qwen3.8-27B": "Good for coding. Passed all tool tests.",
  "gemma4-31B-it": "Good for coding. Passed all tool tests.",
  "muse-glimmer:30b": "Passed all tool tests, but very slow.",
  "mistral-small:24b": "Weak at file edits.",
  "llama3.1:8b": "Small model. Can change files when you do not ask.",
  "codegemma:7b": "Code completion model. Not for agent work. Can change files when you do not ask.",
  "medgemma:4b": "Medical model. Not for coding.",
  "Goedel-Prover-V2": "Theorem prover (Lean). Not for general coding.",
};

// Sign-in choices for /login, in order. With one choice, /login skips the menu.
// "sso" (browser sign-in) is off until RCI assigns students to the MSUBZ Catchat-API Entra app (AADSTS50105).
// To turn it on, add "sso" to this list.
export const AUTH_METHODS: readonly ("paste" | "sso")[] = ["paste"];

// CatChat lists some alias names (for example "opus") that are not the real model. Hide them in /model.
// Add a pattern here if a new alias shows up.
// Embedding models cannot chat, so hide them too.
export const HIDDEN_MODELS = [/claude/i, /opus/i, /sonnet/i, /haiku/i, /embed/i];

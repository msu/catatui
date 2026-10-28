// CatChat endpoints and defaults. Change these for a different deployment.

export const PROVIDER_ID = "catchat";
export const CATCHAT_API = "https://catchat-api.msu.montana.edu";
export const CATCHAT_ACCESS = "https://catchat-access.msu.montana.edu";
export const CLIENT_NAME = "catatui";

// Used when CatChat does not report model limits.
export const DEFAULT_CONTEXT_WINDOW = 32768;
export const DEFAULT_MAX_TOKENS = 8192;

// First match in this list becomes the default model in the catatui command. Not verified against CatChat.
export const PREFERRED_MODELS = [/qwen/i, /gpt-oss/i, /gemma/i];

// CatChat sign-in for pi's /login: the student pastes a key from catchat-access.
// The MSU SSO browser sign-in was taken out, because students do not have access to the CatChat app (AADSTS50105).
// CatVibes has the SSO code (src/main/auth/pkce.ts), if RCI gives students access later.

import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";
import { CATCHAT_ACCESS, CATCHAT_API } from "./config.ts";

// A pasted key has no refresh token. Treat it as valid for 180 days (the catchat-access maximum).
const PASTED_KEY_LIFETIME_MS = 180 * 86_400_000;

// The connection failed. The cause can be the network, a firewall, or CatChat itself.
const noConnection = (e: unknown) =>
  new Error(`Cannot connect to CatChat (${(e as Error).message}). Check your network connection, then try again. If the problem continues, connect to the MSU VPN.`);

// Text copied from a PDF or a web page often has smart quotes, spaces, or zero-width characters.
export function cleanKey(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/^\s*(export\s+)?[A-Z_]*API_KEY\s*=\s*/i, "")
    .replace(/^\s*bearer\s+/i, "")
    .replace(/["'`‘-‟«»]/g, "")
    .replace(/\s+/g, "");
}

async function keyWorks(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${CATCHAT_API}/v1/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    return res.status === 200;
  } catch (e) {
    throw noConnection(e);
  }
}

// Step 1 of the login dialog. The browser opens only after the student presses Enter.
const INTRO = [
  "To use catatui, you need to generate an API key.",
  "Press <enter> and I will open the catchat access website.",
  'Click on "API Keys" and then "+ Free Key".',
  'Give the key a unique name and select "gsoc" as your Team.',
  'Click "Create Key".',
  "You will be shown a key to copy and paste back here.",
  "",
  "Hit <enter> to open catchat access.",
].join("\n");

// Step 2: shown under the catchat-access URL, after the browser opens.
const AFTER_OPEN = [
  "If the page does not open, Cmd+click or Ctrl+click the URL above.",
  "The page works only on the MSU network. If the page does not load, connect to the MSU VPN.",
].join("\n");

async function pasteLogin(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  await cb.onPrompt({ message: INTRO, allowEmpty: true });
  cb.onAuth({ url: CATCHAT_ACCESS, instructions: AFTER_OPEN });
  const key = cleanKey(await cb.onPrompt({ message: "Paste your key, then press <enter>:" }));
  if (!key) throw new Error("The key is empty. Copy your key from catchat access, then paste it again.");
  if (!(await keyWorks(key))) throw new Error("CatChat did not accept the key. Make a new key at catchat access, then try again.");
  return { access: key, refresh: "", expires: Date.now() + PASTED_KEY_LIFETIME_MS };
}

export async function login(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  return pasteLogin(cb);
}

// A pasted key cannot be renewed. The student must paste a new key.
export async function refreshToken(): Promise<OAuthCredentials> {
  throw new Error("Your CatChat key expired. Run /login catchat and paste a new key.");
}

// CatChat sign-in for pi's /login.
// Default: MSU SSO in a browser (CatChat App Connect) gives catatui a key.
// Other option: the student makes a key at catchat-access and pastes it.
// See src/md/features/sign-in.md.

import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { CATCHAT_ACCESS, CATCHAT_API, CLIENT_NAME } from "./config.ts";

// A pasted key has no refresh token. Treat it as valid for 180 days (the catchat-access maximum).
const PASTED_KEY_LIFETIME_MS = 180 * 86_400_000;
const SSO_TIMEOUT_MS = 5 * 60 * 1000;

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

// The key steps. Both login dialog steps show them, so the student can follow them on the catchat access page (issue #1).
const KEY_STEPS = [
  'Click on "API Keys" and then "+ Free Key".',
  'Give the key a unique name and select "Student" as your Team.',
  'Click "Create Key".',
  "You will be shown a key to copy and paste back here.",
];

// Step 1 of the login dialog. The browser opens only after the student presses Enter.
const INTRO = [
  "To use catatui, you need to generate an API key.",
  "Press <enter> and I will open the catchat access website.",
  ...KEY_STEPS,
  "",
  "Hit <enter> to open catchat access.",
].join("\n");

// Step 2: shown under the catchat-access URL, after the browser opens.
const AFTER_OPEN = [
  ...KEY_STEPS,
  "",
  "If the page does not open, Cmd+click or Ctrl+click the URL above.",
  "The page works only on the MSU network. If the page does not load, connect to the MSU VPN.",
].join("\n");

async function pasteLogin(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  await cb.onPrompt({ message: INTRO, allowEmpty: true });
  cb.onAuth({ url: CATCHAT_ACCESS, instructions: AFTER_OPEN });
  return pastedKey(await cb.onPrompt({ message: "Paste your key, then press <enter>:" }));
}

// Clean a pasted key, test it with CatChat, and return the credential. The desktop app uses this too.
export async function pastedKey(raw: string): Promise<OAuthCredentials> {
  const key = cleanKey(raw);
  if (!key) throw new Error("The key is empty. Copy your key from catchat access, then paste it again.");
  if (!(await keyWorks(key))) throw new Error("CatChat did not accept the key. Make a new key at catchat access, then try again.");
  return { access: key, refresh: "", expires: Date.now() + PASTED_KEY_LIFETIME_MS };
}

// ---- MSU SSO: CatChat App Connect ----
// The portal makes a free 180-day key after an MSU sign-in, and sends it back to the app. There is no refresh token.
// Flow: OAuth loopback redirect with PKCE S256 (RFC 8252, RFC 7636). See src/md/features/sign-in.md.

interface ConnectResult { key: string; key_alias: string; team_id: string; team_alias: string; expires_at: string }

const b64url = (b: Buffer) => b.toString("base64url");

const LOGO = `data:image/png;base64,${readFileSync(new URL("../../assets/logo.png", import.meta.url)).toString("base64")}`;

// The page that the browser shows after the redirect to the loopback. MSU colors, light and dark.
// The script removes the one-time code from the address bar.
function page(title: string, text: string, ok: boolean): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>catatui: ${title}</title>
<style>
:root { --bg: #f4f4f2; --card: #ffffff; --fg: #1a1a1a; --muted: #5a5a5a; --blue: #002f87; --gold: #d4a017; --mark: ${ok ? "#1a7f37" : "#b42318"}; }
@media (prefers-color-scheme: dark) { :root { --bg: #101317; --card: #1a1f26; --fg: #f4f4f2; --muted: #a8adb4; --blue: #8fb3ff; --mark: ${ok ? "#4ac26b" : "#ff7b72"}; } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
main { max-width: 26rem; margin: 1rem; padding: 2rem 2.25rem; background: var(--card); border-top: 4px solid var(--gold); border-radius: 8px; box-shadow: 0 6px 24px rgba(0, 0, 0, .15); text-align: center; }
img { width: 96px; height: auto; }
h1 { margin: .75rem 0 .5rem; font-size: 1.4rem; color: var(--blue); }
h1 span { color: var(--mark); }
p { margin: 0; color: var(--muted); line-height: 1.5; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; color: var(--fg); }
</style></head>
<body><main>
<img src="${LOGO}" alt="catatui logo">
<h1><span>${ok ? "&#10003;" : "&#10007;"}</span> ${title}</h1>
<p>${text}</p>
</main>
<script>history.replaceState(null, "", location.pathname);</script>
</body></html>`;
}

// Wait for the browser to come back to http://127.0.0.1:<port>/callback with our state.
// If the signal aborts (the student cancels), stop the wait and close the server.
function startLoopback(state: string, signal?: AbortSignal): Promise<{ redirectUri: string; code: Promise<string>; close: () => void }> {
  let resolve!: (c: string) => void;
  let reject!: (e: Error) => void;
  const code = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const reply = (status: number, html: string) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }); res.end(html); };
    if (url.pathname !== "/callback") return reply(404, page("Not found", "This page does not exist.", false));
    if (url.searchParams.get("state") !== state) {
      return reply(400, page("Sign-in does not match", "This response is from a different sign-in. catatui still waits for the sign-in.", false));
    }
    const error = url.searchParams.get("error");
    if (error) {
      reply(200, page("Key not approved", "catatui did not get a key. Close this tab and go back to catatui to try again.", false));
      return reject(new Error(`The key was not approved: ${url.searchParams.get("error_description") ?? error}. To sign in, run /catchat login.`));
    }
    const c = url.searchParams.get("code");
    if (!c) return reply(400, page("No code", "The response has no code. catatui still waits for the sign-in.", false));
    reply(200, page("Signed in to CatChat", "Close this tab and go back to catatui.", true));
    resolve(c);
  });
  const close = () => server.close();
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const timer = setTimeout(() => reject(new Error("The sign-in timed out after 5 minutes. Run /catchat login again.")), SSO_TIMEOUT_MS);
    const onAbort = () => reject(new Error("The sign-in was cancelled."));
    signal?.addEventListener("abort", onAbort);
    code.finally(() => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); close(); }).catch(() => {});
    ok({ redirectUri: `http://127.0.0.1:${port}/callback`, code, close });
  }));
}

// Accept a bare code or the full redirect URL. Over SSH, the loopback is on a different computer.
function codeFromPaste(input: string, state: string): string {
  const text = input.trim();
  if (!text.includes("://")) return text;
  const url = new URL(text);
  if (url.searchParams.get("state") !== state) throw new Error("The pasted URL is from a different sign-in. Run /catchat login again.");
  const c = url.searchParams.get("code");
  if (!c) throw new Error("The pasted URL has no code. Copy the full address from the browser.");
  return c;
}

// The desktop app calls this with its own callbacks: onAuth opens the browser, and signal cancels.
export async function ssoLogin(cb: Pick<OAuthLoginCallbacks, "onAuth" | "onProgress" | "onManualCodeInput" | "signal">): Promise<OAuthCredentials> {
  const state = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const loop = await startLoopback(state, cb.signal);

  try {
    cb.onAuth({
      url: `${CATCHAT_ACCESS}/connect?${new URLSearchParams({
        name: CLIENT_NAME,
        redirect_uri: loop.redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`,
      instructions: [
        'Sign in with your MSU account, then click "Create key".',
        "If the page does not open, Cmd+click or Ctrl+click the URL above.",
        "The page works only on the MSU network. If the page does not load, connect to the MSU VPN.",
        "If the browser is on a different computer (SSH), paste the final redirect URL here.",
      ].join("\n"),
    });

    const manual = cb.onManualCodeInput?.().then((input) => codeFromPaste(input, state));
    const code = await (manual ? Promise.race([loop.code, manual]) : loop.code);

    cb.onProgress?.("Getting your CatChat key...");
    let res: Response;
    try {
      res = await fetch(`${CATCHAT_ACCESS}/connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: loop.redirectUri }),
        signal: cb.signal ?? AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw noConnection(e);
    }
    const text = await res.text();
    if (res.status !== 200) throw new Error(`CatChat did not give a key (HTTP ${res.status}): ${text.slice(0, 200)}. Run /catchat login again.`);
    const r = JSON.parse(text) as ConnectResult;
    return { access: r.key, refresh: "", expires: Date.parse(r.expires_at) || Date.now() + PASTED_KEY_LIFETIME_MS, user: r.key_alias };
  } finally {
    loop.close();
  }
}

// ---- pi entry points ----

export async function login(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const method = await cb.onSelect({
    message: "How do you want to sign in to CatChat?",
    options: [
      { id: "sso", label: "Sign in with your MSU account in a browser" },
      { id: "paste", label: "Make a key at catchat access and paste it" },
    ],
  });
  if (method === "sso") return ssoLogin(cb);
  if (method === "paste") return pasteLogin(cb);
  throw new Error("The sign-in was cancelled. To sign in, run /catchat login.");
}

// Pasted keys and App Connect keys have no refresh token. The student must sign in again.
export async function refreshToken(_cred: OAuthCredentials): Promise<OAuthCredentials> {
  throw new Error("Your CatChat key expired. Run /catchat login to get a new key.");
}

// CatChat sign-in for pi's /login.
// Option 1: MSU SSO. LiteLLM native-app OAuth (code + PKCE S256, loopback redirect).
//   Contract: <CATCHAT_API>/.well-known/litellm-cli-auth. Same flow as CatVibes auth/pkce.ts.
// Option 2: paste a key from catchat-access.

import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { AUTH_METHODS, CATCHAT_ACCESS, CATCHAT_API, CLIENT_NAME } from "./config.ts";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
// A pasted key has no refresh token. Treat it as valid for 180 days (the catchat-access maximum).
const PASTED_KEY_LIFETIME_MS = 180 * 86_400_000;

interface Contract {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  resource: string;
  code_challenge_methods_supported: string[];
}

interface TokenResponse { access_token: string; expires_in: number; refresh_token: string; user_id?: string }

const b64url = (b: Buffer) => b.toString("base64url");

// CatChat answers only on the MSU network. Off campus, the connection hangs or resets.
const offCampus = (e: unknown) =>
  new Error(`Cannot connect to CatChat (${(e as Error).message}). If you are not on campus, connect to the MSU VPN, then try again.`);

async function discover(signal?: AbortSignal): Promise<Contract> {
  let res: Response;
  try {
    res = await fetch(`${CATCHAT_API}/.well-known/litellm-cli-auth`, { signal: signal ?? AbortSignal.timeout(15_000) });
  } catch (e) {
    throw offCampus(e);
  }
  if (res.status !== 200) throw new Error(`CatChat does not support app sign-in (HTTP ${res.status}).`);
  const c = (await res.json()) as Contract;
  if (!c.code_challenge_methods_supported.includes("S256")) throw new Error("CatChat does not support PKCE S256.");
  const origin = new URL(CATCHAT_API).origin;
  for (const ep of [c.authorization_endpoint, c.token_endpoint, c.registration_endpoint, c.revocation_endpoint]) {
    if (new URL(ep).origin !== origin) throw new Error(`Sign-in endpoint is not on ${origin}: ${ep}`);
  }
  return c;
}

async function postForm<T>(url: string, fields: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    redirect: "manual",
    signal,
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`CatChat sign-in failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

// Wait for the browser to return to http://127.0.0.1:<port>/callback with our state.
function startLoopback(state: string): Promise<{ redirectUri: string; code: Promise<string>; close: () => void }> {
  let resolve!: (c: string) => void;
  let reject!: (e: Error) => void;
  const code = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const reply = (status: number, text: string) => { res.writeHead(status, { "Content-Type": "text/plain" }); res.end(text); };
    if (url.pathname !== "/callback") return reply(404, "Not found.");
    if (url.searchParams.get("state") !== state) return reply(400, "State does not match. Still waiting.");
    const error = url.searchParams.get("error");
    if (error) {
      reply(200, "Sign-in was not approved. You can close this window.");
      return reject(new Error(`Sign-in was not approved: ${url.searchParams.get("error_description") ?? error}`));
    }
    const c = url.searchParams.get("code");
    if (!c) return reply(400, "No code in the response. Still waiting.");
    reply(200, "Signed in to CatChat. You can close this window and go back to the terminal.");
    resolve(c);
  });
  const close = () => server.close();
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const timer = setTimeout(() => reject(new Error("Sign-in timed out. Try again.")), LOGIN_TIMEOUT_MS);
    code.finally(() => { clearTimeout(timer); close(); }).catch(() => {});
    ok({ redirectUri: `http://127.0.0.1:${port}/callback`, code, close });
  }));
}

// Accept a bare code or the full redirect URL (for SSH sessions, where the loopback is on another machine).
function codeFromPaste(input: string, state: string): string {
  const text = input.trim();
  if (!text.includes("://")) return text;
  const url = new URL(text);
  if (url.searchParams.get("state") !== state) throw new Error("The pasted URL is from a different sign-in. Run /login again.");
  const c = url.searchParams.get("code");
  if (!c) throw new Error("The pasted URL has no code. Copy the full address from the browser.");
  return c;
}

function toCredentials(t: TokenResponse, clientId: string): OAuthCredentials {
  return {
    access: t.access_token,
    refresh: t.refresh_token,
    expires: Date.now() + t.expires_in * 1000,
    clientId,
    user: t.user_id,
  };
}

async function ssoLogin(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  cb.onProgress?.("Connecting to CatChat...");
  const c = await discover(cb.signal);
  const state = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const loop = await startLoopback(state);

  try {
    const reg = await fetch(c.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [loop.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      redirect: "manual",
    });
    if (reg.status !== 200 && reg.status !== 201) throw new Error(`CatChat client registration failed (HTTP ${reg.status}).`);
    const { client_id } = (await reg.json()) as { client_id: string };

    cb.onAuth({
      url: `${c.authorization_endpoint}?${new URLSearchParams({
        response_type: "code",
        client_id,
        redirect_uri: loop.redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: c.resource,
      })}`,
      instructions: "Sign in with your MSU account. If the browser is on another computer (SSH), paste the final redirect URL here.",
    });

    const manual = cb.onManualCodeInput?.().then((input) => codeFromPaste(input, state));
    const code = await (manual ? Promise.race([loop.code, manual]) : loop.code);

    const tok = await postForm<TokenResponse>(c.token_endpoint, {
      grant_type: "authorization_code",
      code,
      redirect_uri: loop.redirectUri,
      client_id,
      code_verifier: verifier,
      resource: c.resource,
    }, cb.signal);
    return toCredentials(tok, client_id);
  } finally {
    loop.close();
  }
}

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
    throw offCampus(e);
  }
}

// Shown in the login dialog under the catchat-access URL.
// TODO: Check the steps against the catchat-access page. Use its real button and field names.
const KEY_STEPS = [
  "I will open the CatChat key page (catchat-access) in your browser.",
  "If the page does not open, Cmd+click or Ctrl+click the URL above.",
  "",
  "1. Sign in with your MSU account.",
  "2. Make a new key.",
  "3. Copy the key.",
  "4. Paste the key below, then press Enter.",
  "",
  "If the page does not load, connect to the MSU VPN.",
].join("\n");

async function pasteLogin(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  cb.onAuth({ url: CATCHAT_ACCESS, instructions: KEY_STEPS });
  const key = cleanKey(await cb.onPrompt({ message: "CatChat key:" }));
  if (!key) throw new Error("The key is empty. Copy your key from catchat-access, then paste it again.");
  if (!(await keyWorks(key))) throw new Error("CatChat did not accept the key. Make a new key at catchat-access, then try again.");
  return { access: key, refresh: "", expires: Date.now() + PASTED_KEY_LIFETIME_MS };
}

const METHOD_LABELS = {
  paste: "Paste a CatChat key from catchat-access",
  sso: "Sign in with MSU in a browser (needs RCI access)",
};

export async function login(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const method = AUTH_METHODS.length === 1
    ? AUTH_METHODS[0]
    : await cb.onSelect({
        message: "How do you want to sign in to CatChat?",
        options: AUTH_METHODS.map((id) => ({ id, label: METHOD_LABELS[id] })),
      });
  if (method === "sso") return ssoLogin(cb);
  if (method === "paste") return pasteLogin(cb);
  throw new Error("Sign-in cancelled.");
}

export async function refreshToken(cred: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
  // A pasted key cannot be renewed. The student must paste a new key.
  if (!cred.refresh || typeof cred.clientId !== "string") {
    throw new Error("Your CatChat key expired. Run /login and paste a new key.");
  }
  const c = await discover(signal);
  const tok = await postForm<TokenResponse>(c.token_endpoint, {
    grant_type: "refresh_token",
    refresh_token: cred.refresh,
    client_id: cred.clientId,
    resource: c.resource,
  }, signal);
  return { ...toCredentials(tok, cred.clientId), refresh: tok.refresh_token ?? cred.refresh };
}

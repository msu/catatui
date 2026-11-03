// CatChat sign-in for pi's /login.
// Default: the student pastes a key from catchat-access.
// With --sso: the student can also sign in with MSU SSO in a browser. Students do not have access to the
// CatChat app in Azure yet (AADSTS50105), so this is for tests only. See src/md/features/sign-in.md.
// SSO uses LiteLLM native-app OAuth (code + PKCE S256, loopback redirect), the same flow as CatVibes auth/pkce.ts.

import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";
import { createHash, randomBytes } from "node:crypto";
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

// ---- MSU SSO (--sso) ----

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

async function discover(signal?: AbortSignal): Promise<Contract> {
  let res: Response;
  try {
    res = await fetch(`${CATCHAT_API}/.well-known/litellm-cli-auth`, { signal: signal ?? AbortSignal.timeout(15_000) });
  } catch (e) {
    throw noConnection(e);
  }
  if (res.status !== 200) throw new Error(`CatChat does not support app sign-in (HTTP ${res.status}). Use a pasted key.`);
  const c = (await res.json()) as Contract;
  if (!c.code_challenge_methods_supported.includes("S256")) throw new Error("CatChat does not support PKCE S256. Use a pasted key.");
  const origin = new URL(CATCHAT_API).origin;
  for (const ep of [c.authorization_endpoint, c.token_endpoint, c.registration_endpoint, c.revocation_endpoint]) {
    if (new URL(ep).origin !== origin) throw new Error(`A sign-in endpoint is not on ${origin}: ${ep}. Use a pasted key.`);
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

// Wait for the browser to come back to http://127.0.0.1:<port>/callback with our state.
function startLoopback(state: string): Promise<{ redirectUri: string; code: Promise<string>; close: () => void }> {
  let resolve!: (c: string) => void;
  let reject!: (e: Error) => void;
  const code = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const reply = (status: number, text: string) => { res.writeHead(status, { "Content-Type": "text/plain" }); res.end(text); };
    if (url.pathname !== "/callback") return reply(404, "Not found.");
    if (url.searchParams.get("state") !== state) return reply(400, "The state does not match. catatui still waits for the sign-in.");
    const error = url.searchParams.get("error");
    if (error) {
      reply(200, "The sign-in was not approved. You can close this window.");
      return reject(new Error(`The sign-in was not approved: ${url.searchParams.get("error_description") ?? error}`));
    }
    const c = url.searchParams.get("code");
    if (!c) return reply(400, "The response has no code. catatui still waits for the sign-in.");
    reply(200, "You are signed in to CatChat. Close this window and go back to the terminal.");
    resolve(c);
  });
  const close = () => server.close();
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const timer = setTimeout(() => reject(new Error("The sign-in timed out after 5 minutes. Run /login catchat again.")), SSO_TIMEOUT_MS);
    code.finally(() => { clearTimeout(timer); close(); }).catch(() => {});
    ok({ redirectUri: `http://127.0.0.1:${port}/callback`, code, close });
  }));
}

// Accept a bare code or the full redirect URL. Over SSH, the loopback is on a different computer.
function codeFromPaste(input: string, state: string): string {
  const text = input.trim();
  if (!text.includes("://")) return text;
  const url = new URL(text);
  if (url.searchParams.get("state") !== state) throw new Error("The pasted URL is from a different sign-in. Run /login catchat again.");
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
    if (reg.status !== 200 && reg.status !== 201) throw new Error(`CatChat client registration failed (HTTP ${reg.status}). Use a pasted key.`);
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
      instructions: "Sign in with your MSU account. If the browser is on a different computer (SSH), paste the final redirect URL here.",
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

// ---- pi entry points ----

export async function login(cb: OAuthLoginCallbacks, sso: boolean): Promise<OAuthCredentials> {
  if (!sso) return pasteLogin(cb);
  const method = await cb.onSelect({
    message: "How do you want to sign in to CatChat?",
    options: [
      { id: "paste", label: "Paste a CatChat key from catchat access" },
      { id: "sso", label: "Sign in with MSU SSO in a browser (test)" },
    ],
  });
  if (method === "sso") return ssoLogin(cb);
  if (method === "paste") return pasteLogin(cb);
  throw new Error("The sign-in was cancelled. To sign in, run /login catchat.");
}

// A pasted key has no refresh token, so the student must paste a new key. An SSO sign-in has a refresh token.
export async function refreshToken(cred: OAuthCredentials, signal?: AbortSignal): Promise<OAuthCredentials> {
  if (!cred.refresh || typeof cred.clientId !== "string") {
    throw new Error("Your CatChat key expired. Run /login catchat and paste a new key.");
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

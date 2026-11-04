// The catai GitHub sign-in: a personal access token that the student makes for catai and pastes.
// catatui uses only this token for GitHub (git.ts). It never uses the student's other credentials (SSH keys,
// the keychain), so the student gives clear consent, and can revoke the token alone on GitHub.
// The token is in ~/.catatui/github.json. Only the student can read the file (the same as the CatChat key).
// The model never sees the token. This file does not import pi, so the desktop app can load it.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentDir } from "./store.ts";

// The GitHub page that makes a token, with the form filled in: the "repo" scope (push to private repositories).
export const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo&description=catai";
// For tests: CATATUI_GITHUB_API points to a local server.
const api = () => process.env.CATATUI_GITHUB_API ?? "https://api.github.com";

export interface GitHubSignIn { token: string; login: string; expires?: number }

const file = () => join(agentDir(), "github.json");

export function readGitHub(): GitHubSignIn | undefined {
  try {
    const data = JSON.parse(readFileSync(file(), "utf8"));
    return typeof data?.token === "string" && typeof data?.login === "string" ? data : undefined;
  } catch {
    return undefined;
  }
}

export function clearGitHub() {
  if (existsSync(file())) rmSync(file());
}

// Check the token with GitHub, then save it. Returns the sign-in, or an error message for the student.
export async function signInGitHub(token: string): Promise<GitHubSignIn | { error: string }> {
  const t = token.trim();
  if (!/^[A-Za-z0-9_]{20,255}$/.test(t)) return { error: "This is not a GitHub token. Copy the whole token from GitHub (it starts with ghp_ or github_pat_)." };
  let res: Response;
  try {
    res = await fetch(`${api()}/user`, {
      headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "User-Agent": "catai" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { error: `catai cannot connect to GitHub (${(e as Error).message}). Check the network connection, then try again.` };
  }
  if (res.status === 401) return { error: "GitHub did not accept this token. It can be expired or revoked. Make a new token, then try again." };
  if (!res.ok) return { error: `GitHub returned an error (${res.status}). Try again later.` };
  const login = String(((await res.json()) as { login?: unknown }).login ?? "");
  if (!login) return { error: "GitHub did not return a user name for this token." };
  // GitHub sends the expiry of a token that has one, for example "2027-01-02 03:04:05 UTC".
  const exp = Date.parse(String(res.headers.get("github-authentication-token-expiration") ?? "").replace(" UTC", "Z").replace(" ", "T"));
  const signIn: GitHubSignIn = { token: t, login, ...(Number.isFinite(exp) ? { expires: exp } : {}) };
  mkdirSync(agentDir(), { recursive: true });
  writeFileSync(file(), `${JSON.stringify(signIn, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file(), 0o600);
  return signIn;
}

// Days until the token expires, or undefined if it has no expiry. 0 or less: expired.
export function gitHubExpiryDays(s = readGitHub()): number | undefined {
  return s?.expires === undefined ? undefined : Math.ceil((s.expires - Date.now()) / 86_400_000);
}

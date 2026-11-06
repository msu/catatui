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

// ---- "Get a project from GitHub" in the desktop app (the project picker). ----

export interface Repo { name: string; fullName: string; private: boolean; description: string; updated: string; url: string }

// The repositories of the signed-in student (own, collaborator, and organization), the newest first. At most 100.
export async function listRepos(): Promise<Repo[] | { error: string }> {
  const s = readGitHub();
  if (!s) return { error: "Sign in to GitHub to see your repositories." };
  let res: Response;
  try {
    res = await fetch(`${api()}/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member`, {
      headers: { Authorization: `Bearer ${s.token}`, Accept: "application/vnd.github+json", "User-Agent": "catai" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { error: `catai cannot connect to GitHub (${(e as Error).message}).` };
  }
  if (res.status === 401) return { error: "GitHub did not accept your token. Sign in to GitHub again." };
  if (!res.ok) return { error: `GitHub returned an error (${res.status}).` };
  const list = (await res.json()) as { name: string; full_name: string; private: boolean; description: string | null; updated_at: string; clone_url: string }[];
  return list.map((r) => ({ name: r.name, fullName: r.full_name, private: r.private, description: r.description ?? "", updated: r.updated_at, url: r.clone_url }));
}

// What the student typed or pasted -> an HTTPS clone address, or an error. Accepts "user/repo", "github.com/user/repo",
// "https://github.com/user/repo(.git)", a GitHub page address with more path ("/tree/main"), and "git@github.com:user/repo".
// Other hosts: only https addresses.
export function repoUrl(input: string): { url: string; name: string } | { error: string } {
  const t = String(input ?? "").trim();
  const gh = /^(?:https?:\/\/)?(?:www\.)?github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/i.exec(t) ?? /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(t) ?? /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(t);
  if (gh) return { url: `https://github.com/${gh[1]}/${gh[2]}.git`, name: gh[2] };
  if (/^https:\/\/[^\s/]+\/\S+$/i.test(t)) return { url: t, name: t.replace(/\.git$/i, "").replace(/\/+$/, "").split("/").pop() ?? "project" };
  return { error: "Paste a GitHub address, for example https://github.com/user/repo, or type user/repo." };
}

// git clone --progress -> a percent for the whole clone and a short label. The phases have weights:
// counting and compressing 0-5, receiving 5-85, resolving 85-95, updating files 95-100. undefined: no progress line.
const PHASES: [RegExp, string, number, number][] = [
  [/(?:Counting|Enumerating|Compressing) objects:\s+(\d+)%/, "Preparing", 0, 5],
  [/Receiving objects:\s+(\d+)%/, "Downloading", 5, 85],
  [/Resolving deltas:\s+(\d+)%/, "Unpacking", 85, 95],
  [/Updating files:\s+(\d+)%/, "Writing files", 95, 100],
];
export function cloneProgress(text: string): { percent: number; label: string } | undefined {
  let best: { percent: number; label: string } | undefined;
  // git rewrites the line with \r. Use the last line that has a phase.
  for (const line of text.split(/[\r\n]+/)) {
    for (const [re, label, from, to] of PHASES) {
      const m = re.exec(line);
      if (m) best = { percent: Math.round(from + ((to - from) * Number(m[1])) / 100), label };
    }
  }
  return best;
}

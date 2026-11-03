// The CatChat sign-in on disk, in the catatui folder (~/.catatui). The extension and the desktop app use this file.
// This file does not import pi, so the desktop app can load it without loading pi.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PROVIDER_ID } from "./config.ts";

export interface StoredCredential { type: "oauth"; access: string; refresh: string; expires: number; user?: string }

// The same folder as bin/catatui.js and pi's getAgentDir().
export const agentDir = () => process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".catatui");

// A CatChat key expires after 180 days and has no refresh token. Warn the student 14 days before.
export const EXPIRY_WARN_MS = 14 * 86_400_000;

function readJson(path: string): Record<string, unknown> {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
}

function editJson(path: string, edit: (data: Record<string, unknown>) => void) {
  if (!existsSync(path)) return;
  const data = readJson(path);
  edit(data);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function readCredential(): StoredCredential | undefined {
  const cred = readJson(join(agentDir(), "auth.json"))[PROVIDER_ID] as StoredCredential | undefined;
  return typeof cred?.access === "string" ? cred : undefined;
}

// Save the key in the same format as pi's /login. Only the student can read the file.
export function saveCredential(cred: { access: string; refresh?: string; expires: number; user?: string }) {
  const dir = agentDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "auth.json");
  const data = readJson(path);
  data[PROVIDER_ID] = { type: "oauth", access: cred.access, refresh: cred.refresh ?? "", expires: cred.expires, ...(cred.user ? { user: cred.user } : {}) };
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

// Remove the CatChat key, the cached model list, and a saved CatChat default model.
// pi keeps these in memory, so catatui must start again after this.
export function clearSignIn() {
  const dir = agentDir();
  editJson(join(dir, "auth.json"), (d) => delete d[PROVIDER_ID]);
  editJson(join(dir, "models-store.json"), (d) => delete d[PROVIDER_ID]);
  editJson(join(dir, "settings.json"), (d) => {
    if (d.defaultProvider !== PROVIDER_ID) return;
    delete d.defaultProvider;
    delete d.defaultModel;
  });
}

// Days until the key expires, or undefined if the warning is not necessary. 0 or less: the key expired.
export function expiryDays(cred = readCredential()): number | undefined {
  if (typeof cred?.expires !== "number") return undefined;
  const left = cred.expires - Date.now();
  return left > EXPIRY_WARN_MS ? undefined : Math.ceil(left / 86_400_000);
}

export function savedDefaultProvider(): string | undefined {
  return readJson(join(agentDir(), "settings.json")).defaultProvider as string | undefined;
}

// The catatui settings: <agent dir>/catatui.json (default ~/.catatui/catatui.json). The terminal program and the
// desktop app use the same file. catatui reads the file each time it needs a setting, so a change in the desktop
// app is active in a running catatui process.
// Keys: "ste" (ste.ts), "suggest" (suggest.ts), "idleCompaction" (idle-compact.ts).
// This file does not import pi, so the desktop app can load it without loading pi.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentDir } from "./store.ts";

export const settingsFile = () => join(agentDir(), "catatui.json");

export function readSettings(): Record<string, unknown> {
  try {
    return existsSync(settingsFile()) ? JSON.parse(readFileSync(settingsFile(), "utf8")) : {};
  } catch {
    return {}; // A bad file: use the defaults.
  }
}

export function writeSetting(key: string, value: unknown) {
  mkdirSync(agentDir(), { recursive: true });
  writeFileSync(settingsFile(), `${JSON.stringify({ ...readSettings(), [key]: value }, null, 2)}\n`);
}

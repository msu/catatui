// Sandbox: the agent can use only files in the folder where catatui started (the project folder).
// "catatui --no-sandbox" turns the sandbox off at start. "/safety" (permissions.ts) can turn it on and off.
// - read, write, edit, grep, find, ls: block a path outside the project folder.
// - bash, powershell: block a command with a path outside the project folder (/x, ~, $HOME, .., C:\).
//   This check reads the command text only. It is not an OS sandbox, so a command can get around it.
// The sandbox applies in all safety modes, also in yolo.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

const FILE_TOOLS = ["read", "write", "edit", "grep", "find", "ls"];
const SHELL_TOOLS = ["bash", "powershell"];

// Paths outside the project folder that commands can use.
const ALLOWED = ["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"];

// A path in a command: it starts after a space, quote, "=", or a shell operator.
const SHELL_PATH = /(?:^|[\s='"<>|;&(])((?:\/|~|\$HOME|\$\{HOME\}|\.\.|[A-Za-z]:[\\/])[^\s'"<>|;&()]*)/g;

function expand(path: string): string {
  const p = path.replace(/^@/, "");
  if (p === "~" || p.startsWith("~/")) return homedir() + p.slice(1);
  return p.replace(/^\$\{?HOME\}?/, homedir());
}

// The real path, so a symbolic link in the project cannot point outside it.
function real(path: string): string {
  return existsSync(path) ? realpathSync(path) : path;
}

function inside(root: string, path: string): boolean {
  const full = resolve(root, expand(path));
  if (ALLOWED.includes(full)) return true;
  const rel = relative(real(root), real(full));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

let on = true;
let started = false;

export const sandboxOn = () => on;

// The footer shows "sandbox: off" only when the sandbox is off.
export function setSandbox(ctx: ExtensionContext, value: boolean) {
  on = value;
  if (ctx.hasUI) ctx.ui.setStatus("sandbox", on ? undefined : `${ctx.ui.theme.fg("dim", "sandbox:")} ${ctx.ui.theme.fg("warning", "off")}`);
}

export function registerSandbox(pi: ExtensionAPI) {
  pi.registerFlag("no-sandbox", {
    description: "Let the agent use files outside the project folder",
    type: "boolean",
    default: false,
  });

  // Read the flag at the first start only, so a new session (/new) keeps the choice from /safety.
  pi.on("session_start", async (_event, ctx) => {
    if (started) return setSandbox(ctx, on);
    started = true;
    setSandbox(ctx, !pi.getFlag("no-sandbox"));
    if (!on && ctx.hasUI) ctx.ui.notify("The sandbox is off. The agent can use files outside the project folder.", "warning");
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!on) return;
    const reason = (what: string) => ({
      block: true,
      reason: `Blocked: ${what} is outside the project folder (${ctx.cwd}). Use only files in the project folder. To turn off this limit, the student must use /safety or start catatui with --no-sandbox.`,
    });

    if (FILE_TOOLS.includes(event.toolName)) {
      const path = String(event.input.path ?? ".");
      if (!inside(ctx.cwd, path)) return reason(path);
    }

    if (SHELL_TOOLS.includes(event.toolName)) {
      const command = String(event.input.command ?? "");
      for (const [, path] of command.matchAll(SHELL_PATH)) {
        if (!inside(ctx.cwd, path)) return reason(path);
      }
    }
  });
}

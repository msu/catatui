// "/undo": put back the files that the agent changed for the last request.
// Before each file change (CHANGE_TOOLS in config.ts), keep a copy of the file (or note that it did not exist).
// One request (one agent run) is one undo step. "/undo" again goes one more step back.
// move, copy, delete, and mkdir (files.ts) can change a folder: undo keeps a copy of each file in it (MAX_FILES).
// Limit: changes from bash commands (for example "npm init" or "rm") and from the git tools are not in the undo steps.
// The copies stay in memory, so they last for one catatui session only.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { CHANGE_TOOLS, toolPaths } from "./config.ts";

const MAX_STEPS = 20;
// Undo keeps a copy of at most this many files and bytes in a folder that a tool changes.
const MAX_FILES = 500;
const MAX_BYTES = 50_000_000;
// The copy of a folder (not a file): undo makes the folder again.
const DIR = Buffer.from("\0catatui-folder\0");

type FileCopy = {
  before: Buffer | null; // null: the file did not exist before the request. A Buffer, so .xlsx files work.
  after?: Buffer | null; // the file at the end of the request, to find changes that the student made after it
};
type Step = { prompt: string; files: Map<string, FileCopy>; skipped: string[] };

const readOrNull = (path: string) => (!existsSync(path) ? null : statSync(path).isDirectory() ? DIR : readFileSync(path));
const same = (a: Buffer | null | undefined, b: Buffer | null | undefined) => (a && b ? a.equals(b) : a === b);

// Keep a copy of a path before a change: a file, or a folder and the files in it.
function keep(step: Step, path: string) {
  // A new path in new folders (for example mkdir a/b/c): keep the first folder that does not exist, so undo removes it all.
  while (!existsSync(path) && !existsSync(dirname(path)) && dirname(path) !== path) path = dirname(path);
  if (step.files.has(path)) return;
  try {
    const before = readOrNull(path);
    step.files.set(path, { before });
    if (before !== DIR) return;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (files.length > MAX_FILES) return;
        const p = join(dir, e.name);
        if (e.isDirectory()) { files.push(p); walk(p); } else if (e.isFile()) files.push(p);
      }
    };
    walk(path);
    let bytes = 0;
    for (const f of files) bytes += statSync(f).isFile() ? statSync(f).size : 0;
    if (files.length > MAX_FILES || bytes > MAX_BYTES) { step.skipped.push(path); return; }
    for (const f of files) if (!step.files.has(f)) step.files.set(f, { before: readOrNull(f) });
  } catch {
    // The path cannot be read. The tool will fail too.
  }
}

function fullPath(cwd: string, path: string): string {
  const p = path.replace(/^@/, "");
  return resolve(cwd, p === "~" || p.startsWith("~/") ? homedir() + p.slice(1) : p);
}

export function registerUndo(pi: ExtensionAPI) {
  const steps: Step[] = [];
  let current: Step | undefined;
  // Files that /undo put back. The model gets this note with the next request.
  let note: string | undefined;

  pi.on("before_agent_start", async (event) => {
    current = { prompt: event.messageType === "user" ? event.prompt : "(no prompt)", files: new Map(), skipped: [] };
    if (!note) return;
    const content = note;
    note = undefined;
    return { message: { customType: "undo-note", content, display: false } };
  });

  // Register this handler after sandbox.ts and permissions.ts. Then a blocked call does not get here.
  pi.on("tool_call", async (event, ctx) => {
    if (!current || !CHANGE_TOOLS.includes(event.toolName)) return;
    for (const p of toolPaths(event.toolName, event.input)) keep(current, fullPath(ctx.cwd, p));
  });

  // In RPC mode (the desktop app), tell the app how many undo steps there are, so it can turn its Undo button on or off.
  const publish = (ctx: ExtensionContext) => { if (ctx.mode === "rpc") ctx.ui.setStatus("catatui-undo", String(steps.length)); };
  pi.on("session_start", async (_event, ctx) => publish(ctx));

  pi.on("agent_end", async (_event, ctx) => {
    if (!current) return;
    for (const [path, copy] of current.files) copy.after = readOrNull(path);
    // Keep only the requests that changed files.
    if ([...current.files.values()].some((c) => !same(c.before, c.after))) steps.push(current);
    if (steps.length > MAX_STEPS) steps.shift();
    publish(ctx);
    current = undefined;
  });

  pi.registerCommand("undo", {
    description: "Put back the files that the agent changed for the last request",
    handler: async (_args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("Undo is not available while the agent works. Press Escape to stop the agent, then try again.", "error");
        return;
      }
      const step = steps.at(-1);
      if (!step) {
        ctx.ui.notify("There is nothing to undo. Undo puts back only the changes from the file tools (edit, write, excel_write, docx_write, pdf_write, and the file tools) in this session.", "info");
        return;
      }
      if (!(await confirm(ctx, step))) return;
      steps.pop();
      publish(ctx);
      const done: string[] = [];
      // First remove the new files and folders, then put back the old ones (a new folder can hold an old path).
      const order = [...step.files].sort(([, a], [, b]) => Number(a.before !== null) - Number(b.before !== null));
      for (const [path, copy] of order) {
        if (copy.before === null) rmSync(path, { recursive: true, force: true });
        else if (copy.before.equals(DIR)) mkdirSync(path, { recursive: true });
        else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, copy.before); }
        if (copy.before === null || !copy.before.equals(DIR)) done.push(show(ctx, path));
      }
      note = `${note ?? "[UNDO]\nThe student used /undo. Read a file again before you change it."}\nThese files are now as they were before the request "${step.prompt}":\n${done.join("\n")}`;
      ctx.ui.notify(`Undo complete. ${done.length} file(s) put back. Changes from bash commands are not undone.`, "info");
    },
  });
}

const show = (ctx: ExtensionContext, path: string) => {
  const rel = relative(ctx.cwd, path);
  return rel.startsWith("..") ? path : rel;
};

async function confirm(ctx: ExtensionContext, step: Step): Promise<boolean> {
  if (!ctx.hasUI) return false;
  const all = [...step.files].filter(([, copy]) => !copy.before?.equals(DIR) && !same(copy.before, copy.after)).map(([path, copy]) => {
    const what = copy.before === null ? "delete (new)" : "put back";
    const changed = !same(readOrNull(path), copy.after) ? "  [you changed it after the agent, your changes will be lost]" : "";
    return `  ${what}: ${show(ctx, path)}${changed}`;
  });
  const lines = all.length > 15 ? [...all.slice(0, 15), `  ... and ${all.length - 15} more`] : all;
  for (const path of step.skipped) lines.push(`  not possible: the files in ${show(ctx, path)} (too many or too large)`);
  const prompt = step.prompt.length > 60 ? `${step.prompt.slice(0, 57)}...` : step.prompt;
  const choice = await ctx.ui.select(`Undo the file changes for "${prompt}"?\n\n${lines.join("\n")}`, ["Yes", "No"]);
  return choice === "Yes";
}

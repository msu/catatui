// "/undo": put back the files that the agent changed for the last request.
// Before each edit or write, keep a copy of the file (or note that it did not exist).
// One request (one agent run) is one undo step. "/undo" again goes one more step back.
// Limit: changes from bash commands (for example "npm init" or "rm") are not in the undo steps.
// The copies stay in memory, so they last for one catatui session only.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";

const MAX_STEPS = 20;

type FileCopy = {
  before: string | null; // null: the file did not exist before the request
  after?: string | null; // the file at the end of the request, to find changes that the student made after it
};
type Step = { prompt: string; files: Map<string, FileCopy> };

const readOrNull = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

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
    current = { prompt: event.messageType === "user" ? event.prompt : "(no prompt)", files: new Map() };
    if (!note) return;
    const content = note;
    note = undefined;
    return { message: { customType: "undo-note", content, display: false } };
  });

  // Register this handler after sandbox.ts and permissions.ts. Then a blocked call does not get here.
  pi.on("tool_call", async (event, ctx) => {
    if (!current || (event.toolName !== "edit" && event.toolName !== "write")) return;
    const path = fullPath(ctx.cwd, String(event.input.path ?? ""));
    if (current.files.has(path)) return;
    try {
      current.files.set(path, { before: readOrNull(path) });
    } catch {
      // The file cannot be read (for example a folder). The tool will fail too.
    }
  });

  pi.on("agent_end", async () => {
    if (!current) return;
    for (const [path, copy] of current.files) copy.after = readOrNull(path);
    // Keep only the requests that changed files.
    if ([...current.files.values()].some((c) => c.before !== c.after)) steps.push(current);
    if (steps.length > MAX_STEPS) steps.shift();
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
        ctx.ui.notify("There is nothing to undo. Undo puts back only the changes from the edit and write tools in this session.", "info");
        return;
      }
      if (!(await confirm(ctx, step))) return;
      steps.pop();
      const done: string[] = [];
      for (const [path, copy] of step.files) {
        if (copy.before === null) rmSync(path, { force: true });
        else writeFileSync(path, copy.before);
        done.push(show(ctx, path));
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
  const lines = [...step.files].map(([path, copy]) => {
    const what = copy.before === null ? "delete (new file)" : "put back";
    const changed = readOrNull(path) !== copy.after ? "  [you changed it after the agent, your changes will be lost]" : "";
    return `  ${what}: ${show(ctx, path)}${changed}`;
  });
  const prompt = step.prompt.length > 60 ? `${step.prompt.slice(0, 57)}...` : step.prompt;
  const choice = await ctx.ui.select(`Undo the file changes for "${prompt}"?\n\n${lines.join("\n")}`, ["Yes", "No"]);
  return choice === "Yes";
}

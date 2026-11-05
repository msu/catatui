// The text editor of the desktop app (catai). The app tells the extension which file is open
// ("/catai-editor {path, line, selection}"), and the agent gets this as context before each turn.
// The agent changes the open file with editor_edit: the app applies the change to the open document,
// so the student sees it at once and can undo it (Cmd+Z), and saves it. edit and write are blocked
// for the open file, so the agent and the student do not write over each other.
// The app saves the student's text before the agent starts, and locks the editor while the agent works.
// See src/md/features/desktop.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { Type } from "typebox";

// The same prefix as EDITOR_PREFIX in desktop/src/chat.js.
export const EDITOR_PREFIX = "[editor] ";
const MAX_SELECTION = 2000;

export interface OpenFile { path: string; line?: number; selection?: string; readOnly?: boolean }

export function editorSection(open: OpenFile): string {
  if (open.readOnly) {
    return `The student has the file ${open.path} open in catai, in a read-only view. ` +
      "When the student says \"this file\" or \"this\", they mean this file. Read it with the tool for its type.";
  }
  const sel = open.selection ? open.selection.slice(0, MAX_SELECTION) : "";
  return [
    `The student has the file ${open.path} open in the catai editor${open.line ? `, with the cursor on line ${open.line}` : ""}.`,
    sel ? `The student selected this text:\n\`\`\`\n${sel}\n\`\`\`` : "",
    "When the student says \"this file\", \"here\", or \"this\", they mean this file or the selection.",
    `To change ${open.path}, use editor_edit, not edit or write. The student sees the change at once.`,
  ].filter(Boolean).join("\n");
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export function registerEditor(pi: ExtensionAPI) {
  let open: OpenFile | undefined;
  const isOpen = (cwd: string, p: unknown) => !!open && !open.readOnly && typeof p === "string" && resolve(cwd, p.replace(/^@/, "")) === resolve(cwd, open.path);

  pi.registerCommand("catai-editor", {
    description: "(catai app) The file that is open in the editor",
    handler: async (args) => {
      try { open = JSON.parse(args) ?? undefined; } catch { open = undefined; }
      if (open && typeof open.path !== "string") open = undefined;
    },
  });

  pi.on("before_agent_start", async (event) => {
    const { editor: _old, ...rest } = event.systemPromptOptions.sections;
    event.systemPromptOptions.sections = open ? { ...rest, editor: editorSection(open) } : rest;
  });

  pi.on("tool_call", async (event, ctx) => {
    if ((event.toolName === "edit" || event.toolName === "write") && isOpen(ctx.cwd, (event.input as { path?: unknown }).path)) {
      return { block: true, reason: `The student has ${open!.path} open in the editor. Use editor_edit to change it, not ${event.toolName}.` };
    }
  });

  pi.registerTool({
    name: "editor_edit",
    label: "Editor edit",
    description: "Change the file that is open in the student's catai editor. Each edit replaces oldText (it must be in the file exactly one time) " +
      "with newText. Or give content to replace all of the file. The student sees the change at once and can undo it.",
    promptSnippet: "Change the file that is open in the student's editor",
    promptGuidelines: ["If the student has a file open in the catai editor, change that file only with editor_edit."],
    parameters: Type.Object({
      path: Type.String({ description: "The path of the open file" }),
      edits: Type.Optional(Type.Array(Type.Object({
        oldText: Type.String({ description: "Text to find. It must be in the file exactly one time." }),
        newText: Type.String({ description: "The new text" }),
      }))),
      content: Type.Optional(Type.String({ description: "The full new text of the file. Use this or edits." })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (!isOpen(ctx.cwd, params.path)) return text(`${params.path} is not open in the editor. Use edit or write.`);
      if (!params.edits?.length && params.content === undefined) return text("Give edits or content.");
      if (ctx.mode !== "rpc" || !ctx.hasUI) return text("There is no editor. Use edit or write.");
      const answer = await ctx.ui.input(`${EDITOR_PREFIX}${JSON.stringify({ ...params, path: open!.path })}`, undefined, { signal });
      let r: { ok?: boolean; error?: string } = {};
      try { r = JSON.parse(answer ?? "{}"); } catch { /* not JSON */ }
      if (!r.ok) throw new Error(r.error ?? "The editor did not apply the change.");
      return text(`Changed ${open!.path} in the editor. The student sees the change and the file is saved.`);
    },
  });
}

// File tools: move, copy, delete, mkdir. With them, the model does not need shell commands (mv, cp, rm, mkdir)
// that are different on Windows. They are file changes (CHANGE_TOOLS in config.ts): the sandbox checks the
// paths, permissions.ts asks, and /undo puts the files back (undo.ts).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { Type } from "typebox";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export function fullPath(cwd: string, path: string): string {
  const p = path.replace(/^@/, "");
  return resolve(cwd, p === "~" || p.startsWith("~/") ? homedir() + p.slice(1) : p);
}

export function registerFileTools(pi: ExtensionAPI) {
  const both = Type.Object({
    from: Type.String({ description: "The file or folder" }),
    to: Type.String({ description: "The new path, with the name. It must not exist." }),
  });

  pi.registerTool({
    name: "move",
    label: "Move",
    description: "Move or rename a file or a folder. \"to\" is the full new path (not a folder to put it in), and it must not exist.",
    promptSnippet: "Move or rename a file or folder",
    promptGuidelines: ["To move, copy, delete, or make files and folders, use move, copy, delete, and mkdir, not shell commands."],
    parameters: both,
    async execute(_id, p, _s, _u, ctx) {
      const from = fullPath(ctx.cwd, p.from);
      const to = fullPath(ctx.cwd, p.to);
      if (!existsSync(from)) return text(`There is no file or folder ${p.from}.`);
      if (existsSync(to)) return text(`${p.to} exists. Give a new path that does not exist.`);
      if (!relative(from, to).startsWith("..") && relative(from, to) !== "") return text("A folder cannot move into itself.");
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
      return text(`Moved ${p.from} to ${p.to}.`);
    },
  });

  pi.registerTool({
    name: "copy",
    label: "Copy",
    description: "Copy a file or a folder (with all its files). \"to\" is the full new path, and it must not exist.",
    promptSnippet: "Copy a file or folder",
    parameters: both,
    async execute(_id, p, _s, _u, ctx) {
      const from = fullPath(ctx.cwd, p.from);
      const to = fullPath(ctx.cwd, p.to);
      if (!existsSync(from)) return text(`There is no file or folder ${p.from}.`);
      if (existsSync(to)) return text(`${p.to} exists. Give a new path that does not exist.`);
      if (!relative(from, to).startsWith("..") && relative(from, to) !== "") return text("A folder cannot copy into itself.");
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to, { recursive: true, errorOnExist: true });
      return text(`Copied ${p.from} to ${p.to}.`);
    },
  });

  pi.registerTool({
    name: "delete",
    label: "Delete",
    description: "Delete a file, or a folder with all its files.",
    promptSnippet: "Delete a file or folder",
    parameters: Type.Object({ path: Type.String({ description: "The file or folder" }) }),
    async execute(_id, p, _s, _u, ctx) {
      const full = fullPath(ctx.cwd, p.path);
      if (!existsSync(full)) return text(`There is no file or folder ${p.path}.`);
      if (full === resolve(ctx.cwd)) return text("catai does not delete the project folder.");
      const folder = statSync(full).isDirectory();
      rmSync(full, { recursive: true, force: true });
      return text(`Deleted the ${folder ? "folder" : "file"} ${p.path}.`);
    },
  });

  pi.registerTool({
    name: "mkdir",
    label: "Make folder",
    description: "Make a folder, and the folders above it if necessary.",
    promptSnippet: "Make a folder",
    parameters: Type.Object({ path: Type.String({ description: "The new folder" }) }),
    async execute(_id, p, _s, _u, ctx) {
      const full = fullPath(ctx.cwd, p.path);
      if (existsSync(full)) return text(statSync(full).isDirectory() ? `The folder ${p.path} exists.` : `${p.path} is a file.`);
      mkdirSync(full, { recursive: true });
      return text(`Made the folder ${p.path}.`);
    },
  });
}

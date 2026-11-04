// "show_preview" tool: in the desktop app, open a web page in the side panel next to the chat. Use it for a web site or
// a JavaScript app that the student works on: a local server (http://localhost:3000) or an HTML file in the project.
// The app reloads the preview after each agent turn, so the student sees the changes.
// How it gets to the app: a notice "[preview] <url>". In the terminal, the tool gives the URL to open in a browser.
// See src/md/features/desktop.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Type } from "typebox";

export const PREVIEW_PREFIX = "[preview] ";
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export function registerPreview(pi: ExtensionAPI) {
  pi.registerTool({
    name: "show_preview",
    label: "Preview",
    description:
      "Show a web page in the app's side panel, next to the chat: a local server (for example http://localhost:5173) or an HTML file " +
      "in the project (for example index.html). Use it when the student works on a web site or a JavaScript app. Start the server first.",
    promptSnippet: "Show a local web site or an HTML file in the side panel (web preview)",
    promptGuidelines: [
      "When you make or change a web page or a JavaScript app, and the desktop app is open, show it with show_preview so the student sees it.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "http://localhost:<port>/..., http://127.0.0.1:<port>/..., or a path to an HTML file in the project" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let url = params.url.trim();
      if (!/^https?:\/\//i.test(url)) {
        const full = resolve(ctx.cwd, url.replace(/^file:\/\//, ""));
        const rel = relative(ctx.cwd, full);
        if (rel.startsWith("..") || isAbsolute(rel)) return text("The file is not in the project. Use a file in the project folder.");
        if (!existsSync(full)) return text(`There is no file ${rel}.`);
        url = pathToFileURL(full).href;
      } else if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url)) {
        return text("The preview shows only local servers (localhost) and project files. Give the student the link for other sites.");
      }
      if (ctx.mode !== "rpc") return text(`The terminal has no side panel. Tell the student to open ${url} in a browser.`);
      ctx.ui.notify(`${PREVIEW_PREFIX}${url}`, "info");
      return text(`The preview of ${url} is open in the side panel. It reloads after each of your turns.`);
    },
  });
}

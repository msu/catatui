// Keep AGENTS.md in the project folder current. pi reads it when a chat starts. If the student changes, makes,
// or deletes it during a chat, the next turn uses the new text (systemPromptOptions.contextFiles), and the agent
// gets a short note that the instructions changed. Works in the CLI and in the desktop app.
// See src/md/features/desktop.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const read = (path: string) => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };

// The context files with the current AGENTS.md of the project folder: changed, added, or removed.
export function withCurrentAgents(files: { path: string; content: string }[], path: string, content: string | undefined) {
  const others = files.filter((f) => resolve(f.path) !== resolve(path));
  return content === undefined ? others : [...others, { path, content }];
}

export function registerAgentsFile(pi: ExtensionAPI) {
  // The text that the agent has now. undefined: not known yet (the first turn takes it from pi).
  let seen: string | undefined | null = null;
  pi.on("session_start", async () => { seen = null; });
  pi.on("before_agent_start", async (event, ctx) => {
    const path = join(ctx.cwd, "AGENTS.md");
    const now = read(path);
    const opts = event.systemPromptOptions;
    if (seen === null) {
      // The first turn of this chat: pi loaded the file at the start. Use the text from that load.
      seen = opts.contextFiles.find((f) => resolve(f.path) === resolve(path))?.content;
    }
    if (now === seen) return;
    opts.contextFiles = withCurrentAgents(opts.contextFiles, path, now);
    const what = now === undefined ? "deleted AGENTS.md. Do not follow its old instructions." :
      seen === undefined ? "made AGENTS.md. Follow its instructions in the system prompt from now on." :
      "changed AGENTS.md. Follow the new instructions in the system prompt from now on.";
    seen = now;
    return { message: { customType: "catai-agents-md", content: `The student ${what}`, display: false } };
  });
}

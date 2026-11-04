// "new_project" tool: the model can make a new project folder for a new, separate task, then move there.
// Example: the student says "I want to plan my semester" in a code project. The model offers a new project.
// - The tool always asks the student first (also in yolo mode), because it makes a folder outside the project.
// - The folder is Documents/catai/<name>, with a README.md that has the goal.
// - Desktop app (RPC mode): the status "catatui-switch" tells the app to open the folder and start a new chat
//   with the goal. catatui cannot change its own folder while it runs, so the app starts it again there.
// - CLI: the tool tells the student to cd to the folder and start catatui.
// See src/md/features/new-project.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";

const PARAMS = Type.Object({
  name: Type.String({ description: "A short folder name for the project, for example \"Semester Plan\" or \"CSCI 132 Lab 3\"" }),
  goal: Type.String({ description: "What the student wants to do in the new project, in one or two sentences" }),
});

// The parent folder for new projects. Documents is a folder that students know and that backups include.
export const projectsRoot = () => join(homedir(), "Documents", "catai");

// Letters, digits, spaces, dots, - and _ only, so the name is a safe folder name on all systems.
function safeName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 60);
  return clean || "New Project";
}

// A folder that does not exist yet: "<name>", then "<name> 2", "<name> 3".
function freeFolder(root: string, name: string): string {
  let path = join(root, name);
  for (let i = 2; existsSync(path); i++) path = join(root, `${name} ${i}`);
  return path;
}

export function registerNewProject(pi: ExtensionAPI) {
  pi.registerTool({
    name: "new_project",
    label: "New project",
    description:
      "Make a new project folder (in Documents/catai) for a new, separate task, and move the work there. " +
      "The student must approve it. Use it when the task does not belong in the current project, for example planning a semester " +
      "while the current folder is a code project. Ask the student in chat first if you are not sure that they want a new project.",
    promptSnippet: "Make a new project folder for a new, separate task and move there",
    promptGuidelines: [
      "If the student starts a new task that does not belong in the current project folder (for example \"I want to plan my semester\" in a code project), offer to make a new project with new_project. Do not use it for work that belongs in this project.",
    ],
    parameters: PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const root = projectsRoot();
      const path = freeFolder(root, safeName(params.name));
      const rpc = ctx.mode === "rpc";
      const choice = ctx.hasUI
        ? await ctx.ui.select(
          `Make a new project?\n\n  ${path}\n\ncatatui will make this folder${rpc ? ", then move this work there and start a new chat" : ""}.\nGoal: ${params.goal}`,
          [rpc ? "Make the project and move there" : "Make the project", "No"],
        )
        : undefined;
      if (!choice || choice === "No") {
        return { content: [{ type: "text", text: "The student did not want a new project. Continue in this project, or ask what they want." }], details: {} };
      }
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "README.md"), `# ${safeName(params.name)}\n\n${params.goal}\n`);
      if (rpc) {
        // The app reads this after the agent is done. Then it opens the folder and sends the goal to a new chat.
        ctx.ui.setStatus("catatui-switch", JSON.stringify({ path, goal: params.goal }));
        return {
          content: [{ type: "text", text: `Made ${path}. The app will move to it and start a new chat when you are done. Tell the student in one short sentence, and stop.` }],
          details: { path },
        };
      }
      return {
        content: [{ type: "text", text: `Made ${path} with a README.md. catatui cannot change its folder while it runs. Tell the student to quit (Ctrl+C twice), then run: cd "${path}" and catatui` }],
        details: { path },
      };
    },
  });
}

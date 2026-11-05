// "/catai-moved": the desktop app moved files or folders in the project (drag and drop in the file tree).
// The agent gets a note with its next message, so it uses the new paths. The note does not start a turn.
// See src/md/features/desktop.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface Move { from: string; to: string }

export function movedNote(moves: Move[]): string {
  return `The student moved ${moves.length === 1 ? "an item" : "items"} in the project with the file tree: ` +
    moves.map((m) => `${m.from} -> ${m.to}`).join("; ") +
    ". Use the new paths. If other files link to or import the old paths, tell the student, and fix them if the student agrees.";
}

export function addedNote(paths: string[]): string {
  return `The student added ${paths.length === 1 ? "an item" : "items"} to the project from outside it (a copy): ${paths.join("; ")}. ` +
    "Do not read them now. Use them when the student asks.";
}

export function editedNote(paths: string[]): string {
  return `The student edited ${paths.join(", ")} in the catai editor. Read ${paths.length === 1 ? "it" : "them"} again before you change ${paths.length === 1 ? "it" : "them"}.`;
}

export function deletedNote(paths: string[]): string {
  return `The student deleted ${paths.join(", ")} (moved to the Trash) with the file tree. Do not use ${paths.length === 1 ? "it" : "them"} again unless the student asks.`;
}

export function registerMoved(pi: ExtensionAPI) {
  // "/catai-deleted [paths]": files or folders that the student moved to the Trash with the file tree.
  pi.registerCommand("catai-deleted", {
    description: "(catai app) Tell the agent about files that the student deleted",
    handler: async (args) => {
      let paths: string[];
      try { paths = JSON.parse(args); } catch { return; }
      if (!Array.isArray(paths) || !paths.length) return;
      pi.sendMessage({ customType: "catai-deleted", content: deletedNote(paths), display: false, details: { paths } }, { deliverAs: "nextTurn" });
    },
  });
  // "/catai-edited [paths]": files that the student changed in the editor of the side panel.
  pi.registerCommand("catai-edited", {
    description: "(catai app) Tell the agent about files that the student edited",
    handler: async (args) => {
      let paths: string[];
      try { paths = JSON.parse(args); } catch { return; }
      if (!Array.isArray(paths) || !paths.length) return;
      pi.sendMessage({ customType: "catai-edited", content: editedNote(paths), display: false, details: { paths } }, { deliverAs: "nextTurn" });
    },
  });
  // "/catai-added [paths]": files or folders that the student copied into the project (drag and drop from Finder).
  pi.registerCommand("catai-added", {
    description: "(catai app) Tell the agent about files that the student copied into the project",
    handler: async (args) => {
      let paths: string[];
      try { paths = JSON.parse(args); } catch { return; }
      if (!Array.isArray(paths) || !paths.length) return;
      pi.sendMessage({ customType: "catai-added", content: addedNote(paths), display: false, details: { paths } }, { deliverAs: "nextTurn" });
    },
  });
  pi.registerCommand("catai-moved", {
    description: "(catai app) Tell the agent about files that the student moved in the file tree",
    handler: async (args) => {
      let moves: Move[];
      try { moves = JSON.parse(args); } catch { return; }
      if (!Array.isArray(moves) || !moves.length) return;
      pi.sendMessage({ customType: "catai-moved", content: movedNote(moves), display: false, details: { moves } }, { deliverAs: "nextTurn" });
    },
  });
}

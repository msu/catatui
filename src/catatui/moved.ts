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

export function registerMoved(pi: ExtensionAPI) {
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

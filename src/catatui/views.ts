// "open_view" tool (desktop app): offer a button in the chat that opens another area of the app: Advising or Classes
// (all classes, or one class chat). The student clicks the button; the tool does not switch by itself.
// The app draws the tool call as a card with the button. The system prompt (APP_PROMPT in widget.ts) lists the areas.
// See src/md/features/desktop.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export function registerViews(pi: ExtensionAPI) {
  pi.registerTool({
    name: "open_view",
    label: "Open",
    description:
      "In the desktop app, show a button that opens another area of catai: advising (transcript, degree requirements, next semester's classes, " +
      "send a plan to the advisor) or classes (grades, assignments, due dates, syllabus, lecture notes; course: one class chat). " +
      "Use it when the student asks about these and the data is not in this chat.",
    promptSnippet: "Offer a button that opens Advising or Classes (or one class chat) in the app",
    parameters: Type.Object({
      view: Type.Union([Type.Literal("advising"), Type.Literal("classes")]),
      course: Type.Optional(Type.String({ description: "For classes: one class, for example CSCI 305" })),
      reason: Type.String({ description: "One short sentence for the button card: what the student can do there" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (ctx.mode !== "rpc") return text("The terminal has no Advising or Classes areas. Help the student in this chat.");
      const where = params.view === "advising" ? "Advising" : params.course ? `the ${params.course} class chat` : "Classes";
      return text(`The chat shows a button that opens ${where}. If another area also fits, call open_view again for it now. ` +
        "Then stop, or add one short sentence. Do not repeat what you wrote before the button, and do not answer with data that you do not have.");
    },
  });
}

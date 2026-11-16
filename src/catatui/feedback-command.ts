// "/feedback": the student sends feedback about catatui to the course staff. The client is feedback.ts.
// Nothing goes out before the student answers each question. See src/md/features/feedback.md.

import { buildSessionContext, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildReport, conversationText, netId, sendReport } from "./feedback.ts";

const PREVIEW_LINES = 8;

export interface FeedbackDeps {
  send: typeof sendReport;
  conversation: (ctx: ExtensionCommandContext) => string;
  netId: () => string | undefined;
}

const defaults: FeedbackDeps = {
  send: sendReport,
  conversation: (ctx) => conversationText(buildSessionContext(ctx.sessionManager.getBranch()).messages),
  netId: () => netId(),
};

const size = (s: string) => {
  const n = Buffer.byteLength(s);
  return n < 1024 ? `${n} bytes` : `${(n / 1024).toFixed(1)} KB`;
};

export function registerFeedback(pi: ExtensionAPI, deps: FeedbackDeps = defaults) {
  pi.registerCommand("feedback", {
    description: "Send feedback about catatui to the course staff",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/feedback needs the catatui screen, because it asks questions before it sends. Start catatui in a terminal, then type /feedback.", "error");
        return;
      }
      const text = (await ctx.ui.input("Your feedback for the course staff (what worked, what did not work):", "Type your feedback"))?.trim();
      if (!text) {
        ctx.ui.notify("No feedback sent.", "info");
        return;
      }

      let conversation: string | undefined;
      const conv = deps.conversation(ctx);
      if (conv) {
        const first = conv.split("\n").slice(0, PREVIEW_LINES).map((l) => `  ${l.length > 100 ? `${l.slice(0, 97)}...` : l}`).join("\n");
        const choice = await ctx.ui.select(`Attach this conversation? (${size(conv)})\n\n${first}\n  ...`, ["No", "Yes, attach it"]);
        if (choice === undefined) return ctx.ui.notify("No feedback sent.", "info");
        if (choice === "Yes, attach it") conversation = conv;
      }

      let contact: string | undefined;
      const id = deps.netId();
      if (id) {
        const choice = await ctx.ui.select(`Can we contact you about this? (sends your NetID: ${id})`, ["No", "Yes, send my NetID"]);
        if (choice === undefined) return ctx.ui.notify("No feedback sent.", "info");
        if (choice === "Yes, send my NetID") contact = id;
      }

      let report;
      try {
        report = buildReport({ app: "catatui", kind: "feedback", text, conversation, contact, model: ctx.model?.id });
      } catch (e) {
        return ctx.ui.notify((e as Error).message, "error");
      }
      ctx.ui.notify("Sending the feedback...", "info");
      const r = await deps.send(report);
      if ("id" in r) ctx.ui.notify(`Thank you. Report ${r.id} sent.`, "info");
      else ctx.ui.notify(r.error, "error");
    },
  });
}

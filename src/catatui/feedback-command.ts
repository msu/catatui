// "/feedback": the student sends feedback about catatui to the course staff. The client is feedback.ts.
// Nothing goes out before the student answers each question. See src/md/features/feedback.md.
// catatui keeps the last error in memory: a model or provider error, or a failed compaction. pi gives extensions
// no event for an extension error, and a tool error is a normal result for the model, so these are not kept.

import { buildSessionContext, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildReport, cleanTrace, conversationText, netId, sendReport } from "./feedback.ts";

const PREVIEW_LINES = 8;
const TRACE_LINES = 15;

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

// The text of an error for a report: what failed, and when.
export function errorText(source: string, message: string, at = new Date()): string {
  return `${source} (${at.toISOString()}):\n${message}`;
}

export function registerFeedback(pi: ExtensionAPI, deps: FeedbackDeps = defaults) {
  let lastError: string | undefined;
  pi.on("message_end", (event) => {
    const m = event.message as { role?: string; stopReason?: string; errorMessage?: string; provider?: string; model?: string };
    if (m.role === "assistant" && m.stopReason === "error") {
      lastError = errorText(`Model error from ${m.provider ?? "?"}/${m.model ?? "?"}`, m.errorMessage ?? "The model returned an error with no message.");
    }
  });
  pi.on("session_compact_failed", (event) => {
    if (!event.aborted) lastError = errorText(`Compaction failed (${event.reason})`, event.errorMessage ?? "No message.");
  });

  pi.registerCommand("feedback", {
    description: "Send feedback about catatui to the course staff",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/feedback needs the catatui screen, because it asks questions before it sends. Start catatui in a terminal, then type /feedback.", "error");
        return;
      }
      // The last error first: the student reads the cleaned trace before the question.
      let error: string | undefined;
      if (lastError) {
        const trace = cleanTrace(lastError);
        const lines = trace.split("\n");
        const shown = lines.slice(0, TRACE_LINES).map((l) => `  ${l.length > 100 ? `${l.slice(0, 97)}...` : l}`).join("\n");
        const first = (lines[1] ?? lines[0]).trim();
        const short = first.length > 60 ? `${first.slice(0, 57)}...` : first;
        const choice = await ctx.ui.select(`Attach the last error (${short})?\n\n${shown}${lines.length > TRACE_LINES ? "\n  ..." : ""}`, ["No", "Yes, attach it"]);
        if (choice === undefined) return ctx.ui.notify("No feedback sent.", "info");
        if (choice === "Yes, attach it") error = trace;
      }

      const text = (await ctx.ui.input(error ? "What did you do when the error came? (You can leave this empty.)" : "Your feedback for the course staff (what worked, what did not work):", "Type your feedback"))?.trim();
      if (text === undefined || (!text && !error)) {
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
        report = buildReport({ app: "catatui", kind: error ? "error" : "feedback", text, error, conversation, contact, model: ctx.model?.id });
      } catch (e) {
        return ctx.ui.notify((e as Error).message, "error");
      }
      ctx.ui.notify("Sending the feedback...", "info");
      const r = await deps.send(report);
      if ("id" in r) {
        ctx.ui.notify(`Thank you. Report ${r.id} sent.`, "info");
        if (error) lastError = undefined;
      }
      else ctx.ui.notify(r.error, "error");
    },
  });
}

// /context: show the context window as a grid of 100 cells, like /context in Claude Code.
// The parts are not estimates. Probe requests to CatChat (maxTokens: 1) get the token counts from the model server.
// See src/md/features/context.md.

import type { Api, Message, Model, Tool } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { buildSessionContext, convertToLlm, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const CELLS = 100;
const PER_ROW = 10;

async function promptTokens(ctx: ExtensionCommandContext, model: Model<Api>, systemPrompt: string, tools: Tool[], messages: Message[]): Promise<number> {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error("catatui cannot get your CatChat key. Run /login catchat, then try again.");
  const dot: Message = { role: "user", content: ".", timestamp: Date.now() };
  const res = await completeSimple(
    { ...model, ...(auth.baseUrl ? { baseUrl: auth.baseUrl } : {}) },
    { systemPrompt, tools: tools.length ? tools : undefined, messages: [...messages, dot] },
    { apiKey: auth.apiKey, headers: auth.headers, maxTokens: 1 },
  );
  if (res.stopReason === "error" || res.stopReason === "aborted") {
    throw new Error(`CatChat did not answer the token count request: ${res.errorMessage ?? res.stopReason}. Try again.`);
  }
  return res.usage.input + res.usage.cacheRead + res.usage.cacheWrite;
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

export function registerContext(pi: ExtensionAPI) {
  pi.registerCommand("context", {
    description: "Show what uses the context window",
    handler: async (_args, ctx) => {
      const model = ctx.model;
      if (!model) return ctx.ui.notify("No model is selected. Type /model to pick one.", "error");

      const active = new Set(pi.getActiveTools());
      const tools: Tool[] = pi.getAllTools()
        .filter((t) => active.has(t.name))
        .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters as object }));
      const systemPrompt = ctx.getSystemPrompt();
      // pi keeps a copy of the system prompt as a "system" message in the session. Probe 1 counts it, so remove it here.
      const messages = convertToLlm(buildSessionContext(ctx.sessionManager.getBranch()).messages).filter((m) => (m.role as string) !== "system");

      ctx.ui.notify("Counting tokens with CatChat...", "info");
      let counts: number[];
      try {
        const system = await promptTokens(ctx, model, systemPrompt, [], []);
        const withTools = await promptTokens(ctx, model, systemPrompt, tools, []);
        const all = messages.length ? await promptTokens(ctx, model, systemPrompt, tools, messages) : withTools;
        counts = [system, withTools - system, all - withTools];
      } catch (e) {
        return ctx.ui.notify((e as Error).message, "error");
      }

      const t = ctx.ui.theme;
      const window = model.contextWindow;
      const used = counts.reduce((a, b) => a + b, 0);
      const parts = [
        { label: "System prompt", tokens: counts[0], color: "accent" as const },
        { label: "Tools", tokens: counts[1], color: "warning" as const },
        { label: "Messages", tokens: counts[2], color: "success" as const },
      ];

      // Cells for each part. A part with tokens gets one cell or more.
      const cells: string[] = [];
      for (const p of parts) {
        const n = p.tokens > 0 ? Math.max(1, Math.round((p.tokens / window) * CELLS)) : 0;
        for (let i = 0; i < n && cells.length < CELLS; i++) cells.push(t.fg(p.color, "■"));
      }
      while (cells.length < CELLS) cells.push(t.fg("dim", "□"));

      const legend = [
        t.bold(`${model.id}  ${fmt(used)} / ${fmt(window)} tokens (${((used / window) * 100).toFixed(1)}%)`),
        "",
        ...parts.map((p) => `${t.fg(p.color, "■")} ${p.label}: ${fmt(p.tokens)} (${((p.tokens / window) * 100).toFixed(1)}%)`),
        `${t.fg("dim", "□")} Free: ${fmt(Math.max(0, window - used))} (${(((window - used) / window) * 100).toFixed(1)}%)`,
      ];
      const lines: string[] = [];
      for (let r = 0; r < CELLS / PER_ROW; r++) {
        lines.push(`${cells.slice(r * PER_ROW, (r + 1) * PER_ROW).join(" ")}   ${legend[r] ?? ""}`);
      }
      lines.push("", t.fg("dim", "CatChat counted the tokens with the model's tokenizer. Each cell is 1% of the context window."));
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

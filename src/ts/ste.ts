// Simplified Technical English (STE): on by default. "/mode" (permissions.ts) can turn it on and off.
// The choice stays after catatui stops: it is in <agent dir>/catatui.json (default ~/.catatui/catatui.json).
// The rules are in the simplified-technical-english skill. A skill loads only when the model asks for it,
// so while STE is on, this file puts the skill text in the system prompt for each request.

import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SKILL = new URL("../../skills/simplified-technical-english/SKILL.md", import.meta.url);
// The skill text without the frontmatter.
const RULES = readFileSync(SKILL, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();

const SETTINGS = join(getAgentDir(), "catatui.json");

function readSettings(): Record<string, unknown> {
  try {
    return existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, "utf8")) : {};
  } catch {
    return {}; // A bad file: use the defaults.
  }
}

let on = readSettings().ste !== false;

export const steOn = () => on;

// The footer shows "ste: off" only when STE is off.
export function setSte(ctx: ExtensionContext, value: boolean) {
  if (value !== on) writeFileSync(SETTINGS, `${JSON.stringify({ ...readSettings(), ste: value }, null, 2)}\n`);
  on = value;
  if (ctx.hasUI) ctx.ui.setStatus("ste", on ? undefined : `${ctx.ui.theme.fg("dim", "ste:")} ${ctx.ui.theme.fg("muted", "off")}`);
}

export function registerSte(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => setSte(ctx, on));

  pi.on("before_agent_start", async (event) => {
    if (on) event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, "simplified-technical-english": RULES };
  });
}

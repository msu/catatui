// Safety modes, like the permission modes in Claude Code. The footer shows "mode: ...".
// "/safety" changes the mode. Tab completes the mode names.
// - ask:  ask before each file change, bash command, and http request. This is the default.
// - plan: read only. Block file changes and http requests other than GET. Ask before the rest.
//         Tell the model to make a plan.
// - yolo: ask nothing.
// In ask and plan mode, risky commands and changes outside the project folder always ask.
// The mode and the "do not ask again" choices last for one session only.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative, resolve } from "node:path";

type Mode = "ask" | "plan" | "yolo";
const MODES: Mode[] = ["ask", "plan", "yolo"];

const MODE_LABELS: Record<Mode, string> = {
  ask: "ask",
  plan: "plan (read only)",
  yolo: "yolo (no questions)",
};

const MODE_HELP: Record<Mode, string> = {
  ask: "Ask before each file change, command, and http request",
  plan: "Read only. The model writes a plan",
  yolo: "Ask nothing",
};

// These always ask, and the student cannot allow them for the whole session.
const RISKY = [
  /\bgit\s+(commit|push|reset|rebase|clean|checkout\s+--|restore)\b/,
  /\brm\s/,
  /\bsudo\b/,
  /\b(chmod|chown)\b/,
  /\b(curl|wget)\b.*\|\s*(sh|bash|zsh)\b/,
];

const PLAN_CONTEXT = `[PLAN MODE]
The student turned on plan mode. Do not change files. The edit and write tools are blocked.
Read the code, then write a numbered plan. The student will turn off plan mode to carry it out.`;

const ALLOW_EDITS = "Yes, and do not ask again for file changes in this project this session";

export function registerPermissions(pi: ExtensionAPI) {
  let mode: Mode = "ask";
  let editsAllowed = false;
  // First words of bash commands that the student allowed for this session, for example "npm".
  const allowedCommands = new Set<string>();
  // Hosts that the student allowed for GET requests from the http tool this session.
  const allowedHosts = new Set<string>();

  const showMode = (ctx: ExtensionContext) => {
    const color = mode === "ask" ? "muted" : mode === "plan" ? "accent" : "warning";
    ctx.ui.setStatus("mode", `${ctx.ui.theme.fg("dim", "mode:")} ${ctx.ui.theme.fg(color, MODE_LABELS[mode])}`);
  };

  const nextMode = (ctx: ExtensionContext) => {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    showMode(ctx);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) showMode(ctx);
  });

  pi.registerCommand("safety", {
    description: "Change the safety mode: ask, plan, or yolo. With no mode, go to the next one.",
    getArgumentCompletions: (prefix: string) =>
      MODES.filter((m) => m.startsWith(prefix.trim())).map((m) => ({ value: m, label: m, description: MODE_HELP[m] })),
    handler: async (args, ctx) => {
      const want = args.trim() as Mode;
      if (want && !MODES.includes(want)) {
        ctx.ui.notify(`Unknown safety mode "${want}". Use ask, plan, or yolo.`, "error");
        return;
      }
      if (want) {
        mode = want;
        showMode(ctx);
      } else {
        nextMode(ctx);
      }
      ctx.ui.notify(`Mode: ${MODE_LABELS[mode]}`, mode === "yolo" ? "warning" : "info");
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (event.messageType !== "user" || mode !== "plan") return;
    return { message: { customType: "plan-mode-context", content: PLAN_CONTEXT, display: false } };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (mode === "yolo") return;

    if (event.toolName === "edit" || event.toolName === "write") {
      if (mode === "plan") return { block: true, reason: "Plan mode is on. Do not change files. Write a plan." };
      const path = String(event.input.path ?? "");
      const rel = relative(ctx.cwd, resolve(ctx.cwd, path));
      const inProject = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      if (editsAllowed && inProject) return;
      const where = inProject ? path : `${path} (outside the project folder)`;
      const choice = await ask(ctx, `Allow ${event.toolName} ${where}?`, inProject ? ["Yes", ALLOW_EDITS, "No"] : ["Yes", "No"]);
      if (choice === ALLOW_EDITS) editsAllowed = true;
      return choice?.startsWith("Yes") ? undefined : { block: true, reason: "The student did not allow this change." };
    }

    if (event.toolName === "http") {
      const method = String(event.input.method ?? "GET").toUpperCase();
      const url = String(event.input.url ?? "");
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        return { block: true, reason: `"${url}" is not a full URL. Use a URL like https://example.com/page.` };
      }
      const read = method === "GET" || method === "HEAD";
      if (mode === "plan" && !read) return { block: true, reason: "Plan mode is on. Only GET requests. Write a plan." };
      if (read && allowedHosts.has(host)) return;
      const always = `Yes, and do not ask again for GET requests to ${host} this session`;
      const choice = await ask(ctx, `Send this request?\n\n  ${method} ${url}`, read ? ["Yes", always, "No"] : ["Yes", "No"]);
      if (choice === always) allowedHosts.add(host);
      return choice?.startsWith("Yes") ? undefined : { block: true, reason: "The student did not allow this request." };
    }

    if (event.toolName === "bash") {
      const command = String(event.input.command ?? "");
      const first = command.trim().split(/\s+/)[0] ?? "";
      const risky = RISKY.some((re) => re.test(command));
      if (!risky && allowedCommands.has(first)) return;
      const always = `Yes, and do not ask again for "${first}" commands this session`;
      const choice = await ask(ctx, `Run this command?\n\n  ${command}`, risky ? ["Yes", "No"] : ["Yes", always, "No"]);
      if (choice === always) allowedCommands.add(first);
      return choice?.startsWith("Yes") ? undefined : { block: true, reason: "The student did not allow this command." };
    }
  });
}

// Without a UI (for example "catatui -p"), nobody can answer, so the answer is no.
async function ask(ctx: ExtensionContext, title: string, options: string[]): Promise<string | undefined> {
  if (!ctx.hasUI) return undefined;
  return ctx.ui.select(title, options);
}

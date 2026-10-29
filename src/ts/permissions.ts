// Modes and options, like the permission modes in Claude Code. The footer shows "mode: ...".
// "/mode" opens a panel. Space or Enter changes the line under the cursor. The panel stays open until Escape.
//   Mode (one of):
//   - ask:  ask before each file change, bash command, and http request. This is the default.
//   - plan: the model writes a plan to PLAN_FILE and changes no other files. Block http requests other than GET.
//   - yolo: ask nothing.
//   Flags (on or off):
//   - ta:      teaching assistant. Block file changes and http requests other than GET, in all modes.
//              The model explains and gives hints, but does not write the solution.
//              Students can turn it off, so it is a learning aid, not an integrity control.
//   - sandbox: sandbox.ts
//   - ste:     Simplified Technical English, ste.ts
// "/mode ask|plan|yolo" sets the mode. "/mode ta" turns ta on or off. Tab completes these words.
// In ask and plan mode, risky commands and changes outside the project folder always ask.
// The mode, ta, and the "do not ask again" choices last for one session only.

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve } from "node:path";
import { sandboxOn, setSandbox } from "./sandbox.ts";
import { setSte, steOn } from "./ste.ts";

type Mode = "ask" | "plan" | "yolo";
const MODES: Mode[] = ["ask", "plan", "yolo"];

const MODE_HELP: Record<Mode, string> = {
  ask: "The agent will ask before each file change, command and http request.",
  plan: "Planning mode. The model will write a plan file for work but make no changes.",
  yolo: "The agent will make changes without asking you to approve them.",
};

type Flag = "ta" | "sandbox" | "ste";
const FLAGS: Flag[] = ["ta", "sandbox", "ste"];

const FLAG_HELP: Record<Flag, string> = {
  ta: "Teaching assistant. The agent explains and gives hints, but does not write your code.",
  sandbox: "The agent can use only the files in the project folder.",
  ste: "Simplified Technical English. The agent writes short, clear sentences.",
};

// In plan mode, the model can write only this file in the project folder.
const PLAN_FILE = "PLAN.md";

// Commands that can run any other command. The student cannot allow them for the whole session,
// because "do not ask again for npx" allows all of npx.
const RUNNERS = ["npx", "sh", "bash", "zsh", "eval", "xargs", "env", "python", "python3", "node", "exec", "sudo"];

// These always ask, and the student cannot allow them for the whole session.
const RISKY = [
  /\bgit\s+(commit|push|reset|rebase|clean|checkout\s+--|restore)\b/,
  /\brm\s/,
  /\bsudo\b/,
  /\b(chmod|chown)\b/,
  /\b(curl|wget)\b.*\|\s*(sh|bash|zsh)\b/,
];

const PLAN_CONTEXT = `[PLAN MODE]
The student turned on plan mode. Do not change project files.
Read the code, then write a numbered plan to ${PLAN_FILE} in the project folder with the write tool.
The edit and write tools are blocked for all other files. The student will turn off plan mode to carry out the plan.`;

// The system prompt section for ta. It stays in the prompt while ta is on.
const TA_PROMPT = `The student turned on teaching assistant mode. You are a teaching assistant in a computer science course.
- Do not write the solution to the student's task. Do not change files. The edit and write tools are blocked.
- Explain concepts. Ask guiding questions. Give hints one step at a time, from small hints to larger hints.
- Point to the file and line with a problem, and explain why it is a problem. Let the student write the fix.
- You can show short, general code examples that teach a concept, for example how a for loop works in Python.
  An example must not solve the student's task, and must not use the names from the student's code.
- You can read files and run commands (for example tests and compilers) to understand the student's problem.
- If the student asks for the full solution, say that teaching assistant mode is on, then give the next hint.
  The student can turn it off with /mode.`;

const TA_BLOCK = "Teaching assistant mode is on. Do not change files. Give the student a hint.";
const PLAN_BLOCK = `Plan mode is on. Do not change project files. Write the plan to ${PLAN_FILE}.`;

const ALLOW_EDITS = "Yes, and do not ask again for file changes in this project this session";

export function registerPermissions(pi: ExtensionAPI) {
  let mode: Mode = "ask";
  let ta = false;
  let editsAllowed = false;
  // First words of bash commands that the student allowed for this session, for example "npm".
  const allowedCommands = new Set<string>();
  // Hosts that the student allowed for GET requests from the http tool this session.
  const allowedHosts = new Set<string>();

  const showStatus = (ctx: ExtensionContext) => {
    const t = ctx.ui.theme;
    const color = mode === "ask" ? "muted" : mode === "yolo" ? "warning" : "accent";
    ctx.ui.setStatus("mode", `${t.fg("dim", "mode:")} ${t.fg(color, mode)}`);
    ctx.ui.setStatus("ta", ta ? `${t.fg("dim", "ta:")} ${t.fg("accent", "on")}` : undefined);
  };

  const flagOn = (f: Flag) => (f === "ta" ? ta : f === "sandbox" ? sandboxOn() : steOn());
  const setFlag = (ctx: ExtensionContext, f: Flag, value: boolean) => {
    if (f === "ta") ta = value;
    if (f === "sandbox") setSandbox(ctx, value);
    if (f === "ste") setSte(ctx, value);
    showStatus(ctx);
  };

  // The /mode panel. Rows 0-2 are the modes, rows 3-5 are the flags.
  const panel = (ctx: ExtensionContext) =>
    ctx.ui.custom<void>((tui, theme: Theme, _kb, done) => {
      let row = MODES.indexOf(mode);
      const rows = MODES.length + FLAGS.length;
      const line = (i: number, mark: string, name: string, help: string) => {
        const cursor = i === row ? theme.fg("accent", "> ") : "  ";
        const text = `${mark} ${name.padEnd(8)} ${theme.fg("muted", help)}`;
        return `${cursor}${i === row ? theme.bold(text) : text}`;
      };
      return {
        render(width: number) {
          const lines = [
            theme.fg("accent", theme.bold("Mode and options")),
            "",
            theme.fg("dim", "Mode (pick one)"),
            ...MODES.map((m, i) => line(i, m === mode ? "(*)" : "( )", m, MODE_HELP[m])),
            "",
            theme.fg("dim", "Options (on or off)"),
            ...FLAGS.map((f, i) => line(MODES.length + i, flagOn(f) ? "[x]" : "[ ]", f, FLAG_HELP[f])),
            "",
            theme.fg("dim", "up/down move   space/enter change   escape close"),
          ];
          return lines.map((l) => truncateToWidth(l, width));
        },
        invalidate() {},
        handleInput(data: string) {
          if (matchesKey(data, "escape")) return done();
          if (matchesKey(data, "up")) row = (row + rows - 1) % rows;
          if (matchesKey(data, "down")) row = (row + 1) % rows;
          if (matchesKey(data, "space") || matchesKey(data, "enter")) {
            if (row < MODES.length) mode = MODES[row];
            else {
              const f = FLAGS[row - MODES.length];
              setFlag(ctx, f, !flagOn(f));
            }
            showStatus(ctx);
          }
          tui.requestRender();
        },
      };
    });

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) showStatus(ctx);
  });

  const WORDS = [...MODES, "ta"];
  pi.registerCommand("mode", {
    description: "Pick the mode (ask, plan, yolo), and turn ta, the sandbox, and Simplified Technical English on or off",
    getArgumentCompletions: (prefix: string) =>
      WORDS.filter((w) => w.startsWith(prefix.trim())).map((w) => ({
        value: w,
        label: w,
        description: w === "ta" ? `Turn on or off. ${FLAG_HELP.ta}` : MODE_HELP[w as Mode],
      })),
    handler: async (args, ctx) => {
      const want = args.trim();
      if (!want) return ctx.mode === "tui" ? panel(ctx) : ctx.ui.notify(`Mode: ${mode}. ta: ${ta ? "on" : "off"}.`, "info");
      if (want === "ta") {
        setFlag(ctx, "ta", !ta);
        ctx.ui.notify(`Teaching assistant: ${ta ? "on" : "off"}`, "info");
        return;
      }
      if (!MODES.includes(want as Mode)) {
        ctx.ui.notify(`Unknown word "${want}". Use ask, plan, yolo, or ta.`, "error");
        return;
      }
      mode = want as Mode;
      showStatus(ctx);
      ctx.ui.notify(`Mode: ${mode}`, mode === "yolo" ? "warning" : "info");
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (ta) event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, "teaching-assistant": TA_PROMPT };
    if (event.messageType !== "user" || mode !== "plan") return;
    return { message: { customType: "plan-mode-context", content: PLAN_CONTEXT, display: false } };
  });

  pi.on("tool_call", async (event, ctx) => {
    // ta blocks changes in all modes, also in yolo.
    if (ta && (event.toolName === "edit" || event.toolName === "write")) return { block: true, reason: TA_BLOCK };
    if (ta && event.toolName === "http" && !isRead(event.input.method)) return { block: true, reason: `${TA_BLOCK} Send only GET requests.` };
    if (mode === "yolo") return;

    if (event.toolName === "edit" || event.toolName === "write") {
      const path = String(event.input.path ?? "");
      const rel = relative(ctx.cwd, resolve(ctx.cwd, path));
      if (mode === "plan") return rel === PLAN_FILE ? undefined : { block: true, reason: PLAN_BLOCK };
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
      const read = isRead(method);
      if (mode === "plan" && !read) return { block: true, reason: `${PLAN_BLOCK} Send only GET requests.` };
      if (read && allowedHosts.has(host)) return;
      const always = `Yes, and do not ask again for GET requests to ${host} this session`;
      const choice = await ask(ctx, `Send this request?\n\n  ${method} ${url}`, read ? ["Yes", always, "No"] : ["Yes", "No"]);
      if (choice === always) allowedHosts.add(host);
      return choice?.startsWith("Yes") ? undefined : { block: true, reason: "The student did not allow this request." };
    }

    if (event.toolName === "bash") {
      const command = String(event.input.command ?? "");
      const first = command.trim().split(/\s+/)[0] ?? "";
      // A chain (for example "ls && python x.py") can hide a second command after an allowed first word.
      const risky = RISKY.some((re) => re.test(command)) || RUNNERS.includes(first) || /[;&|`]|\$\(/.test(command);
      if (!risky && allowedCommands.has(first)) return;
      const always = `Yes, and do not ask again for "${first}" commands this session`;
      const choice = await ask(ctx, `Run this command?\n\n  ${command}`, risky ? ["Yes", "No"] : ["Yes", always, "No"]);
      if (choice === always) allowedCommands.add(first);
      return choice?.startsWith("Yes") ? undefined : { block: true, reason: "The student did not allow this command." };
    }
  });
}

const isRead = (method: unknown) => ["GET", "HEAD"].includes(String(method ?? "GET").toUpperCase());

// Without a UI (for example "catatui -p"), nobody can answer, so the answer is no.
async function ask(ctx: ExtensionContext, title: string, options: string[]): Promise<string | undefined> {
  if (!ctx.hasUI) return undefined;
  return ctx.ui.select(title, options);
}

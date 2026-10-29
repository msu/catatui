// Safety modes, like the permission modes in Claude Code. The footer shows "mode: ...".
// "/safety" shows a menu to pick the mode, and to turn the sandbox (sandbox.ts) and
// Simplified Technical English (ste.ts) on or off.
// "/safety <mode>" sets the mode. Tab completes the mode names.
// - ask:  ask before each file change, bash command, and http request. This is the default.
// - plan: read only. Block file changes and http requests other than GET. Ask before the rest.
//         Tell the model to make a plan.
// - ta:   teaching assistant. Read only, as in plan mode. The model explains and gives hints,
//         but does not write the solution. Students can turn it off, so it is a learning aid, not an integrity control.
// - yolo: ask nothing.
// In ask, plan, and ta mode, risky commands and changes outside the project folder always ask.
// The mode and the "do not ask again" choices last for one session only.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative, resolve } from "node:path";
import { sandboxOn, setSandbox } from "./sandbox.ts";
import { setSte, steOn } from "./ste.ts";

type Mode = "ask" | "plan" | "ta" | "yolo";
const MODES: Mode[] = ["ask", "plan", "ta", "yolo"];
// Modes that block file changes and http requests other than GET.
const READ_ONLY: Mode[] = ["plan", "ta"];

const MODE_LABELS: Record<Mode, string> = {
  ask: "ask",
  plan: "plan (read only)",
  ta: "ta (teaching assistant)",
  yolo: "yolo (no questions)",
};

const MODE_HELP: Record<Mode, string> = {
  ask: "Ask before each file change, command, and http request",
  plan: "Read only. The model writes a plan",
  ta: "Teaching assistant. The model explains and gives hints, but does not write your code",
  yolo: "Ask nothing",
};

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
The student turned on plan mode. Do not change files. The edit and write tools are blocked.
Read the code, then write a numbered plan. The student will turn off plan mode to carry it out.`;

// The system prompt section for ta mode. It stays in the prompt while ta mode is on.
const TA_PROMPT = `The student turned on teaching assistant mode. You are a teaching assistant in a computer science course.
- Do not write the solution to the student's task. Do not change files. The edit and write tools are blocked.
- Explain concepts. Ask guiding questions. Give hints one step at a time, from small hints to larger hints.
- Point to the file and line with a problem, and explain why it is a problem. Let the student write the fix.
- You can show short, general code examples that teach a concept, for example how a for loop works in Python.
  An example must not solve the student's task, and must not use the names from the student's code.
- You can read files and run commands (for example tests and compilers) to understand the student's problem.
- If the student asks for the full solution, say that teaching assistant mode is on, then give the next hint.
  The student can change the mode with /safety.`;

const BLOCK_REASON: Record<string, string> = {
  plan: "Plan mode is on. Do not change files. Write a plan.",
  ta: "Teaching assistant mode is on. Do not change files. Give the student a hint.",
};

const ALLOW_EDITS = "Yes, and do not ask again for file changes in this project this session";

export function registerPermissions(pi: ExtensionAPI) {
  let mode: Mode = "ask";
  let editsAllowed = false;
  // First words of bash commands that the student allowed for this session, for example "npm".
  const allowedCommands = new Set<string>();
  // Hosts that the student allowed for GET requests from the http tool this session.
  const allowedHosts = new Set<string>();

  const showMode = (ctx: ExtensionContext) => {
    const color = mode === "ask" ? "muted" : mode === "yolo" ? "warning" : "accent";
    ctx.ui.setStatus("mode", `${ctx.ui.theme.fg("dim", "mode:")} ${ctx.ui.theme.fg(color, MODE_LABELS[mode])}`);
  };

  // Menu items: one per mode, then the sandbox and STE switches. "*" marks the current mode.
  const menu = async (ctx: ExtensionContext) => {
    const items = MODES.map((m) => `${m === mode ? "*" : " "} ${m}: ${MODE_HELP[m]}`);
    const sandbox = sandboxOn()
      ? "  Turn the sandbox off (the agent can use files outside the project folder)"
      : "  Turn the sandbox on (the agent can use only files in the project folder)";
    const ste = steOn()
      ? "  Turn Simplified Technical English off (the agent writes in plain English)"
      : "  Turn Simplified Technical English on (short, clear sentences)";
    const onOff = (v: boolean) => (v ? "on" : "off");
    const title = `Safety mode: ${MODE_LABELS[mode]}. Sandbox: ${onOff(sandboxOn())}. Simplified Technical English: ${onOff(steOn())}.`;
    const choice = await ctx.ui.select(title, [...items, sandbox, ste]);
    if (!choice) return;
    if (choice === sandbox) {
      setSandbox(ctx, !sandboxOn());
      ctx.ui.notify(`Sandbox: ${onOff(sandboxOn())}`, sandboxOn() ? "info" : "warning");
      return;
    }
    if (choice === ste) {
      setSte(ctx, !steOn());
      ctx.ui.notify(`Simplified Technical English: ${onOff(steOn())}`, "info");
      return;
    }
    mode = MODES[items.indexOf(choice)];
    showMode(ctx);
    ctx.ui.notify(`Mode: ${MODE_LABELS[mode]}`, mode === "yolo" ? "warning" : "info");
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) showMode(ctx);
  });

  pi.registerCommand("safety", {
    description: "Change the mode (ask, plan, ta, or yolo), and turn the sandbox and Simplified Technical English on or off",
    getArgumentCompletions: (prefix: string) =>
      MODES.filter((m) => m.startsWith(prefix.trim())).map((m) => ({ value: m, label: m, description: MODE_HELP[m] })),
    handler: async (args, ctx) => {
      const want = args.trim() as Mode;
      if (want && !MODES.includes(want)) {
        ctx.ui.notify(`Unknown safety mode "${want}". Use ask, plan, ta, or yolo.`, "error");
        return;
      }
      if (!want) return menu(ctx);
      mode = want;
      showMode(ctx);
      ctx.ui.notify(`Mode: ${MODE_LABELS[mode]}`, mode === "yolo" ? "warning" : "info");
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (mode === "ta") event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, "teaching-assistant": TA_PROMPT };
    if (event.messageType !== "user" || mode !== "plan") return;
    return { message: { customType: "plan-mode-context", content: PLAN_CONTEXT, display: false } };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (mode === "yolo") return;

    if (event.toolName === "edit" || event.toolName === "write") {
      if (READ_ONLY.includes(mode)) return { block: true, reason: BLOCK_REASON[mode] };
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
      if (READ_ONLY.includes(mode) && !read) return { block: true, reason: `${BLOCK_REASON[mode]} Send only GET requests.` };
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

// Without a UI (for example "catatui -p"), nobody can answer, so the answer is no.
async function ask(ctx: ExtensionContext, title: string, options: string[]): Promise<string | undefined> {
  if (!ctx.hasUI) return undefined;
  return ctx.ui.select(title, options);
}

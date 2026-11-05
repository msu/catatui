// Modes and options, like the permission modes in Claude Code. The footer shows "mode: ...".
// "/mode" opens a panel. Space or Enter changes the line under the cursor. The panel stays open until Escape.
//   Mode (one of):
//   - ask:  ask before each file change, bash command, and http request. This is the default.
//   - plan: the model writes a plan to PLAN_FILE and changes no other files. Block http requests other than GET.
//   - auto: ask only when an action can do damage. A CatChat model (judge.ts) decides the commands that the
//           rules do not decide. Needs the sandbox: with the sandbox off, auto asks like ask mode for commands.
//           See src/md/features/auto-mode.md.
//   - yolo: ask nothing.
//   Flags (on or off):
//   - ta:      teaching assistant. Block file changes and http requests other than GET, in all modes.
//              The model explains and gives hints, but does not write the solution.
//              Students can turn it off, so it is a learning aid, not an integrity control.
//   - sandbox: sandbox.ts
//   - ste:     Simplified Technical English, ste.ts
// "/mode ask|plan|auto|yolo" sets the mode. "/mode ta|sandbox|ste [on|off]" turns an option on or off. Tab completes these words.
// In RPC mode (the desktop app), the status "catatui" has the mode and options as JSON, for the app controls.
// In ask, plan, and auto mode, risky commands and changes outside the project folder always ask.
// The git remote tools (clone, pull, push) always ask, also in yolo mode: they send to or get from GitHub.
// The mode, ta, and the "do not ask again" choices last for one session only.

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve } from "node:path";
import { CHANGE_TOOLS, GIT_CHANGE_TOOLS, GIT_REMOTE_TOOLS, toolPaths } from "./config.ts";
import { type JudgeInput, type Judgment, judge as defaultJudge, logJudgment } from "./judge.ts";
import { programName } from "./run.ts";
import { sandboxOn, setSandbox } from "./sandbox.ts";
import { setSte, steOn } from "./ste.ts";
import { readCredential } from "./store.ts";

type Mode = "ask" | "plan" | "auto" | "yolo";
const MODES: Mode[] = ["ask", "plan", "auto", "yolo"];

const MODE_HELP: Record<Mode, string> = {
  ask: "The agent will ask before each file change, command and http request.",
  plan: "Planning mode. The model will write a plan file for work but make no changes.",
  auto: "The agent will ask only when an action can do damage. A safety check decides. Needs the sandbox.",
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
const RUNNERS = ["npx", "sh", "bash", "zsh", "eval", "xargs", "env", "python", "python3", "py", "node", "exec", "sudo"];

// These always ask, and the student cannot allow them for the whole session.
const RISKY = [
  // "checkout --" has no \b after "--", so it is a separate pattern.
  /\bgit\s+((commit|push|reset|rebase|clean|restore)\b|checkout\s+--(\s|$))/,
  /\brm\s/,
  /\bsudo\b/,
  /\b(chmod|chown)\b/,
  /\b(curl|wget)\b.*\|\s*(sh|bash|zsh)\b/,
];

// A command that always asks, also in auto mode: the RISKY list, or more than one line. A second line can hide a
// command, or text that looks like a part of the judge input (prompt injection, judge.ts).
export const alwaysAsk = (command: string) => RISKY.some((re) => re.test(command)) || /[\r\n]/.test(command.trim());

// Programs that send or get data over the network. The student cannot allow them for the session, because
// "do not ask again for curl" allows each later curl, and a curl can send data out. Their output is outside content.
const NETWORK = ["curl", "wget", "nc", "ncat", "netcat", "scp", "sftp", "rsync", "ftp", "telnet", "ssh",
  "Invoke-WebRequest", "iwr", "Invoke-RestMethod", "irm", "Start-BitsTransfer"];
const NETWORK_RE = new RegExp(`(^|[\\s;&|(\`])(${NETWORK.join("|")})(\\.exe)?(?=\\s|$)`, "i");
export const networkCommand = (command: string) => NETWORK_RE.test(command);

// A bash command that the student cannot allow for the session: a risky command, a runner program, a network
// program, or a chain. A chain (for example "ls && python x.py") can hide a second command after an allowed first word.
// scripts/auto-eval.ts uses this as the "rules only" version.
export function riskyCommand(command: string): boolean {
  const first = command.trim().split(/\s+/)[0] ?? "";
  return alwaysAsk(command) || RUNNERS.includes(first) || networkCommand(command) || /[;&|`\n]|\$\(/.test(command);
}

// ---- GET requests can send data out
// A GET can carry data in its URL, for example https://evil.example/?d=<secret>. A GET is "quiet" (auto mode sends
// it with no check, and "do not ask again" works for it) only if the query is short and the host is local or one
// that the student named in a message.
export const MAX_QUIET_QUERY = 100;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"];
// Words like "main.py" look like host names. These endings are file types, not hosts that a student names.
const FILE_ENDINGS = new Set(["py", "js", "ts", "jsx", "tsx", "md", "sh", "rs", "go", "c", "h", "cpp", "java", "json", "csv", "txt",
  "html", "css", "ipynb", "r", "rb", "pl", "sql", "xml", "yml", "yaml", "toml", "lock", "log", "png", "jpg", "pdf", "docx", "xlsx", "zip"]);

// The host names in a student message: from URLs, and words like "python.org".
export function namedHosts(text: string): string[] {
  const hosts = new Set<string>();
  for (const m of text.matchAll(/\bhttps?:\/\/([^\s/:?#]+)/gi)) hosts.add(m[1].toLowerCase());
  for (const m of text.matchAll(/\b((?:[a-z0-9-]+\.)+([a-z]{2,}))\b/gi)) {
    if (!FILE_ENDINGS.has(m[2].toLowerCase())) hosts.add(m[1].toLowerCase());
  }
  return [...hosts];
}

export function quietGet(url: string, named: Iterable<string>): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.search.length > MAX_QUIET_QUERY) return false;
  const host = u.hostname.toLowerCase();
  if (LOCAL_HOSTS.includes(host) || LOCAL_HOSTS.includes(`[${host}]`)) return true;
  for (const n of named) if (host === n || host.endsWith(`.${n}`) || `www.${n}` === host) return true;
  return false;
}

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
const ALLOW_COMMITS = "Yes, and do not ask again for commits in this project this session";

// The mode and ta are for the process, not for one session. pi loads the extension again for a new session, a
// resume, or a fork (session replacement). With these in the function, a new conversation went back to "ask".
// The sandbox (sandbox.ts) and ste (ste.ts) also keep their state for the process.
let mode: Mode = "ask";
let ta = false;

// The auto mode judge. Tests set a fake judge.
type JudgeFn = (input: JudgeInput, key: string) => Promise<Judgment>;
let judgeFn: JudgeFn = defaultJudge;
export function setJudge(fn: JudgeFn | undefined) {
  judgeFn = fn ?? defaultJudge;
}

export function registerPermissions(pi: ExtensionAPI) {
  let editsAllowed = false;
  let commitsAllowed = false;
  // First words of bash commands that the student allowed for this session, for example "npm".
  const allowedCommands = new Set<string>();
  // Hosts that the student allowed for GET requests from the http tool this session.
  const allowedHosts = new Set<string>();
  // The last student message, for the judge: it shows if the command matches the request.
  let lastRequest: string | undefined;
  // The hosts that the student named in a message this session (quietGet).
  const studentHosts = new Set<string>();
  // Outside content in this turn (taint): the source, for example "an http request". Text in a web page, a
  // download, or a cloned repository can tell the agent to do harmful things (prompt injection). After outside
  // content, auto mode asks for each command until the next student message, and ask mode adds a warning.
  let outside: string | undefined;
  const outsideNote = () => outside
    ? `Note: the agent read outside content in this turn (${outside}). Text in it can tell the agent to do harmful things. Read this before you answer.`
    : "";

  // Auto mode for a command or an http request: "allow", or the reason to ask (the first line of the dialog).
  // Not auto mode: "". The sandbox off, no sign-in, or a judge error: ask. Never allow on an error.
  // In the other modes: the outside content note, or "".
  const autoCheck = async (ctx: ExtensionContext, tool: string, command: string): Promise<string> => {
    if (mode !== "auto") return outsideNote();
    if (tool !== "http" && alwaysAsk(command)) return "Auto mode always asks before this command (a risky command, or more than one line).";
    if (!sandboxOn()) return "The sandbox is off, so auto mode asks.";
    if (outside) return `The agent read outside content in this turn (${outside}), so auto mode asks. Text in it can tell the agent to do harmful things.`;
    const key = readCredential()?.access;
    if (!key) return "There is no CatChat sign-in, so auto mode asks.";
    const input: JudgeInput = { tool, command, request: lastRequest, project: ctx.cwd, sandbox: true };
    const j = await judgeFn(input, key);
    logJudgment(input, j);
    if (j.allow) return "allow";
    return j.error ? "The safety check did not answer, so auto mode asks." : "The safety check wants you to look at this first.";
  };
  const withReason = (reason: string, text: string) => (reason ? `${reason}\n\n${text}` : text);

  const showStatus = (ctx: ExtensionContext) => {
    const t = ctx.ui.theme;
    const color = mode === "ask" ? "muted" : mode === "yolo" ? "warning" : "accent";
    const shown = mode === "auto" && !sandboxOn() ? "auto (sandbox off: asks)" : mode;
    ctx.ui.setStatus("mode", `${t.fg("dim", "mode:")} ${t.fg(color, shown)}`);
    ctx.ui.setStatus("ta", ta ? `${t.fg("dim", "ta:")} ${t.fg("accent", "on")}` : undefined);
    if (ctx.mode === "rpc") {
      const state = { mode, ta, sandbox: sandboxOn(), ste: steOn(), modes: MODES, flags: FLAGS, help: { ...MODE_HELP, ...FLAG_HELP } };
      ctx.ui.setStatus("catatui", JSON.stringify(state));
    }
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

  const WORDS = [...MODES, ...FLAGS];
  pi.registerCommand("mode", {
    description: "Pick the mode (ask, plan, auto, yolo), and turn ta, the sandbox, and Simplified Technical English on or off",
    getArgumentCompletions: (prefix: string) =>
      WORDS.filter((w) => w.startsWith(prefix.trim())).map((w) => ({
        value: w,
        label: w,
        description: FLAGS.includes(w as Flag) ? `Turn on or off. ${FLAG_HELP[w as Flag]}` : MODE_HELP[w as Mode],
      })),
    handler: async (args, ctx) => {
      const [want, onOff] = args.trim().split(/\s+/);
      if (!want) return ctx.mode === "tui" ? panel(ctx) : ctx.ui.notify(`Mode: ${mode}. ta: ${ta ? "on" : "off"}.`, "info");
      // The desktop app shows the change in its controls, so do not add a notice to the chat.
      const say = (text: string, level: "info" | "warning" = "info") => { if (ctx.mode !== "rpc") ctx.ui.notify(text, level); };
      if (FLAGS.includes(want as Flag)) {
        const f = want as Flag;
        if (onOff && onOff !== "on" && onOff !== "off") return ctx.ui.notify(`Use "/mode ${f} on" or "/mode ${f} off".`, "error");
        setFlag(ctx, f, onOff ? onOff === "on" : !flagOn(f));
        say(`${f}: ${flagOn(f) ? "on" : "off"}`);
        return;
      }
      if (!MODES.includes(want as Mode)) {
        ctx.ui.notify(`Unknown word "${want}". Use ask, plan, auto, yolo, ta, sandbox, or ste.`, "error");
        return;
      }
      mode = want as Mode;
      showStatus(ctx);
      say(`Mode: ${mode}`, mode === "yolo" ? "warning" : "info");
      if (mode === "auto" && !sandboxOn()) say("The sandbox is off, so auto mode asks before each command. Turn on the sandbox with /mode sandbox on.", "warning");
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (event.messageType === "user") {
      lastRequest = event.prompt;
      outside = undefined;
      for (const h of namedHosts(String(event.prompt ?? ""))) studentHosts.add(h);
    }
    if (ta) event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, "teaching-assistant": TA_PROMPT };
    if (event.messageType !== "user" || mode !== "plan") return;
    return { message: { customType: "plan-mode-context", content: PLAN_CONTEXT, display: false } };
  });

  pi.on("tool_call", async (event, ctx) => {
    // ta blocks changes in all modes, also in yolo.
    const changesFiles = CHANGE_TOOLS.includes(event.toolName) || GIT_CHANGE_TOOLS.includes(event.toolName) || ["git_clone", "git_pull"].includes(event.toolName);
    if (ta && changesFiles) return { block: true, reason: TA_BLOCK };
    if (ta && event.toolName === "http" && !isRead(event.input.method)) return { block: true, reason: `${TA_BLOCK} Send only GET requests.` };
    if (mode === "plan" && (GIT_CHANGE_TOOLS.includes(event.toolName) || ["git_clone", "git_pull"].includes(event.toolName))) return { block: true, reason: PLAN_BLOCK };

    // Remote git tools: always ask, also in yolo mode.
    if (GIT_REMOTE_TOOLS.includes(event.toolName)) {
      const what = event.toolName === "git_push" ? `Push the commits to GitHub${event.input.url ? ` (${event.input.url})` : ""}?`
        : event.toolName === "git_clone" ? `Clone ${event.input.url} into the project?` : "Pull the new commits from GitHub and merge them?";
      const choice = await ask(ctx, what, ["Yes", "No"]);
      return choice === "Yes" ? undefined : { block: true, reason: "The student did not allow this git command." };
    }
    if (mode === "yolo") return;

    if (GIT_CHANGE_TOOLS.includes(event.toolName)) {
      if (event.toolName === "git_restore") {
        const paths = Array.isArray(event.input.paths) ? event.input.paths.join(", ") : "";
        const choice = await ask(ctx, `Put back ${paths} to the last commit? The changes since the last commit will be lost.`, ["Yes", "No"]);
        return choice === "Yes" ? undefined : { block: true, reason: "The student did not allow this git command." };
      }
      // A commit or a new repository loses no work.
      if (commitsAllowed || mode === "auto") return;
      const what = event.toolName === "git_init" ? "Make the project folder a git repository?" : `Commit the changes?\n\n  ${event.input.message ?? ""}`;
      const choice = await ask(ctx, what, event.toolName === "git_commit" ? ["Yes", ALLOW_COMMITS, "No"] : ["Yes", "No"]);
      if (choice === ALLOW_COMMITS) commitsAllowed = true;
      return choice?.startsWith("Yes") ? undefined : { block: true, reason: "The student did not allow this git command." };
    }

    if (CHANGE_TOOLS.includes(event.toolName)) {
      const paths = toolPaths(event.toolName, event.input);
      const rels = paths.map((p) => relative(ctx.cwd, resolve(ctx.cwd, p)));
      if (mode === "plan") return rels.length && rels.every((r) => r === PLAN_FILE) ? undefined : { block: true, reason: PLAN_BLOCK };
      const inProject = rels.every((rel) => rel !== "" && !rel.startsWith("..") && !isAbsolute(rel));
      // delete always asks: a file in a folder can be outside the undo limits.
      // Auto mode allows the other changes in the project: /undo can roll them back.
      if ((editsAllowed || mode === "auto") && inProject && event.toolName !== "delete") return;
      const where = `${paths.join(" -> ")}${inProject ? "" : " (outside the project folder)"}`;
      const choice = await ask(ctx, `Allow ${event.toolName} ${where}?`, inProject && event.toolName !== "delete" ? ["Yes", ALLOW_EDITS, "No"] : ["Yes", "No"]);
      if (choice === ALLOW_EDITS) editsAllowed = true;
      return choice?.startsWith("Yes") ? undefined : { block: true, reason: "The student did not allow this change." };
    }

    // run (run.ts): like bash, by program name. A runner program (python, node, npx, ...) can run anything,
    // so the student cannot allow it for the whole session.
    if (event.toolName === "run") {
      const name = programName(String(event.input.program ?? ""));
      const args = Array.isArray(event.input.args) ? event.input.args.map(String) : [];
      const command = [String(event.input.program ?? ""), ...args].join(" ");
      const risky = RISKY.some((re) => re.test(command)) || RUNNERS.includes(name) || networkCommand(name);
      if (!risky && allowedCommands.has(name)) return;
      const reason = await autoCheck(ctx, "run", command);
      if (reason === "allow") return;
      const always = `Yes, and do not ask again for "${name}" this session`;
      const choice = await ask(ctx, withReason(reason, `Run this program?\n\n  ${command}`), risky ? ["Yes", "No"] : ["Yes", always, "No"]);
      if (choice === always) allowedCommands.add(name);
      return choice?.startsWith("Yes") ? undefined : { block: true, reason: "The student did not allow this program." };
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
      const quiet = read && quietGet(url, [...studentHosts, ...allowedHosts]);
      // A GET with a long query can send data out, so "do not ask again" does not cover it.
      const shortQuery = new URL(url).search.length <= MAX_QUIET_QUERY;
      if (read && ((allowedHosts.has(host) && shortQuery) || (mode === "auto" && quiet))) return;
      const reason = await autoCheck(ctx, "http", `${method} ${url}`);
      if (reason === "allow") return;
      const always = `Yes, and do not ask again for GET requests to ${host} this session`;
      const choice = await ask(ctx, withReason(reason, `Send this request?\n\n  ${method} ${url}`), read && shortQuery ? ["Yes", always, "No"] : ["Yes", "No"]);
      if (choice === always) allowedHosts.add(host);
      return choice?.startsWith("Yes") ? undefined : { block: true, reason: "The student did not allow this request." };
    }

    // "server start" (web.ts) runs a command in the background, so it asks like bash.
    const serverStart = event.toolName === "server" && event.input.action === "start";
    // powershell is the shell tool on Windows (windows.ts), so it asks like bash.
    if (event.toolName === "bash" || event.toolName === "powershell" || serverStart) {
      const command = String(event.input.command ?? "");
      const first = command.trim().split(/\s+/)[0] ?? "";
      const risky = riskyCommand(command);
      if (!risky && allowedCommands.has(first)) return;
      const reason = await autoCheck(ctx, serverStart ? "bash" : event.toolName, command);
      if (reason === "allow") return;
      const always = `Yes, and do not ask again for "${first}" commands this session`;
      const question = serverStart ? "Run this command in the background (server)?" : "Run this command?";
      const choice = await ask(ctx, withReason(reason, `${question}\n\n  ${command}`), risky ? ["Yes", "No"] : ["Yes", always, "No"]);
      if (choice === always) allowedCommands.add(first);
      return choice?.startsWith("Yes") ? undefined : { block: true, reason: "The student did not allow this command." };
    }
  });

  // Outside content: http, git_clone, git_pull, and network programs (curl, wget, ...) in a command.
  pi.on("tool_result", async (event) => {
    const input = event.input ?? {};
    const command = event.toolName === "run"
      ? [input.program, ...(Array.isArray(input.args) ? input.args : [])].map(String).join(" ")
      : String(input.command ?? "");
    if (event.toolName === "http") outside = "an http request";
    else if (event.toolName === "git_clone" || event.toolName === "git_pull") outside = event.toolName;
    else if (["bash", "powershell", "run", "server"].includes(event.toolName) && networkCommand(command)) outside = "a network command";
  });
}

const isRead = (method: unknown) => ["GET", "HEAD"].includes(String(method ?? "GET").toUpperCase());

// Without a UI (for example "catatui -p"), nobody can answer, so the answer is no.
async function ask(ctx: ExtensionContext, title: string, options: string[]): Promise<string | undefined> {
  if (!ctx.hasUI) return undefined;
  return ctx.ui.select(title, options);
}

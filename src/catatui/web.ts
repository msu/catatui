// Two web tools:
// - "show_page": the model shows an HTML page (a quiz, a form, a chart) in the student's browser, and gets the answers back.
// - "server": start, stop, and read the logs of the student's own dev server (npm run dev, flask) in the background.
//   The model can then test the server with the http tool. permissions.ts and sandbox.ts treat "server start" like bash.
// See src/md/features/web.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Type } from "typebox";

// ---- show_page ----

const PAGE_TIMEOUT_MIN = 10;
const MAX_BODY = 1_000_000;

const PAGE_PARAMS = Type.Object({
  html: Type.String({
    description:
      "A full HTML page. To send answers back, use a <form> (all fields are sent on submit), " +
      "or call catatui.submit(data) in a script with any JSON value. The page can load scripts from a CDN.",
  }),
  title: Type.Optional(Type.String({ description: "Short title for the browser tab and the terminal" })),
  timeout_minutes: Type.Optional(Type.Number({ description: `Minutes to wait for the student. Default: ${PAGE_TIMEOUT_MIN}` })),
});

// Added to the page: catatui.submit(), and form submits that go to catatui.
const PAGE_SCRIPT = (submitPath: string) => `<script>
window.catatui = {
  async submit(data) {
    const res = await fetch(${JSON.stringify(submitPath)}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data ?? null) });
    if (!res.ok) throw new Error("catatui did not accept the answer");
    document.body.innerHTML = '<div style="font-family:system-ui,sans-serif;max-width:30rem;margin:4rem auto;text-align:center"><h2>Sent to catatui</h2><p>Close this tab and go back to your terminal.</p></div>';
  },
};
document.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {};
  for (const [k, v] of new FormData(e.target)) data[k] = k in data ? [].concat(data[k], v) : v;
  window.catatui.submit(data);
});
</script>`;

export function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // No browser. The tool result and the notice show the URL.
  }
}

// Serve the page on 127.0.0.1 at a random path, so other web sites cannot send answers to it.
// Wait for one answer, the timeout, or Escape.
function showPage(html: string, title: string, timeoutMs: number, signal: AbortSignal | undefined, onUrl: (url: string) => void): Promise<string> {
  const token = randomBytes(16).toString("hex");
  const pagePath = `/${token}/`;
  const submitPath = `/${token}/submit`;
  const script = PAGE_SCRIPT(submitPath);
  const page = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`) : `${html}${script}`;

  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const done = (fn: () => void) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); server.close(); fn(); };
    const onAbort = () => done(() => reject(new Error("The student stopped the page.")));
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === pagePath) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(page);
      }
      if (req.method === "POST" && req.url === submitPath) {
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > MAX_BODY) req.destroy(); });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
          done(() => resolve(body));
        });
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found.");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const url = `http://127.0.0.1:${port}${pagePath}`;
      onUrl(url);
      openBrowser(url);
      timer = setTimeout(() => done(() => reject(new Error(`The student did not answer in ${Math.round(timeoutMs / 60_000)} minutes. The page "${title}" is closed.`))), timeoutMs);
      signal?.addEventListener("abort", onAbort);
    });
  });
}

// ---- server ----

const MAX_LOG_LINES = 300;

const SERVER_PARAMS = Type.Object({
  action: Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("logs"), Type.Literal("list")], {
    description: "start: run command in the background. stop: stop a server. logs: show the last output. list: show the servers.",
  }),
  command: Type.Optional(Type.String({ description: "For start: the shell command, for example npm run dev or python app.py" })),
  id: Type.Optional(Type.Number({ description: "For stop and logs: the server id from start or list" })),
  lines: Type.Optional(Type.Number({ description: "For logs: the number of lines. Default: 50" })),
});

type Proc = { id: number; command: string; child: ChildProcess; log: string[]; exit?: string };

const procs = new Map<number, Proc>();
let nextId = 1;

function addLog(p: Proc, chunk: Buffer) {
  p.log.push(...chunk.toString().split(/\r?\n/).filter((l) => l !== ""));
  if (p.log.length > MAX_LOG_LINES) p.log.splice(0, p.log.length - MAX_LOG_LINES);
}

// Stop the command and its child processes (npm starts node, for example).
function kill(p: Proc) {
  if (p.exit || p.child.pid === undefined) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-p.child.pid, "SIGTERM");
  } catch {
    // The process stopped already.
  }
}

const state = (p: Proc) => (p.exit ? `stopped (${p.exit})` : "running");
const urls = (p: Proc) => [...new Set(p.log.join("\n").match(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(:\d+)?[^\s'"]*/g) ?? [])];

function summary(p: Proc, lines: number): string {
  const found = urls(p);
  return [
    `Server ${p.id}: ${p.command}`,
    `State: ${state(p)}`,
    found.length ? `URLs in the output: ${found.join(", ")}` : "",
    `Last output:`,
    ...p.log.slice(-lines),
  ].filter(Boolean).join("\n");
}

export function registerWebTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "show_page",
    label: "Show page",
    description:
      "Show an HTML page in the student's browser and wait for the answer. Use it for quizzes, forms, choices, " +
      "charts, and step-by-step exercises. The tool returns the submitted JSON. Keep pages self-contained.",
    promptSnippet: "Show an interactive HTML page (quiz, form, chart) in the student's browser and get the answers",
    promptGuidelines: [
      "Use show_page when the student asks for a quiz, a form, or a chart in the browser. Do not use it for normal answers.",
      "After show_page returns, give feedback on the answers in the terminal.",
    ],
    parameters: PAGE_PARAMS,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const title = params.title ?? "catatui page";
      const timeoutMs = Math.max(1, params.timeout_minutes ?? PAGE_TIMEOUT_MIN) * 60_000;
      const body = await showPage(params.html, title, timeoutMs, signal, (url) => {
        if (ctx.hasUI) ctx.ui.notify(`${title}: ${url}\nAnswer in the browser. Press Escape to stop.`, "info");
      });
      return { content: [{ type: "text", text: `The student submitted:\n${body}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "server",
    label: "Server",
    description:
      "Run a long-running command (a dev server) in the background, in the project folder. " +
      "Use start, then logs to find the URL, then test it with the http tool. Use stop when done. " +
      "Do not use bash for servers, because bash waits for the command to end.",
    promptSnippet: "Start, stop, and read logs of a background dev server",
    promptGuidelines: ["For a command that does not end (a dev server or a watcher), use server start, not bash. Stop the servers that you started when you are done."],
    parameters: SERVER_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });
      if (params.action === "list") {
        return text(procs.size ? [...procs.values()].map((p) => `${p.id}: ${state(p)}  ${p.command}`).join("\n") : "No servers.");
      }
      if (params.action === "start") {
        if (!params.command) throw new Error("start needs a command, for example npm run dev.");
        const child = spawn(params.command, { cwd: ctx.cwd, shell: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
        const p: Proc = { id: nextId++, command: params.command, child, log: [] };
        procs.set(p.id, p);
        child.stdout?.on("data", (c: Buffer) => addLog(p, c));
        child.stderr?.on("data", (c: Buffer) => addLog(p, c));
        child.on("exit", (code, sig) => { p.exit = sig ? `signal ${sig}` : `exit code ${code}`; });
        child.on("error", (e) => { p.exit = `error: ${e.message}`; });
        // Wait a little, so the first output (often the URL) is in the result.
        await new Promise((r) => setTimeout(r, 3000));
        return text(summary(p, 30));
      }
      const p = params.id === undefined ? undefined : procs.get(params.id);
      if (!p) throw new Error(`There is no server ${params.id ?? ""}. Use action list.`);
      if (params.action === "logs") return text(summary(p, Math.max(1, params.lines ?? 50)));
      kill(p);
      await new Promise((r) => setTimeout(r, 500));
      procs.delete(p.id);
      return text(`Server ${p.id} stopped: ${p.command}`);
    },
  });

  // Stop all servers when catatui stops, so no server keeps a port.
  pi.on("session_shutdown", async () => { for (const p of procs.values()) kill(p); });
  process.on("exit", () => { for (const p of procs.values()) kill(p); });
}

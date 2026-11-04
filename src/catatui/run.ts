// "run" tool: start a program with a list of arguments, with no shell. For example python main.py, npm test, javac Main.java.
// - It works the same on Windows, macOS, and Linux. On Windows, cross-spawn starts .cmd files (npm, npx) correctly.
// - The sandbox checks the program and each argument. permissions.ts asks by program name. There is no shell,
//   so a second command cannot hide in a chain ("a && b").
// - Blocked: ssh, scp, sftp (the student's keys), git (use the git tools), and shells (use bash or powershell).
// See src/md/features/run.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn as nodeSpawn } from "node:child_process";
import spawn from "cross-spawn";
import { Type } from "typebox";

const MAX_CHARS = 30_000;
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 600;

// Program names without the folder and the Windows extension: "C:\x\npm.cmd" -> "npm".
export const programName = (program: string) => (program.split(/[\\/]/).pop() ?? "").replace(/\.(exe|cmd|bat|com|ps1)$/i, "").toLowerCase();

const BLOCKED: Record<string, string> = {
  ssh: "catai does not use the student's SSH keys.",
  scp: "catai does not use the student's SSH keys.",
  sftp: "catai does not use the student's SSH keys.",
  git: "Use the git_ tools (git_status, git_commit, git_push, and the others).",
  sh: "Use the shell tool (bash or powershell) for shell commands.",
  bash: "Use the shell tool (bash or powershell) for shell commands.",
  zsh: "Use the shell tool (bash or powershell) for shell commands.",
  cmd: "Use the shell tool (bash or powershell) for shell commands.",
  powershell: "Use the shell tool (bash or powershell) for shell commands.",
  pwsh: "Use the shell tool (bash or powershell) for shell commands.",
};
export const blockedReason = (program: string) => BLOCKED[programName(program)];

// The end of the output is the most useful part (errors, test results), so keep the end.
const tail = (s: string) => (s.length > MAX_CHARS ? `[... ${s.length - MAX_CHARS} characters before this]\n${s.slice(-MAX_CHARS)}` : s);

function stop(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") nodeSpawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
  else try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
}

export function registerRun(pi: ExtensionAPI) {
  pi.registerTool({
    name: "run",
    label: "Run",
    description:
      "Run a program in the project folder and get its output, for example python with args [\"main.py\"], or npm with args [\"test\"]. " +
      "No shell: give the program and each argument separately. No pipes, no &&, no wildcards. The program must end by itself.",
    promptSnippet: "Run a program (python, node, npm, javac, java, pip, and others) with arguments, with no shell",
    promptGuidelines: [
      "To run a program, a test, a compiler, or a package manager, use run, not the shell tool. Give each argument separately.",
      "For a program that does not end (a dev server or a watcher), use server start, not run.",
    ],
    parameters: Type.Object({
      program: Type.String({ description: "The program, for example python, node, npm, java" }),
      args: Type.Optional(Type.Array(Type.String(), { description: "The arguments, one item each, for example [\"-m\", \"pytest\"]" })),
      input: Type.Optional(Type.String({ description: "Text for the program's standard input" })),
      timeout: Type.Optional(Type.Number({ description: `Seconds before the program is stopped. Default: ${DEFAULT_TIMEOUT_S}. Max: ${MAX_TIMEOUT_S}` })),
    }),
    async execute(_id, p, signal, _onUpdate, ctx) {
      const reason = blockedReason(p.program);
      if (reason) return { content: [{ type: "text", text: `Blocked: ${p.program}. ${reason}` }], details: {} };
      const seconds = Math.max(1, Math.min(MAX_TIMEOUT_S, p.timeout ?? DEFAULT_TIMEOUT_S));
      return new Promise((done) => {
        let out = "";
        let ended = false;
        let timedOut = false;
        const child = spawn(p.program, p.args ?? [], { cwd: ctx.cwd, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
        const add = (d: Buffer) => { out += d.toString("utf8"); if (out.length > 4 * MAX_CHARS) out = out.slice(-2 * MAX_CHARS); };
        child.stdout?.on("data", add);
        child.stderr?.on("data", add);
        child.stdin?.on("error", () => {});
        child.stdin?.end(p.input ?? "");
        const timer = setTimeout(() => { timedOut = true; stop(child); }, seconds * 1000);
        const onAbort = () => stop(child);
        signal?.addEventListener("abort", onAbort, { once: true });
        const finish = (text: string) => {
          if (ended) return;
          ended = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          done({ content: [{ type: "text", text }], details: {} });
        };
        child.on("error", (e: NodeJS.ErrnoException) => finish(e.code === "ENOENT"
          ? `The program ${p.program} is not installed, or it is not on the PATH. Tell the student what to install.`
          : `The program did not start: ${e.message}`));
        child.on("close", (code, sig) => {
          const head = timedOut ? `Stopped after ${seconds} seconds. For a program that does not end, use server start.`
            : signal?.aborted ? "Stopped." : sig ? `Ended by signal ${sig}.` : `Exit code ${code}.`;
          finish(`${head}\n${tail(out.trim()) || "(no output)"}`);
        });
      });
    },
  });
}

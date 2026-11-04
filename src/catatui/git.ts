// Run git safely. catatui and the desktop app use the git that comes with the dugite npm package, so the student
// does not need to install git. The git tools (gittools.ts) and the desktop app (file tree, diff) use this file.
// This file does not import pi, so the desktop app can load it without loading pi.
//
// Safety: a project can come from anywhere (for example a zip file with a .git folder in it). git can start
// other programs from hooks and from some settings. So each git command:
// - turns off hooks, fsmonitor, the pager, signing, external diff programs, and SSH;
// - uses only the catai GitHub token (github.ts) for credentials, never the student's other credentials;
// - changes git@github.com: URLs to https://github.com/, so a repository cloned with SSH works with the token.
// A repository with local settings that can start a program (repoRisk) is refused.

import { execFile, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dugite from "dugite";

const MAX_BUFFER = 20_000_000;
const TIMEOUT_MS = 10_000;

// A folder with no hooks. git does not need it to exist.
const NO_HOOKS = join(tmpdir(), "catatui-no-hooks");

// The credential helper: git runs it with sh. It answers only "get", with the token from the environment.
const HELPER = `!f() { test "$1" = get || exit 0; echo "username=$CATAI_GITHUB_USER"; echo "password=$CATAI_GITHUB_TOKEN"; }; f`;

// Settings for each command. "-c key=value" wins over the repository and the student's settings.
export function safeConfig(token?: string): string[] {
  const config = [
    `core.hooksPath=${NO_HOOKS}`,
    "core.fsmonitor=false",
    "core.pager=cat",
    "core.askPass=",
    "diff.external=",
    "commit.gpgSign=false",
    "tag.gpgSign=false",
    "protocol.ssh.allow=never",
    "protocol.ext.allow=never",
    "url.https://github.com/.insteadOf=git@github.com:",
    "url.https://github.com/.insteadOf=ssh://git@github.com/",
    // An empty value removes the helpers from the other settings (for example the student's keychain).
    "credential.helper=",
  ];
  if (token) config.push(`credential.https://github.com.helper=${HELPER}`);
  return config.flatMap((c) => ["-c", c]);
}

// Local settings (.git/config) that can start a program or read other files. git reads the repository's own
// settings, so a downloaded project can have them. hooksPath and fsmonitor are also turned off above.
const RISKY_KEY = /^(core\.(fsmonitor|sshcommand|editor|pager|askpass|hookspath|gitproxy|alternaterefscommand)|include\.|includeif\.|filter\..+\.(clean|smudge|process)|diff\..+\.(textconv|command)|merge\..+\.driver|credential\.|gpg\.|sequence\.editor|uploadpack\.|receive\.|remote\..+\.(uploadpack|receivepack|vcs|proxy)|http\.|ssh\.|protocol\.)/i;

function env(token?: string, user?: string): NodeJS.ProcessEnv {
  return dugite.setupEnvironment({
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_MERGE_AUTOEDIT: "no",
    CATAI_GITHUB_TOKEN: token ?? "",
    CATAI_GITHUB_USER: user || "catai",
  }).env as NodeJS.ProcessEnv;
}

export const gitBinary = () => dugite.resolveGitBinary();

// The risky local settings of the repository in cwd. Empty: no risk, or no repository.
// "git config --local" reads only .git/config, without include files, and starts no other program.
export function repoRisk(cwd: string): string[] {
  try {
    const out = execFileSync(gitBinary(), ["config", "--local", "--list", "--name-only"], { cwd, env: env(), encoding: "utf8", timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });
    return [...new Set(out.split("\n").map((k) => k.trim()).filter((k) => RISKY_KEY.test(k)))];
  } catch {
    return [];
  }
}

export class GitRefused extends Error {}

export const riskMessage = (keys: string[]) =>
  `catai does not run git in this repository, because its settings (.git/config) can start other programs: ${keys.join(", ")}. ` +
  "Remove these settings, or use git outside catai.";

// For the desktop app: the output, or undefined if git failed or the repository is risky. Like execFileSync.
export function gitSync(cwd: string, args: string[], opts: { buffer?: boolean } = {}): string | Buffer | undefined {
  if (repoRisk(cwd).length) return undefined;
  try {
    return execFileSync(gitBinary(), [...safeConfig(), ...args], {
      cwd, env: env(), maxBuffer: MAX_BUFFER, timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"],
      ...(opts.buffer ? {} : { encoding: "utf8" as const }),
    });
  } catch {
    return undefined;
  }
}

export type GitResult = { code: number; stdout: string; stderr: string };

// For the git tools. Throws GitRefused for a risky repository. A failed command gives its code and output.
// input: text for git's stdin. stdin is always closed, so git never waits for input.
export function git(cwd: string, args: string[], opts: { token?: string; user?: string; signal?: AbortSignal; timeout?: number; input?: string } = {}): Promise<GitResult> {
  const risk = repoRisk(cwd);
  if (risk.length) return Promise.reject(new GitRefused(riskMessage(risk)));
  return new Promise((done) => {
    const child = execFile(gitBinary(), [...safeConfig(opts.token), ...args], {
      cwd, env: env(opts.token, opts.user), maxBuffer: MAX_BUFFER, timeout: opts.timeout ?? 120_000, signal: opts.signal, encoding: "utf8",
    }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      done({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") || (err && !stderr ? err.message : "") });
    });
    child.stdin?.end(opts.input ?? "");
  });
}

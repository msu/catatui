// git tools for the model, and the "/github" command. They use git.ts (the git from the dugite package), so they
// work on a computer with no git installed, and the same on Windows, macOS, and Linux.
// - Read: git_status, git_diff, git_log. No question.
// - Change: git_init, git_commit, git_restore. permissions.ts asks (like a file change). ta and plan mode block them.
// - Remote: git_clone, git_pull, git_push. permissions.ts always asks, also in yolo mode. They use the catai
//   GitHub token (github.ts). "/github login" (or the account menu in the desktop app) saves it.
// The repository must start in the project folder (sandbox), so a tool cannot commit files outside it.
// See src/md/features/git.md.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { isAbsolute, relative } from "node:path";
import { Type } from "typebox";
import { git, GitRefused, type GitResult } from "./git.ts";
import { clearGitHub, gitHubExpiryDays, readGitHub, signInGitHub, TOKEN_URL } from "./github.ts";
import { sandboxOn } from "./sandbox.ts";

const MAX_CHARS = 30_000;
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

function clip(s: string): string {
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n[... ${s.length - MAX_CHARS} more characters. Give a path to see less.]` : s;
}

// The text for the model: the output, or the error and what to do.
function show(r: GitResult, empty = "(no output)"): string {
  const out = `${r.stdout}${r.stderr ? `${r.stdout ? "\n" : ""}${r.stderr}` : ""}`.trim();
  if (r.code === 0) return clip(out || empty);
  if (/terminal prompts disabled|Authentication failed|could not read Username|403/i.test(out)) {
    return `${clip(out)}\n\nGitHub refused the sign-in. The student must sign in to GitHub in catai: the account menu (desktop app), or /github login.`;
  }
  if (/protocol 'ssh' is not allowed|transport 'ssh' not allowed/i.test(out)) {
    return `${clip(out)}\n\ncatai uses only HTTPS. It changes GitHub SSH addresses to HTTPS, but not other SSH servers. The student can use their own git for this repository.`;
  }
  return `git failed (exit code ${r.code}):\n${clip(out)}`;
}

const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
const within = (root: string, p: string) => { const r = relative(real(root), real(p)); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };

// The repository must start in the project folder, so "commit everything" stays in the project (sandbox on).
async function checkRepo(ctx: ExtensionContext, signal?: AbortSignal): Promise<string | undefined> {
  const r = await git(ctx.cwd, ["rev-parse", "--show-toplevel"], { signal });
  if (r.code !== 0) return "The project folder is not a git repository. Use git_init to make one, or git_clone to get one.";
  const top = r.stdout.trim();
  if (sandboxOn() && !within(ctx.cwd, top)) return `The git repository starts outside the project folder (${top}). catai uses git only for a repository in the project folder.`;
  return undefined;
}

// Run a git tool: the risky repository message, or the result text.
async function run(fn: () => Promise<string>): Promise<ReturnType<typeof text>> {
  try {
    return text(await fn());
  } catch (e) {
    if (e instanceof GitRefused) return text(e.message);
    throw e;
  }
}

// The name and email for a commit, if git has none: the GitHub user (with GitHub's private email), or the
// computer user name. A student with no git setup can then commit.
async function identity(cwd: string): Promise<string[]> {
  const name = (await git(cwd, ["config", "user.name"])).stdout.trim();
  const email = (await git(cwd, ["config", "user.email"])).stdout.trim();
  if (name && email) return [];
  const gh = readGitHub();
  const user = gh?.login ?? (() => { try { return userInfo().username; } catch { return "student"; } })();
  return ["-c", `user.name=${name || user}`, "-c", `user.email=${email || (gh ? `${gh.login}@users.noreply.github.com` : `${user}@localhost`)}`];
}

const auth = () => { const gh = readGitHub(); return { token: gh?.token, user: gh?.login }; };
const PATHS = Type.Optional(Type.Array(Type.String(), { description: "Paths in the project. Default: the whole project" }));

export function registerGitTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "git_status",
    label: "git status",
    description: "Show the git status of the project: the branch, and the changed, new, and deleted files.",
    promptSnippet: "Show the git status (branch and changed files)",
    promptGuidelines: ["Use the git_ tools for git, not git commands in the shell. They work on computers with no git installed."],
    parameters: Type.Object({}),
    async execute(_id, _p, signal, _u, ctx) {
      return run(async () => (await checkRepo(ctx, signal)) ?? show(await git(ctx.cwd, ["status", "--short", "--branch", "--", "."], { signal }), "No changes."));
    },
  });

  pi.registerTool({
    name: "git_diff",
    label: "git diff",
    description: "Show the changes in the project files since the last commit (or the staged changes).",
    promptSnippet: "Show the file changes since the last commit",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "A file or folder. Default: the whole project" })),
      staged: Type.Optional(Type.Boolean({ description: "Show the staged changes. Default: false" })),
    }),
    async execute(_id, p, signal, _u, ctx) {
      return run(async () => (await checkRepo(ctx, signal)) ??
        show(await git(ctx.cwd, ["diff", "--no-ext-diff", "--no-color", ...(p.staged ? ["--staged"] : []), "--", p.path ?? "."], { signal }), "No changes."));
    },
  });

  pi.registerTool({
    name: "git_log",
    label: "git log",
    description: "Show the recent commits: the short id, the date, the author, and the message.",
    promptSnippet: "Show the recent commits",
    parameters: Type.Object({
      max: Type.Optional(Type.Number({ description: "How many commits. Default: 20" })),
      path: Type.Optional(Type.String({ description: "Only commits that changed this file or folder" })),
    }),
    async execute(_id, p, signal, _u, ctx) {
      const n = String(Math.max(1, Math.min(200, Math.floor(p.max ?? 20))));
      return run(async () => (await checkRepo(ctx, signal)) ??
        show(await git(ctx.cwd, ["log", "-n", n, "--date=short", "--format=%h %ad %an: %s", "--", p.path ?? "."], { signal }), "No commits yet."));
    },
  });

  pi.registerTool({
    name: "git_init",
    label: "git init",
    description: "Make the project folder a git repository (branch main).",
    promptSnippet: "Make the project folder a git repository",
    parameters: Type.Object({}),
    async execute(_id, _p, signal, _u, ctx) {
      return run(async () => {
        const top = await git(ctx.cwd, ["rev-parse", "--show-toplevel"], { signal });
        // A repository that starts outside the project (for example the home folder) does not count: make a new one here.
        if (top.code === 0 && within(ctx.cwd, top.stdout.trim())) return `The project is already a git repository (${top.stdout.trim()}).`;
        return show(await git(ctx.cwd, ["init", "-b", "main"], { signal }));
      });
    },
  });

  pi.registerTool({
    name: "git_commit",
    label: "git commit",
    description: "Save the changes in a commit: add the files (new, changed, and deleted), then commit with a message.",
    promptSnippet: "Commit the changes with a message",
    parameters: Type.Object({
      message: Type.String({ description: "The commit message: a short summary of the changes" }),
      paths: PATHS,
    }),
    async execute(_id, p, signal, _u, ctx) {
      return run(async () => {
        const bad = await checkRepo(ctx, signal);
        if (bad) return bad;
        const paths = p.paths?.length ? p.paths : ["."];
        const add = await git(ctx.cwd, ["add", "--all", "--", ...paths], { signal });
        if (add.code !== 0) return show(add);
        return show(await git(ctx.cwd, [...(await identity(ctx.cwd)), "commit", "-m", p.message, "--", ...paths], { signal }));
      });
    },
  });

  pi.registerTool({
    name: "git_restore",
    label: "git restore",
    description: "Put files back to the last commit. The changes since the last commit are lost.",
    promptSnippet: "Put files back to the last commit (the changes are lost)",
    parameters: Type.Object({ paths: Type.Array(Type.String(), { description: "The files or folders to put back" }) }),
    async execute(_id, p, signal, _u, ctx) {
      return run(async () => (await checkRepo(ctx, signal)) ??
        show(await git(ctx.cwd, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...p.paths], { signal }), "Done."));
    },
  });

  pi.registerTool({
    name: "git_clone",
    label: "git clone",
    description: "Copy a repository from GitHub (or another HTTPS address) into a new folder in the project.",
    promptSnippet: "Clone a repository into the project",
    parameters: Type.Object({
      url: Type.String({ description: "For example https://github.com/user/repo or git@github.com:user/repo.git" }),
      folder: Type.Optional(Type.String({ description: "The new folder in the project. Default: the repository name" })),
    }),
    async execute(_id, p, signal, _u, ctx) {
      return run(async () => {
        const folder = p.folder ?? p.url.replace(/\.git$/, "").split(/[/:]/).pop() ?? "repo";
        return show(await git(ctx.cwd, ["clone", "--", p.url, folder], { ...auth(), signal, timeout: 600_000 }), `Cloned into ${folder}.`);
      });
    },
  });

  pi.registerTool({
    name: "git_pull",
    label: "git pull",
    description: "Get the new commits from the remote repository (GitHub) and merge them.",
    promptSnippet: "Pull the new commits from GitHub",
    parameters: Type.Object({}),
    async execute(_id, _p, signal, _u, ctx) {
      return run(async () => (await checkRepo(ctx, signal)) ??
        show(await git(ctx.cwd, [...(await identity(ctx.cwd)), "pull", "--no-rebase", "--no-edit"], { ...auth(), signal, timeout: 600_000 })));
    },
  });

  pi.registerTool({
    name: "git_push",
    label: "git push",
    description: "Send the commits to the remote repository (GitHub). If the repository has no remote yet, give the url of an empty GitHub repository.",
    promptSnippet: "Push the commits to GitHub",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Only if the repository has no remote: the GitHub repository, for example https://github.com/user/repo" })),
    }),
    async execute(_id, p, signal, _u, ctx) {
      return run(async () => {
        const bad = await checkRepo(ctx, signal);
        if (bad) return bad;
        const remotes = (await git(ctx.cwd, ["remote"], { signal })).stdout.split("\n").filter(Boolean);
        if (!remotes.length) {
          if (!p.url) return "The repository has no remote. Ask the student for the address of an empty GitHub repository, then use git_push with url.";
          const add = await git(ctx.cwd, ["remote", "add", "origin", p.url], { signal });
          if (add.code !== 0) return show(add);
        }
        const upstream = await git(ctx.cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { signal });
        const args = upstream.code === 0 ? ["push"] : ["push", "--set-upstream", remotes[0] ?? "origin", "HEAD"];
        return show(await git(ctx.cwd, args, { ...auth(), signal, timeout: 600_000 }), "Pushed.");
      });
    },
  });

  pi.registerCommand("github", {
    description: "Show the GitHub sign-in for the git tools. \"/github login\" saves a token. \"/github logout\" removes it.",
    getArgumentCompletions: (prefix) => ["login", "logout"].filter((a) => a.startsWith(prefix)).map((a) => ({ value: a, label: a })),
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (arg === "logout") {
        clearGitHub();
        return ctx.ui.notify("GitHub sign-in removed. Also revoke the token on GitHub: Settings > Developer settings > Personal access tokens.", "info");
      }
      if (arg === "login") {
        const token = await ctx.ui.input(`Make a token on GitHub (pick an expiry, then Generate token), then paste it here:\n${TOKEN_URL}`, "ghp_...");
        if (!token) return;
        const r = await signInGitHub(token);
        return "error" in r ? ctx.ui.notify(r.error, "error") : ctx.ui.notify(`GitHub: signed in as ${r.login}.`, "info");
      }
      const gh = readGitHub();
      const days = gitHubExpiryDays(gh);
      ctx.ui.notify(gh
        ? `GitHub: signed in as ${gh.login}.${days === undefined ? "" : days <= 0 ? " The token expired. Run /github login." : ` The token expires in ${days} day(s).`}`
        : "GitHub: not signed in. Run /github login to push and pull.", "info");
    },
  });
}


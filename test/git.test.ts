// git.ts (the dugite git with the safety settings), gittools.ts, and github.ts. No network: GitHub is a local server.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { git, GitRefused, gitSync, repoRisk } from "../src/catatui/git.ts";
import { clearGitHub, readGitHub, signInGitHub } from "../src/catatui/github.ts";
import { registerGitTools } from "../src/catatui/gittools.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";

const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), `catatui-${name}-`)));
// The GitHub sign-in file goes to a temporary folder.
process.env.PI_CODING_AGENT_DIR = tmp("agent");

async function repo() {
  const dir = tmp("repo");
  await git(dir, ["init", "-q", "-b", "main"]);
  await git(dir, ["config", "user.name", "Test"]);
  await git(dir, ["config", "user.email", "t@example.com"]);
  return dir;
}

test("git works with no installed git: dugite's git", async () => {
  const r = await git(tmp("v"), ["--version"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^git version/);
});

test("a hook in the repository does not run", async () => {
  const dir = await repo();
  const marker = join(dir, "hook-ran");
  writeFileSync(join(dir, ".git", "hooks", "pre-commit"), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
  writeFileSync(join(dir, "a.txt"), "a");
  await git(dir, ["add", "a.txt"]);
  const r = await git(dir, ["commit", "-m", "x"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(existsSync(marker), false);
});

test("risky local settings: refused, and gitSync returns undefined", async () => {
  const dir = await repo();
  assert.deepEqual(repoRisk(dir), []);
  appendFileSync(join(dir, ".git", "config"), '[core]\n\tsshCommand = x\n\tfsmonitor = x\n[filter "x"]\n\tclean = x\n[diff "x"]\n\ttextconv = x\n[include]\n\tpath = x\n[credential]\n\thelper = x\n');
  assert.equal(repoRisk(dir).length, 6);
  await assert.rejects(git(dir, ["status"]), GitRefused);
  assert.equal(gitSync(dir, ["status"]), undefined);
});

test("GitHub SSH addresses become HTTPS; other SSH is not allowed", async () => {
  const dir = await repo();
  await git(dir, ["remote", "add", "origin", "git@github.com:msu/catatui.git"]);
  await git(dir, ["remote", "add", "other", "ssh://git@github.com/msu/catatui.git"]);
  assert.equal((await git(dir, ["ls-remote", "--get-url", "origin"])).stdout.trim(), "https://github.com/msu/catatui.git");
  assert.equal((await git(dir, ["ls-remote", "--get-url", "other"])).stdout.trim(), "https://github.com/msu/catatui.git");
  await git(dir, ["remote", "add", "lab", "git@lab.example.edu:x.git"]);
  const r = await git(dir, ["fetch", "lab"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /ssh/i);
});

test("credentials: only the catai token, and only for github.com", async () => {
  const dir = await repo();
  const fill = (host: string, token?: string) => git(dir, ["credential", "fill"], { token, user: "octo", input: `protocol=https\nhost=${host}\n\n` });
  assert.match((await fill("github.com", "TKN")).stdout, /username=octo\npassword=TKN/);
  // No token: no prompt, and not the student's keychain.
  const none = await fill("github.com");
  assert.notEqual(none.code, 0);
  assert.match(none.stderr, /terminal prompts disabled/);
  assert.notEqual((await fill("gitlab.com", "TKN")).code, 0);
});

// ---- github.ts ----

async function fakeGitHub(fn: () => Promise<void>) {
  const server = createServer((req, res) => {
    const ok = req.headers.authorization === "Bearer ghp_good0000000000000000000000";
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json", "github-authentication-token-expiration": "2027-01-02 03:04:05 UTC" });
    res.end(JSON.stringify(ok ? { login: "octo" } : { message: "Bad credentials" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.CATATUI_GITHUB_API = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try { await fn(); } finally { server.close(); delete process.env.CATATUI_GITHUB_API; }
}

test("GitHub sign-in: checks the token, saves it for the student only, and signs out", async () => {
  await fakeGitHub(async () => {
    assert.match(((await signInGitHub("not a token")) as { error: string }).error, /not a GitHub token/);
    assert.match(((await signInGitHub("ghp_bad00000000000000000000000")) as { error: string }).error, /did not accept/);
    const r = await signInGitHub(" ghp_good0000000000000000000000 ");
    assert.deepEqual(r, { token: "ghp_good0000000000000000000000", login: "octo", expires: Date.UTC(2027, 0, 2, 3, 4, 5) });
    assert.equal(readGitHub()?.login, "octo");
    const file = join(process.env.PI_CODING_AGENT_DIR!, "github.json");
    if (process.platform !== "win32") assert.equal((await import("node:fs")).statSync(file).mode & 0o777, 0o600);
    clearGitHub();
    assert.equal(readGitHub(), undefined);
  });
});

// ---- gittools.ts ----

function tools(cwd: string) {
  const { pi, tools } = fakePi();
  registerGitTools(pi);
  const { ctx } = fakeCtx(cwd);
  return async (name: string, params: Record<string, unknown> = {}) => (await tools.get(name).execute("id", params, undefined, undefined, ctx)).content[0].text as string;
}

test("git tools: init, status, commit, log, diff, restore", async () => {
  const dir = tmp("tools");
  const t = tools(dir);
  assert.match(await t("git_status"), /not a git repository/);
  assert.match(await t("git_init"), /Initialized/);
  assert.match(await t("git_init"), /already a git repository/);
  writeFileSync(join(dir, "a.txt"), "one\n");
  assert.match(await t("git_status"), /\?\? a.txt/);
  // No git name is set: the commit uses a name from the computer or GitHub.
  assert.match(await t("git_commit", { message: "first" }), /first/);
  assert.match(await t("git_log"), /: first/);
  writeFileSync(join(dir, "a.txt"), "two\n");
  assert.match(await t("git_diff"), /-one\n\+two/);
  assert.match(await t("git_restore", { paths: ["a.txt"] }), /Done/);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "one\n");
  assert.match(await t("git_diff"), /No changes/);
});

test("git tools: a repository that starts outside the project is refused", async () => {
  const outer = await repo();
  const project = join(outer, "project");
  mkdirSync(project);
  const t = tools(project);
  assert.match(await t("git_status"), /starts outside the project folder/);
  // git_init makes a new repository in the project.
  assert.match(await t("git_init"), /Initialized/);
  assert.match(await t("git_status"), /## No commits yet on main|## main/);
});

test("git tools: a risky repository is refused with the settings named", async () => {
  const dir = await repo();
  appendFileSync(join(dir, ".git", "config"), "[core]\n\tfsmonitor = evil\n");
  assert.match(await tools(dir)("git_status"), /core\.fsmonitor/);
});

test("git_push: no remote asks for a url; with no sign-in the student must sign in", async () => {
  const dir = await repo();
  const t = tools(dir);
  writeFileSync(join(dir, "a.txt"), "a");
  await t("git_commit", { message: "a" });
  assert.match(await t("git_push"), /has no remote/);
  // A local address that does not exist: git fails, and the tool shows the error. No network.
  const out = await t("git_push", { url: "https://127.0.0.1:1/none.git" });
  assert.match(out, /git failed/);
  assert.equal((await git(dir, ["remote", "get-url", "origin"])).stdout.trim(), "https://127.0.0.1:1/none.git");
});

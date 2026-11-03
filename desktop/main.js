// catatui desktop: Electron main process.
// - Starts catatui in pi RPC mode as a child process, with Electron's own Node (ELECTRON_RUN_AS_NODE).
// - Does the CatChat sign-in itself, because RPC mode has no /login. It uses the same code as the CLI
//   (src/catatui/auth.ts and store.ts), loaded with jiti.
// The renderer talks to this file through preload.cjs. See ../src/md/features/desktop.md.

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
// The catatui CLI. In development it is the repository. The packaged app gets it in milestone 6.
const CATATUI_BIN = join(ROOT, "bin", "catatui.js");

// The same folder as bin/catatui.js. Set it before store.ts reads it.
process.env.PI_CODING_AGENT_DIR ??= join(homedir(), ".catatui");

// Load the TypeScript sign-in code from the CLI.
const { createJiti } = await import(pathToFileURL(join(ROOT, "node_modules", "jiti", "lib", "jiti.mjs")).href);
const jiti = createJiti(import.meta.url);
const auth = await jiti.import(join(ROOT, "src", "catatui", "auth.ts"));
const store = await jiti.import(join(ROOT, "src", "catatui", "store.ts"));
const { CHANGE_TOOLS } = await jiti.import(join(ROOT, "src", "catatui", "config.ts"));

// pi itself, for the session lists. Load it only when the app needs it, because it is large.
let piModule;
const pi = async () => (piModule ??= await import(pathToFileURL(join(ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js")).href));

const isFolder = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** @type {BrowserWindow | undefined} */
let win;
/** @type {import("node:child_process").ChildProcess | undefined} */
let child;
let stopping = false;
let project = "";
let nextId = 1;
/** @type {Map<string, (r: unknown) => void>} */
const pending = new Map();
/** @type {AbortController | undefined} */
let signIn;

const toRenderer = (channel, data) => win?.webContents.send(channel, data);

// ---- changed files ----

// The files that the agent changed in this chat: full path -> the file before the first change (null: no file).
// The Files panel compares this with the file now. So an /undo or a change by the student shows correctly.
/** @type {Map<string, Buffer | null>} */
let changed = new Map();
const MAX_DIFF_BYTES = 300_000;

const readOrNull = (p) => { try { return readFileSync(p); } catch { return null; } };

// Called for each RPC event. Keep the file before the first change by a file tool (CHANGE_TOOLS in config.ts).
function trackFiles(rec) {
  if (rec.type !== "tool_execution_start" || !CHANGE_TOOLS.includes(rec.toolName)) return;
  const path = rec.args?.path;
  if (typeof path !== "string" || !project) return;
  const full = resolve(project, path.replace(/^@/, ""));
  if (!changed.has(full)) changed.set(full, readOrNull(full));
}

// A text file has no zero bytes in its first 8 KB. Excel and Word files are zip files, so they are binary.
const isBinary = (b) => !!b && b.subarray(0, 8192).includes(0);

ipcMain.handle("changed-files", () => {
  const files = [];
  for (const [full, before] of changed) {
    const after = readOrNull(full);
    if (before === null && after === null) continue;
    if (before && after && before.equals(after)) continue;
    const rel = relative(project, full);
    const binary = isBinary(before) || isBinary(after);
    const big = (before?.length ?? 0) + (after?.length ?? 0) > MAX_DIFF_BYTES;
    files.push({
      path: rel.startsWith("..") || isAbsolute(rel) ? full : rel,
      status: before === null ? "added" : after === null ? "deleted" : "modified",
      binary,
      big,
      before: binary || big ? undefined : before?.toString("utf8") ?? "",
      after: binary || big ? undefined : after?.toString("utf8") ?? "",
    });
  }
  return files;
});

// ---- catatui child process ----

// Start catatui for the project folder. Read stdout as JSONL: split only on LF (see pi docs/rpc.md, Framing).
function startChild() {
  stopping = false;
  child = spawn(process.execPath, [CATATUI_BIN, "--mode", "rpc"], {
    cwd: project,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        toRenderer("rpc-stderr", `Not JSON on stdout: ${line.slice(0, 200)}`);
        continue;
      }
      if (rec.type === "response" && rec.id && pending.has(rec.id)) {
        pending.get(rec.id)(rec);
        pending.delete(rec.id);
      } else {
        trackFiles(rec);
        toRenderer("rpc-event", rec);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (t) => toRenderer("rpc-stderr", t));
  const me = child;
  child.on("exit", (code, signal) => {
    for (const resolve of pending.values()) resolve({ type: "response", success: false, error: "catatui stopped." });
    pending.clear();
    if (child === me) child = undefined;
    // A stop that the app asked for (sign-out, new sign-in) is not an error.
    if (!stopping) toRenderer("rpc-exit", { code, signal });
  });
}

// Close stdin for an orderly stop (pi docs/rpc.md, Shutdown). Kill it if it does not stop in 3 seconds.
function stopChild() {
  const c = child;
  if (!c) return Promise.resolve();
  stopping = true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => c.kill(), 3000);
    c.once("exit", () => { clearTimeout(timer); resolve(); });
    c.stdin.end();
  });
}

function write(rec) {
  if (!child?.stdin.writable) return false;
  child.stdin.write(`${JSON.stringify(rec)}\n`);
  return true;
}

function command(cmd) {
  const id = `d${nextId++}`;
  return new Promise((resolve) => {
    if (!write({ ...cmd, id })) return resolve({ type: "response", success: false, error: "catatui is not running." });
    pending.set(id, resolve);
  });
}

// ---- IPC from the renderer ----

ipcMain.handle("rpc-command", (_e, cmd) => {
  // A new chat or an old chat starts a new list of changed files.
  if (cmd?.type === "new_session" || cmd?.type === "switch_session") changed = new Map();
  return command(cmd);
});
// The answer to a dialog (extension_ui_request). It has no response.
ipcMain.on("ui-response", (_e, response) => write({ type: "extension_ui_response", ...response }));

// The sign-in state and the project, for the first screen.
ipcMain.handle("info", () => {
  const cred = store.readCredential();
  return { project, signedIn: !!cred, user: cred?.user, expiryDays: store.expiryDays(cred) };
});

// Start catatui, or start it again so that pi reads a new sign-in. Resolves when catatui answers.
ipcMain.handle("start", async () => {
  if (!project) return { type: "response", success: false, error: "Open a project folder first." };
  await stopChild();
  changed = new Map();
  startChild();
  return command({ type: "get_state" });
});

// MSU SSO (CatChat App Connect), the same flow as the CLI. The renderer shows the URL in case no browser opens.
ipcMain.handle("sign-in-sso", async () => {
  signIn?.abort();
  signIn = new AbortController();
  try {
    const cred = await auth.ssoLogin({
      onAuth: ({ url }) => { shell.openExternal(url); toRenderer("sign-in-url", url); },
      onProgress: (m) => toRenderer("sign-in-progress", m),
      signal: signIn.signal,
    });
    store.saveCredential(cred);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    signIn = undefined;
  }
});

ipcMain.on("sign-in-cancel", () => signIn?.abort());

// A key that the student made at catchat access and pasted.
ipcMain.handle("sign-in-key", async (_e, raw) => {
  try {
    store.saveCredential(await auth.pastedKey(String(raw ?? "")));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("sign-out", async () => {
  await stopChild();
  store.clearSignIn();
});

ipcMain.on("open-external", (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
// Open a changed file in its normal app (for example Excel for .xlsx). Only files in the project.
ipcMain.on("open-path", (_e, path) => {
  const full = resolve(project, path);
  const rel = relative(project, full);
  if (project && !rel.startsWith("..") && !isAbsolute(rel)) shell.openPath(full);
});

// ---- projects and sessions ----

// Recent projects: the folders of the catatui sessions, newest first. A folder that does not exist now is not shown.
ipcMain.handle("list-projects", async () => {
  const { SessionManager } = await pi();
  const byCwd = new Map();
  for (const s of await SessionManager.listAll()) {
    if (!s.cwd) continue;
    const p = byCwd.get(s.cwd) ?? { path: s.cwd, name: basename(s.cwd), modified: 0, sessions: 0 };
    p.sessions += 1;
    p.modified = Math.max(p.modified, new Date(s.modified).getTime());
    byCwd.set(s.cwd, p);
  }
  return [...byCwd.values()].filter((p) => isFolder(p.path)).sort((a, b) => b.modified - a.modified).slice(0, 20);
});

// The chats (sessions) of the open project, newest first.
ipcMain.handle("list-sessions", async () => {
  if (!project) return [];
  const { SessionManager } = await pi();
  return (await SessionManager.list(project))
    .filter((s) => s.messageCount > 0)
    .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
    .map((s) => ({ path: s.path, name: s.name, first: s.firstMessage, modified: new Date(s.modified).getTime(), count: s.messageCount }));
});

ipcMain.handle("pick-folder", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Open a project folder", properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? undefined : r.filePaths[0];
});

// Change the project. The renderer then calls "start", which starts catatui in the new folder.
ipcMain.handle("open-project", async (_e, path) => {
  if (!isFolder(path)) return { ok: false, error: `The folder ${path} does not exist.` };
  await stopChild();
  project = path;
  win?.setTitle(`catatui - ${basename(path)}`);
  return { ok: true };
});

// ---- window ----

// A folder on the command line opens at once. Without one, the app shows the project screen.
function projectFromArgs() {
  const arg = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith("-") && a !== ".");
  return arg && existsSync(arg) && isFolder(arg) ? arg : "";
}

// For tests: CATATUI_DESKTOP_SNAPSHOT=out.png runs with a hidden window, sends CATATUI_DESKTOP_PROMPT,
// saves a screenshot when the agent is done or a dialog opens (or after 90 seconds), then quits.
const SNAPSHOT = process.env.CATATUI_DESKTOP_SNAPSHOT;

app.whenReady().then(async () => {
  project = projectFromArgs();

  win = new BrowserWindow({
    show: !SNAPSHOT,
    width: 1000,
    height: 760,
    minWidth: 520,
    minHeight: 400,
    title: project ? `catatui - ${basename(project)}` : "catatui",
    backgroundColor: "#101317",
    webPreferences: { preload: join(HERE, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links in answers open in the normal browser, not in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  win.loadFile(join(HERE, "dist", "index.html"));
  if (SNAPSHOT) snapshot();
});

async function snapshot() {
  const { writeFileSync } = await import("node:fs");
  const prompt = process.env.CATATUI_DESKTOP_PROMPT;
  await new Promise((r) => win.webContents.once("did-finish-load", r));
  await new Promise((r) => setTimeout(r, Number(process.env.CATATUI_DESKTOP_WAIT ?? 3000)));
  if (prompt) {
    await win.webContents.executeJavaScript(`(() => {
      const t = document.querySelector(".composer textarea");
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(t, ${JSON.stringify(prompt)}); t.dispatchEvent(new Event("input", { bubbles: true }));
      t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    })()`);
    const until = Date.now() + 90_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1000));
      // CATATUI_DESKTOP_ANSWER=1 clicks the first option of each dialog (for example "Yes").
      if (process.env.CATATUI_DESKTOP_ANSWER) await win.webContents.executeJavaScript(`document.querySelector(".options button")?.click()`);
      if (await win.webContents.executeJavaScript(`!!document.querySelector(".dialog") || !document.querySelector(".working")`)) break;
    }
  }
  // CATATUI_DESKTOP_CLICK="a ;; b" clicks each element in turn before the screenshot (for example the model chip).
  for (const sel of (process.env.CATATUI_DESKTOP_CLICK ?? "").split(";;").map((x) => x.trim()).filter(Boolean)) {
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sel)})?.click()`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  await new Promise((r) => setTimeout(r, 1000));
  writeFileSync(SNAPSHOT, (await win.webContents.capturePage()).toPNG());
  app.quit();
}

app.on("window-all-closed", () => {
  signIn?.abort();
  child?.stdin.end();
  app.quit();
});

// catatui desktop: Electron main process.
// - Starts catatui in pi RPC mode as a child process, with Electron's own Node (ELECTRON_RUN_AS_NODE).
// - Does the CatChat sign-in itself, because RPC mode has no /login. It uses the same code as the CLI
//   (src/catatui/auth.ts and store.ts), loaded with jiti.
// The renderer talks to this file through preload.cjs. See ../src/md/features/desktop.md.

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

// Chats: each chat has its own folder under Documents/catai/Chats. The student does not see these folders.
// A chat is a project in a hidden folder: the same tools, but the app shows no file tree.
const CHATS_ROOT = join(homedir(), "Documents", "catai", "Chats");
const isChat = (p) => !!p && (p === CHATS_ROOT || p.startsWith(`${CHATS_ROOT}/`) || p.startsWith(`${CHATS_ROOT}\\`));

// A folder for a new chat. If the newest chat folder is empty and has no chat yet, use it again,
// so that each launch does not leave an empty folder.
async function newChatFolder() {
  mkdirSync(CHATS_ROOT, { recursive: true });
  const folders = readdirSync(CHATS_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const newest = folders.at(-1);
  if (newest) {
    const path = join(CHATS_ROOT, newest);
    const { SessionManager } = await pi();
    if (readdirSync(path).length === 0 && (await SessionManager.list(path)).length === 0) return path;
  }
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  let name = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}`;
  while (existsSync(join(CHATS_ROOT, name))) name += "+";
  const path = join(CHATS_ROOT, name);
  mkdirSync(path);
  return path;
}

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

// ---- file tree ----

const MAX_TREE_FILES = 5000;
// Folders that the tree does not show when the project is not a git repository.
const SKIP = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".cache", "target", ".idea", ".DS_Store"]);

// Run git in the project. Returns undefined if git is not installed or the folder is not a repository.
function git(args) {
  try {
    return execFileSync("git", args, { cwd: project, encoding: "utf8", maxBuffer: 20_000_000, timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

// All files in the project. In a git repository, git gives the list, so .gitignore applies.
function listFiles() {
  const fromGit = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  if (fromGit !== undefined) return fromGit.split("\0").filter(Boolean).filter((p) => existsSync(join(project, p))).slice(0, MAX_TREE_FILES);
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(project, dir), { withFileTypes: true })) {
      if (out.length >= MAX_TREE_FILES || SKIP.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (e.isFile()) out.push(rel);
    }
  };
  try { walk(""); } catch { /* the folder cannot be read */ }
  return out;
}

// git status for each changed file: "M" (modified), "A" (added), "D" (deleted), "?" (new, not in git), "R" (renamed).
function gitStatus() {
  const out = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (out === undefined) return undefined;
  const status = {};
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    const path = rec.slice(3);
    if (xy[0] === "R" || xy[0] === "C") i++; // the next part is the old name
    status[path] = xy === "??" ? "?" : (xy[1] !== " " ? xy[1] : xy[0]);
  }
  return status;
}

// The tree: all files, the git status, and the files that the agent changed in this chat.
ipcMain.handle("file-tree", () => {
  if (!project) return { files: [], git: false, status: {}, agent: [] };
  const status = gitStatus();
  const agent = [...changed.keys()].map((full) => relative(project, full)).filter((r) => !r.startsWith("..") && !isAbsolute(r));
  const files = new Set(listFiles());
  // Deleted files are not on disk, but the tree shows them with their status.
  for (const [p, s] of Object.entries(status ?? {})) if (s === "D") files.add(p);
  return { files: [...files].sort(), git: status !== undefined, status: status ?? {}, agent };
});

// One file for the viewer: the text before and after. "Before" is the last git commit (HEAD) for a file in git,
// or the copy before the agent's first change in this chat. If nothing changed, before and after are the same.
ipcMain.handle("file-view", (_e, path) => {
  const full = resolve(project, path);
  const rel = relative(project, full);
  if (!project || rel.startsWith("..") || isAbsolute(rel)) return { error: "The file is not in the project." };
  const after = readOrNull(full);
  let before = after;
  let base = "";
  const inHead = git(["cat-file", "-e", `HEAD:${rel}`]) !== undefined;
  if (inHead) {
    const head = execGitBuffer(["show", `HEAD:${rel}`]);
    if (head) { before = head; base = "last commit"; }
  } else if (changed.has(full)) {
    before = changed.get(full);
    base = "before the agent";
  } else if (gitStatus()?.[rel] === "?") {
    before = null;
    base = "new file";
  }
  const binary = isBinary(before) || isBinary(after);
  const big = (before?.length ?? 0) + (after?.length ?? 0) > MAX_DIFF_BYTES;
  return {
    path: rel,
    base,
    status: before === null ? "added" : after === null ? "deleted" : before.equals(after) ? "same" : "modified",
    binary,
    big,
    before: binary || big ? undefined : before?.toString("utf8") ?? "",
    after: binary || big ? undefined : after?.toString("utf8") ?? "",
  };
});

// The right-click menu of a file or a folder in the tree. A native menu, so it looks like the other apps.
// Open, Show in Finder, and Copy path happen here. "add" and "diff" go back to the renderer.
ipcMain.handle("file-menu", (_e, path, opts) => new Promise((done) => {
  const full = resolve(project, path);
  const rel = relative(project, full);
  if (!project || rel.startsWith("..") || isAbsolute(rel)) return done(undefined);
  let picked;
  const reveal = process.platform === "darwin" ? "Show in Finder" : process.platform === "win32" ? "Show in Explorer" : "Show in folder";
  const template = [
    ...(opts?.folder ? [] : [
      { label: "Add to chat", click: () => { picked = "add"; } },
      { label: "Open", click: () => shell.openPath(full) },
      ...(opts?.canDiff ? [{ label: "Diff", click: () => { picked = "diff"; } }] : []),
      ...(opts?.canRollback ? [{ label: "Roll back to last commit...", click: async () => { if (await rollBack(rel)) toRenderer("files-changed"); } }] : []),
      { type: "separator" },
    ]),
    { label: reveal, click: () => shell.showItemInFolder(full) },
    { label: "Copy path", click: () => clipboard.writeText(full) },
    { label: "Copy relative path", click: () => clipboard.writeText(rel) },
  ];
  Menu.buildFromTemplate(template).popup({ window: win, callback: () => done(picked) });
}));

// Roll back one changed file. A file in the last commit: git puts back that version (also for a deleted file).
// A new file (not in the last commit): it goes to the trash, so the student can get it back.
// A native question comes first, because the changes are lost.
async function rollBack(rel) {
  const full = resolve(project, rel);
  const inHead = git(["cat-file", "-e", `HEAD:${rel}`]) !== undefined;
  const r = await dialog.showMessageBox(win, {
    type: "warning",
    message: `Roll back ${basename(rel)}?`,
    detail: inHead
      ? "The file goes back to the version in the last commit. Your changes to it are lost."
      : "This file is not in the last commit, so rolling back removes it. It goes to the trash.",
    buttons: ["Roll back", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response !== 0) return false;
  try {
    if (inHead) {
      if (git(["checkout", "HEAD", "--", rel]) === undefined) throw new Error("git could not put back the file.");
    } else {
      git(["rm", "--cached", "--quiet", "--", rel]); // if it was added to git; no error if not
      await shell.trashItem(full);
    }
    return true;
  } catch (e) {
    dialog.showErrorBox("Roll back failed", `catai could not roll back ${rel}: ${e.message}`);
    return false;
  }
}

// A dropped file: its path in the project. Files outside the project are refused, because the sandbox blocks them.
ipcMain.handle("project-path", (_e, full) => {
  if (!project || typeof full !== "string") return { error: "No project is open." };
  const rel = relative(project, full);
  if (!full || rel.startsWith("..") || isAbsolute(rel)) return { error: `${basename(full)} is not in the project folder. Copy it into ${basename(project)} first.` };
  if (!readOrNull(full)) return { error: `${basename(full)} is a folder or cannot be read. Drop a file.` };
  return { path: rel.split("\\").join("/") };
});

const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon" };
const MAX_IMAGE_BYTES = 15_000_000;

// A short preview of a file for the file card in the chat: the size, and the first lines of a text file.
const PREVIEW_LINES = 30;
ipcMain.handle("file-preview", (_e, path) => {
  const full = resolve(project, path);
  const rel = relative(project, full);
  if (!project || rel.startsWith("..") || isAbsolute(rel)) return { error: "The file is not in the project." };
  const data = readOrNull(full);
  if (data === null) return { error: "The file does not exist now." };
  // An image: send it as a data URL for the card (an <img> does not run scripts, also not in an SVG).
  const mime = IMAGE_TYPES[full.split(".").pop().toLowerCase()];
  if (mime && data.length <= MAX_IMAGE_BYTES) return { size: data.length, binary: true, image: `data:${mime};base64,${data.toString("base64")}` };
  if (isBinary(data)) return { size: data.length, binary: true };
  const lines = data.toString("utf8").split("\n");
  return { size: data.length, binary: false, lines: lines.length, text: lines.slice(0, PREVIEW_LINES).join("\n"), cut: lines.length > PREVIEW_LINES };
});

function execGitBuffer(args) {
  try {
    return execFileSync("git", args, { cwd: project, maxBuffer: 20_000_000, timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

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
  // resumeProject: the app last worked in this project (not in a chat). The chat start screen offers it.
  const st = readState();
  const resumeProject = st.lastKind === "project" && st.lastProject && isFolder(st.lastProject) && st.lastProject !== project ? st.lastProject : undefined;
  return { project, chat: isChat(project), resumeProject, signedIn: !!cred, user: cred?.user, expiryDays: store.expiryDays(cred) };
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
    // The student was in the browser. Bring the app to the front for the "signed in" animation.
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    app.focus({ steal: true });
    return { ok: true, user: cred.user };
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
    const cred = await auth.pastedKey(String(raw ?? ""));
    // A pasted key has no name. CatChat knows the key alias (<NetID>_<name>) and the user id (the NetID).
    try {
      const res = await fetch("https://catchat-api.msu.montana.edu/key/info", { headers: { Authorization: `Bearer ${cred.access}` }, signal: AbortSignal.timeout(10_000) });
      const info = (await res.json())?.info;
      cred.user = info?.key_alias ?? info?.user_id;
    } catch {
      // No name. The app shows "MSU account".
    }
    store.saveCredential(cred);
    return { ok: true, user: cred.user };
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
    if (!s.cwd || isChat(s.cwd)) continue;
    // "display" is the path with ~ for the home folder, so the list is shorter.
    const home = homedir();
    const display = s.cwd === home ? "~" : s.cwd.startsWith(`${home}/`) ? `~${s.cwd.slice(home.length)}` : s.cwd;
    const p = byCwd.get(s.cwd) ?? { path: s.cwd, display, name: basename(s.cwd), modified: 0, sessions: 0 };
    p.sessions += 1;
    p.modified = Math.max(p.modified, new Date(s.modified).getTime());
    byCwd.set(s.cwd, p);
  }
  return [...byCwd.values()].filter((p) => isFolder(p.path)).sort((a, b) => b.modified - a.modified).slice(0, 20);
});

// All catatui chats (sessions), in all project folders, newest first. Each has its folder.
ipcMain.handle("list-sessions", async () => {
  const { SessionManager } = await pi();
  const home = homedir();
  return (await SessionManager.listAll())
    .filter((s) => s.messageCount > 0 && s.cwd)
    .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
    .slice(0, 100)
    .map((s) => ({
      path: s.path, name: s.name, first: s.firstMessage, modified: new Date(s.modified).getTime(), count: s.messageCount,
      cwd: s.cwd, folder: s.cwd === home ? "~" : s.cwd.startsWith(`${home}/`) ? `~${s.cwd.slice(home.length)}` : s.cwd,
      here: s.cwd === project, exists: isFolder(s.cwd), chat: isChat(s.cwd),
    }));
});

// A new chat: a new chat folder. The renderer then calls "start".
ipcMain.handle("new-chat", async () => {
  await stopChild();
  project = await newChatFolder();
  saveState({ lastKind: "chat" });
  win?.setTitle("catai - Chat");
  return { ok: true, path: project };
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
  saveState(isChat(path) ? { lastKind: "chat" } : { lastProject: path, lastKind: "project" });
  win?.setTitle(isChat(path) ? "catai - Chat" : `catai - ${basename(path)}`);
  return { ok: true };
});

// ---- window ----

// The app state between launches (the last project), in the app data folder.
const statePath = () => join(app.getPath("userData"), "state.json");
function readState() {
  try { return JSON.parse(readFileSync(statePath(), "utf8")); } catch { return {}; }
}
function saveState(data) {
  try {
    mkdirSync(dirname(statePath()), { recursive: true });
    writeFileSync(statePath(), JSON.stringify({ ...readState(), ...data }, null, 2));
  } catch { /* The app works without it. */ }
}

// A folder on the command line opens as a project. Without one, the app starts a chat (the default).
async function startProject() {
  const arg = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith("-") && a !== ".");
  if (arg && isFolder(arg)) return resolve(arg);
  return newChatFolder();
}

// For tests: CATATUI_DESKTOP_SNAPSHOT=out.png runs with a hidden window, sends CATATUI_DESKTOP_PROMPT,
// saves a screenshot when the agent is done or a dialog opens (or after 90 seconds), then quits.
const SNAPSHOT = process.env.CATATUI_DESKTOP_SNAPSHOT;

// The app icon (build/icon.png, the bobcat on MSU blue). Packaging (milestone 6) makes .icns and .ico from it.
// In development, Electron shows its own icon unless the app sets this one.
const ICON = join(HERE, "build", "icon.png");
app.setName("catai");
// For tests: keep the app data (state.json) in a different folder, so tests do not change the real app data.
if (process.env.CATATUI_DESKTOP_USER_DATA) app.setPath("userData", process.env.CATATUI_DESKTOP_USER_DATA);

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock?.setIcon(ICON);
  project = await startProject();
  if (project && !isChat(project)) saveState({ lastProject: project, lastKind: "project" });

  win = new BrowserWindow({
    show: !SNAPSHOT,
    width: 1000,
    height: 760,
    minWidth: 520,
    minHeight: 400,
    title: isChat(project) ? "catai - Chat" : project ? `catai - ${basename(project)}` : "catai",
    backgroundColor: "#101317",
    icon: ICON,
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
      if (process.env.CATATUI_DESKTOP_ANSWER) await win.webContents.executeJavaScript(`document.querySelector(".window-buttons .btn.default")?.click()`);
      if (await win.webContents.executeJavaScript(`!!document.querySelector(".dialog") || !document.querySelector(".working")`)) break;
    }
  }
  // CATATUI_DESKTOP_JS runs JavaScript in the page first (for example to type in a field).
  if (process.env.CATATUI_DESKTOP_JS) await win.webContents.executeJavaScript(process.env.CATATUI_DESKTOP_JS);
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

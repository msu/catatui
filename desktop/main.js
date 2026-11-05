// catatui desktop: Electron main process.
// - Starts catatui in pi RPC mode as a child process, with Electron's own Node (ELECTRON_RUN_AS_NODE).
// - Does the CatChat sign-in itself, because RPC mode has no /login. It uses the same code as the CLI
//   (src/catatui/auth.ts and store.ts), loaded with jiti.
// The renderer talks to this file through preload.cjs. See ../src/md/features/desktop.md.

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, protocol, screen, shell } from "electron";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REMOVED, redactSession } from "./redact.js";
import { detectWebApp, isLocalUrl } from "./webapp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// The catatui package: bin/catatui.js, src/catatui, and node_modules (pi, jiti, dugite).
// In development it is the repository. The catai installers (docs/catai/install.ps1, install.sh) write root.json with the
// installed catatui package, so the app and the catatui command use the same files.
const ROOT = (() => { try { return JSON.parse(readFileSync(join(HERE, "root.json"), "utf8")).root; } catch { return join(HERE, ".."); } })();
// The catatui CLI.
const CATATUI_BIN = join(ROOT, "bin", "catatui.js");

// The same folder as bin/catatui.js. Set it before store.ts reads it.
process.env.PI_CODING_AGENT_DIR ??= join(homedir(), ".catatui");

// Load the TypeScript sign-in code from the CLI.
const { createJiti } = await import(pathToFileURL(join(ROOT, "node_modules", "jiti", "lib", "jiti.mjs")).href);
const jiti = createJiti(import.meta.url);
const auth = await jiti.import(join(ROOT, "src", "catatui", "auth.ts"));
const store = await jiti.import(join(ROOT, "src", "catatui", "store.ts"));
const { CHANGE_TOOLS, CATCHAT_API, DEFAULT_MODEL, toolPaths } = await jiti.import(join(ROOT, "src", "catatui", "config.ts"));
// git from the dugite package (git.ts), with the safety settings. The student does not need to install git.
const { gitSync } = await jiti.import(join(ROOT, "src", "catatui", "git.ts"));
// The catai GitHub sign-in (a pasted token) for the git tools.
const github = await jiti.import(join(ROOT, "src", "catatui", "github.ts"));
// The mock class data (classes.ts), for the Classes panels.
const classesData = await jiti.import(join(ROOT, "src", "catatui", "classes.ts"));

// pi itself, for the session lists. Load it only when the app needs it, because it is large.
let piModule;
const pi = async () => (piModule ??= await import(pathToFileURL(join(ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js")).href));

const isFolder = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// Chats: each chat has its own folder under Documents/catai/Chats. The student does not see these folders.
// A chat is a project in a hidden folder: the same tools, but the app shows no file tree.
const CHATS_ROOT = join(homedir(), "Documents", "catai", "Chats");
const inside = (root, p) => !!p && (p === root || p.startsWith(`${root}/`) || p.startsWith(`${root}\\`));
const isPlainChat = (p) => inside(CHATS_ROOT, p);
// Advising: one folder for all advising sessions. catatui starts there with the advisor prompt and tools (advising.ts).
const ADVISING_ROOT = join(homedir(), "Documents", "catai", "Advising");
const isAdvising = (p) => inside(ADVISING_ROOT, p);
// Classes: the overview session is the Classes folder. Each class chat is a folder in it, for example "CSCI 305".
const CLASSES_ROOT = join(homedir(), "Documents", "catai", "Classes");
const isClasses = (p) => inside(CLASSES_ROOT, p);
// A chat, an advising session, and a class session have no file tree and no path row. Projects are all other folders.
const isChat = (p) => isPlainChat(p) || isAdvising(p) || isClasses(p);
// Advising and Classes have mock data for a demo. The app shows them only with "--demo-mode" on the command line.
const DEMO = process.argv.includes("--demo-mode");
const isDemoArea = (p) => isAdvising(p) || isClasses(p);
// The mock student profile (account menu) for the demo.
const profileData = await jiti.import(join(ROOT, "src", "catatui", "profile.ts"));
const settings = await jiti.import(join(ROOT, "src", "catatui", "settings.ts"));
const suggestion = await jiti.import(join(ROOT, "src", "catatui", "suggest.ts"));
const idleCompact = await jiti.import(join(ROOT, "src", "catatui", "idle-compact.ts"));
// The grid of an .xlsx file in the side panel (excelGrid). exceljs loads only when the student opens a workbook.
const excel = await jiti.import(join(ROOT, "src", "catatui", "excel.ts"));
// The "New" submenu of the tree: the kinds of files and their start content (newfile.ts).
const newfile = await jiti.import(join(ROOT, "src", "catatui", "newfile.ts"));
const kindOf = (p) => (isAdvising(p) ? "advising" : p === CLASSES_ROOT ? "classes" : isClasses(p) ? "class" : isPlainChat(p) ? "chat" : "project");

// A folder for a new chat. If the newest chat folder is empty and has no chat yet, use it again,
// so that each launch does not leave an empty folder. A folder that is open in a window is not used again.
async function newChatFolder() {
  mkdirSync(CHATS_ROOT, { recursive: true });
  const folders = readdirSync(CHATS_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const newest = folders.at(-1);
  if (newest && !windowFor(join(CHATS_ROOT, newest))) {
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

// ---- windows ----
// Each window shows one chat, project, or advising session. Each window has a context:
// { win, project, child (its catatui process), changed (the files the agent changed), modeRestored, menuState,
//   openSession (a session to open after the start) }. A folder is open in one window only.
/** @type {Map<number, any>} */
const windows = new Map();
const ctxOf = (e) => windows.get(e.sender.id);
const windowFor = (folder) => [...windows.values()].find((c) => c.project === folder);
// snapshotWin: in a snapshot test the windows are hidden, so no window has focus. The menu goes to the snapshot window.
let snapshotWin;
const focusedCtx = () => windows.get((BrowserWindow.getFocusedWindow() ?? (snapshotWin?.isDestroyed() ? undefined : snapshotWin))?.webContents.id) ?? [...windows.values()].at(-1);
const titleFor = (p) => (isAdvising(p) ? "catai - Advising" : p === CLASSES_ROOT ? "catai - Classes" : isClasses(p) ? `catai - ${basename(p)}` : isChat(p) ? "catai - Chat" : p ? `catai - ${basename(p)}` : "catai");
let nextId = 1;
/** @type {Map<string, (r: unknown) => void>} */
const pending = new Map();
/** @type {AbortController | undefined} */
let signIn;

const toRenderer = (c, channel, data) => { if (c?.win && !c.win.isDestroyed()) c.win.webContents.send(channel, data); };
const toAll = (channel, data) => { for (const c of windows.values()) toRenderer(c, channel, data); };

// ---- changed files ----

// The files that the agent changed in this chat: full path -> the file before the first change (null: no file).
// The Files panel compares this with the file now. So an /undo or a change by the student shows correctly.
// Each window context has its own map: full path -> Buffer | null.
const MAX_DIFF_BYTES = 300_000;

const readOrNull = (p) => { try { return readFileSync(p); } catch { return null; } };

// Called for each RPC event. Keep the file before the first change by a file tool (CHANGE_TOOLS in config.ts).
function trackFiles(c, rec) {
  if (rec.type !== "tool_execution_start" || !CHANGE_TOOLS.includes(rec.toolName)) return;
  if (!c.project) return;
  for (const path of toolPaths(rec.toolName, rec.args ?? {})) {
    const full = resolve(c.project, path.replace(/^@/, ""));
    // Only files. A folder (mkdir, or move of a folder) has no diff.
    if (!c.changed.has(full) && !(existsSync(full) && statSync(full).isDirectory())) c.changed.set(full, readOrNull(full));
  }
}

// A text file has no zero bytes in its first 8 KB. Excel and Word files are zip files, so they are binary.
const isBinary = (b) => !!b && b.subarray(0, 8192).includes(0);

// ---- file tree ----

const MAX_TREE_FILES = 5000;
// Folders that the tree does not show when the project is not a git repository.
const SKIP = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".cache", "target", ".idea", ".DS_Store"]);

// Run git in the project (git.ts). Returns undefined if the folder is not a repository, git fails, or the repository settings can start programs.
function git(c, args) {
  try {
    return gitSync(c.project, args);
  } catch {
    return undefined;
  }
}

// All files in the project. In a git repository, git gives the list, so .gitignore applies.
// Empty folders, so a new folder ("New > Folder") shows in the tree. Not in hidden or skipped folders. At most 200.
function listEmptyDirs(project) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(join(project, dir), { withFileTypes: true }); } catch { return; }
    const visible = entries.filter((e) => !e.name.startsWith(".") && !SKIP.has(e.name));
    if (dir && visible.length === 0) out.push(dir);
    for (const e of visible) if (e.isDirectory() && out.length < 200) walk(dir ? `${dir}/${e.name}` : e.name);
  };
  walk("");
  return out;
}

function listFiles(c) {
  const project = c.project;
  const fromGit = git(c, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
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
function gitStatus(c) {
  const out = git(c, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
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
ipcMain.handle("file-tree", (e) => {
  const c = ctxOf(e);
  const project = c?.project;
  if (!project) return { files: [], git: false, status: {}, agent: [] };
  const status = gitStatus(c);
  const agent = [...c.changed.keys()].map((full) => relative(project, full)).filter((r) => !r.startsWith("..") && !isAbsolute(r));
  const files = new Set(listFiles(c));
  // Deleted files are not on disk, but the tree shows them with their status.
  for (const [p, s] of Object.entries(status ?? {})) if (s === "D") files.add(p);
  // The web app in the project, for the Preview button (webapp.js). undefined: no Preview button.
  const webApp = detectWebApp((rel) => readOrNull(join(project, rel))?.toString("utf8"), [...files]);
  return { files: [...files].sort(), emptyDirs: listEmptyDirs(project), git: status !== undefined, status: status ?? {}, agent, webApp };
});

// One file for the viewer: the text before and after. "Before" is the last git commit (HEAD) for a file in git,
// or the copy before the agent's first change in this chat. If nothing changed, before and after are the same.
ipcMain.handle("file-view", (e, path) => {
  const c = ctxOf(e);
  const project = c?.project;
  if (!project) return { error: "No project is open." };
  const full = resolve(project, path);
  const rel = relative(project, full);
  if (!project || rel.startsWith("..") || isAbsolute(rel)) return { error: "The file is not in the project." };
  const after = readOrNull(full);
  let before = after;
  let base = "";
  const inHead = git(c, ["cat-file", "-e", `HEAD:${rel}`]) !== undefined;
  if (inHead) {
    const head = execGitBuffer(c, ["show", `HEAD:${rel}`]);
    if (head) { before = head; base = "last commit"; }
  } else if (c.changed.has(full)) {
    before = c.changed.get(full);
    base = "before the agent";
  } else if (gitStatus(c)?.[rel] === "?") {
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
ipcMain.handle("file-menu", (e, path, opts) => new Promise((done) => {
  const c = ctxOf(e);
  const project = c?.project;
  if (!project) return done(undefined);
  const full = resolve(project, path);
  const rel = relative(project, full);
  if (!project || rel.startsWith("..") || isAbsolute(rel)) return done(undefined);
  let picked;
  const reveal = process.platform === "darwin" ? "Show in Finder" : process.platform === "win32" ? "Show in Explorer" : "Show in folder";
  // "New" and "Open in Terminal" use the folder, or the folder of the file.
  const dir = opts?.folder ? full : dirname(full);
  const template = [
    { label: "New", submenu: newfile.NEW_KINDS.map((k) => (k ? { label: k.label, click: () => { picked = `new:${k.kind}`; } } : { type: "separator" })) },
    { type: "separator" },
    // A folder, or a PDF, Word, or HTML file: the agent checks the documents and offers to fix them.
    ...(opts?.canAudit ? [{ label: "Audit accessibility", click: () => { picked = "audit"; } }, { type: "separator" }] : []),
    ...(opts?.folder ? [] : [
      { label: "Add to chat", click: () => { picked = "add"; } },
      { type: "separator" },
      // The same actions as the file buttons in the app (FileButtons): Launch, Open, View, Diff.
      ...(opts?.canLaunch ? [{ label: "Launch", click: () => { picked = "launch"; } }] : []),
      { label: "Open", click: () => shell.openPath(full) },
      { label: "Preview", click: () => { picked = "view"; } },
      ...(opts?.canDiff ? [{ label: "Diff", click: () => { picked = "diff"; } }] : []),
      ...(opts?.canRollback ? [{ label: "Roll back to last commit...", click: async () => { if (await rollBack(c, rel)) toRenderer(c, "files-changed"); } }] : []),
      { type: "separator" },
    ]),
    { label: reveal, click: () => (rel ? shell.showItemInFolder(full) : shell.openPath(full)) },
    { label: "Open in Terminal", click: () => openTerminal(dir) },
    { label: "Copy path", click: () => clipboard.writeText(full) },
    { label: "Copy relative path", click: () => clipboard.writeText(rel) },
  ];
  Menu.buildFromTemplate(template).popup({ window: c.win, callback: () => done(picked) });
}));

// A terminal window in a folder. macOS: Terminal. Windows: PowerShell. Linux: the default terminal.
function openTerminal(dir) {
  const opts = { cwd: dir, detached: true, stdio: "ignore" };
  let child;
  if (process.platform === "darwin") child = spawn("open", ["-a", "Terminal", dir], opts);
  else if (process.platform === "win32") child = spawn("cmd.exe", ["/c", "start", "", "powershell.exe", "-NoExit"], opts);
  else child = spawn("x-terminal-emulator", [], opts);
  child.on("error", (e) => dialog.showErrorBox("catai", `catai could not open a terminal: ${e.message}`));
  child.unref();
}

// "New" in the tree menu: make a file or a folder in a project folder. It does not replace a file.
ipcMain.handle("file-new", async (e, dirPath, name, kind) => {
  const project = ctxOf(e)?.project;
  if (!project) return { error: "No project is open." };
  const dir = resolve(project, dirPath ?? "");
  const relDir = relative(project, dir);
  if (relDir.startsWith("..") || isAbsolute(relDir)) return { error: "The folder is not in the project." };
  const k = newfile.newKind(kind);
  if (!k) return { error: `catai cannot make a file of the kind "${kind}".` };
  const file = newfile.newFileName(name, k);
  if (!file) return { error: "Type a name." };
  const full = join(dir, file);
  if (existsSync(full)) return { error: `${file} is there already. Type a different name.` };
  try {
    if (k.kind === "folder") mkdirSync(full, { recursive: true });
    else { mkdirSync(dir, { recursive: true }); writeFileSync(full, await newfile.newFileContent(k.kind, file), { flag: "wx" }); }
  } catch (err) { return { error: `catai could not make ${file}: ${err.message}` }; }
  return { path: relative(project, full).split("\\").join("/"), folder: k.kind === "folder" };
});

// Drag and drop in the tree: move a file or a folder into a folder of the project ("" is the project folder).
// It does not replace an item, and it does not move a folder into itself.
ipcMain.handle("file-move", (e, from, toDir) => {
  const project = ctxOf(e)?.project;
  if (!project) return { error: "No project is open." };
  const src = resolve(project, from ?? "");
  const dir = resolve(project, toDir ?? "");
  const inProject = (p) => { const r = relative(project, p); return r && !r.startsWith("..") && !isAbsolute(r); };
  if (!inProject(src) || (dir !== project && !inProject(dir))) return { error: "Only items in the project can move." };
  const dest = join(dir, basename(src));
  if (dest === src) return { same: true };
  if (dir === src || dir.startsWith(src + sep)) return { error: "A folder cannot move into itself." };
  if (existsSync(dest)) return { error: `${basename(src)} is in that folder already.` };
  try { renameSync(src, dest); } catch (err) { return { error: `catai could not move ${basename(src)}: ${err.message}` }; }
  const rel = (p) => relative(project, p).split(sep).join("/");
  return { from: rel(src), to: rel(dest) };
});

// Roll back one changed file. A file in the last commit: git puts back that version (also for a deleted file).
// A new file (not in the last commit): it goes to the trash, so the student can get it back.
// A native question comes first, because the changes are lost.
async function rollBack(c, rel) {
  const full = resolve(c.project, rel);
  const inHead = git(c, ["cat-file", "-e", `HEAD:${rel}`]) !== undefined;
  const r = await dialog.showMessageBox(c.win, {
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
      if (git(c, ["checkout", "HEAD", "--", rel]) === undefined) throw new Error("git could not put back the file.");
    } else {
      git(c, ["rm", "--cached", "--quiet", "--", rel]); // if it was added to git; no error if not
      await shell.trashItem(full);
    }
    return true;
  } catch (e) {
    dialog.showErrorBox("Roll back failed", `catai could not roll back ${rel}: ${e.message}`);
    return false;
  }
}

// A whole file for the side panel: the text (up to 2 MB), or an image as a data URL, or "binary".
const MAX_SIDE_BYTES = 2_000_000;
ipcMain.handle("file-read", async (e, path) => {
  const project = ctxOf(e)?.project;
  if (!project) return { error: "No project is open." };
  const full = resolve(project, path);
  const rel = relative(project, full);
  if (rel.startsWith("..") || isAbsolute(rel)) return { error: "The file is not in the project." };
  const data = readOrNull(full);
  if (data === null) return { error: "The file does not exist now." };
  const mime = IMAGE_TYPES[full.split(".").pop().toLowerCase()];
  if (mime && data.length <= MAX_IMAGE_BYTES) return { size: data.length, image: `data:${mime};base64,${data.toString("base64")}` };
  if (/\.xlsx$/i.test(full)) {
    try { return { size: data.length, sheets: await excel.excelGrid(full), full }; }
    catch (err) { return { size: data.length, binary: true, full, error: `catai cannot read this workbook: ${err.message}` }; }
  }
  if (isBinary(data)) return { size: data.length, binary: true, full };
  if (data.length > MAX_SIDE_BYTES) return { size: data.length, big: true, full };
  return { size: data.length, text: data.toString("utf8"), full };
});

// A project file as a URL for the web preview (file://). Only files in the project.
ipcMain.handle("file-url", (e, path) => {
  const project = ctxOf(e)?.project;
  if (!project) return undefined;
  const full = resolve(project, path);
  const rel = relative(project, full);
  if (rel.startsWith("..") || isAbsolute(rel) || !existsSync(full)) return undefined;
  return pathToFileURL(full).href;
});

// A dropped file: its path in the project. Files outside the project are refused, because the sandbox blocks them.
ipcMain.handle("project-path", (e, full) => {
  const project = ctxOf(e)?.project;
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
ipcMain.handle("file-preview", (e, path) => {
  const project = ctxOf(e)?.project;
  if (!project) return { error: "No project is open." };
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

function execGitBuffer(c, args) {
  return gitSync(c.project, args, { buffer: true });
}

ipcMain.handle("changed-files", (e) => {
  const c = ctxOf(e);
  const project = c?.project;
  const files = [];
  if (!project) return files;
  for (const [full, before] of c.changed) {
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

// The catatui processes, by folder. catatui cannot change its folder, so each chat and project has its own process.
// Each window has one active process (its `child`). When a window moves to another folder, the old process stays
// (parked), so a switch back is fast. The app also starts a process in advance for the folder of the one-click
// switch. At most POOL_PARKED processes are parked. The oldest parked one stops first.
// Each entry: { folder, proc, changed (the files the agent changed), status (the last setStatus per key),
// key (the CatChat key at the start), ready (resolves when catatui answers), used (time) }.
const POOL_PARKED = 2;
const ownerOf = (proc) => [...windows.values()].find((c) => c.child === proc);
/** @type {Map<string, any>} */
const pool = new Map();

// Start catatui in a folder. Read stdout as JSONL: split only on LF (see pi docs/rpc.md, Framing).
// Events go to the renderer only from the active process. The setStatus events are kept for each process,
// so the renderer gets them again when the process becomes active.
function spawnEntry(folder) {
  const proc = spawn(process.execPath, [CATATUI_BIN, "--mode", "rpc"], {
    cwd: folder,
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: "1", CATAI: "1", ...(DEMO ? { CATAI_DEMO: "1" } : {}),
      ...(isAdvising(folder) ? { CATATUI_ADVISING: "1" } : {}),
      ...(folder === CLASSES_ROOT ? { CATATUI_CLASSES: "1" } : isClasses(folder) ? { CATATUI_CLASS: basename(folder) } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const entry = { folder, proc, changed: new Map(), status: new Map(), key: store.readCredential()?.access, used: Date.now(), stopping: false };
  pool.set(folder, entry);

  let buf = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
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
        toRenderer(ownerOf(proc), "rpc-stderr", `Not JSON on stdout: ${line.slice(0, 200)}`);
        continue;
      }
      if (rec.type === "response" && rec.id && pending.has(rec.id)) {
        pending.get(rec.id)(rec);
        pending.delete(rec.id);
        continue;
      }
      if (rec.type === "extension_ui_request" && rec.method === "setStatus") entry.status.set(rec.statusKey, rec);
      const c = ownerOf(proc);
      if (!c) continue;
      trackFiles(c, rec);
      rememberMode(c, rec);
      toRenderer(c, "rpc-event", rec);
      if (rec.type === "agent_settled") titleForOpenChat(c).catch(() => {});
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (t) => toRenderer(ownerOf(proc), "rpc-stderr", t));
  proc.on("exit", (code, signal) => {
    for (const [id, resolve] of pending) {
      if (id.startsWith(`${proc.pid}:`)) { resolve({ type: "response", success: false, error: "catatui stopped." }); pending.delete(id); }
    }
    if (pool.get(folder) === entry) pool.delete(folder);
    const c = ownerOf(proc);
    if (!c) return;
    c.child = undefined;
    // A stop that the app asked for (sign-out, new sign-in) is not an error.
    if (!entry.stopping) toRenderer(c, "rpc-exit", { code, signal });
  });
  entry.ready = commandTo(proc, { type: "get_state" });
  return entry;
}

// Close stdin for an orderly stop (pi docs/rpc.md, Shutdown). Kill it if it does not stop in 3 seconds.
function stopEntry(entry) {
  entry.stopping = true;
  pool.delete(entry.folder);
  return new Promise((resolve) => {
    if (entry.proc.exitCode !== null) return resolve();
    const timer = setTimeout(() => entry.proc.kill(), 3000);
    entry.proc.once("exit", () => { clearTimeout(timer); resolve(); });
    entry.proc.stdin.end();
  });
}

// Stop all catatui processes (sign-out).
async function stopChild() {
  await Promise.all([...pool.values()].map(stopEntry));
  for (const c of windows.values()) c.child = undefined;
}

// Make the process for `project` active: a parked one, or a new one. A process from before a new sign-in
// stops, because pi reads the key at the start. Then the renderer gets the status again.
async function activate(c) {
  let entry = pool.get(c.project);
  if (entry && (entry.key !== store.readCredential()?.access || entry.proc.exitCode !== null)) {
    await stopEntry(entry);
    entry = undefined;
  }
  entry ??= spawnEntry(c.project);
  entry.used = Date.now();
  c.child = entry.proc;
  c.changed = entry.changed;
  await entry.ready;
  for (const rec of entry.status.values()) toRenderer(c, "rpc-event", rec);
  // Stop the oldest parked processes (no window has them).
  const parked = [...pool.values()].filter((e) => !ownerOf(e.proc)).sort((a, b) => b.used - a.used);
  for (const e of parked.slice(POOL_PARKED)) stopEntry(e);
  return entry;
}

// Start a process in advance for the folder of the one-click switch: from a chat the last project,
// from a project the last chat. It waits 2 seconds, so it does not slow the start of the active process.
let warmTimer;
function warmOther(c) {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(async () => {
    const project = c.project;
    let folder;
    if (isChat(project)) {
      folder = readState().lastProject;
    } else {
      const { SessionManager } = await pi();
      folder = (await SessionManager.listAll()).sort((a, b) => new Date(b.modified) - new Date(a.modified)).find((s) => isChat(s.cwd) && (DEMO || !isDemoArea(s.cwd)) && isFolder(s.cwd))?.cwd;
    }
    if (!folder || folder === project || pool.has(folder) || !isFolder(folder)) return;
    spawnEntry(folder).used = Date.now() - 1;
  }, 2000);
}

function write(rec, proc) {
  if (!proc?.stdin.writable) return false;
  proc.stdin.write(`${JSON.stringify(rec)}\n`);
  return true;
}

// A command to a process. The id starts with the process id, so a stop answers only its own commands.
function commandTo(proc, cmd) {
  const id = `${proc?.pid}:${nextId++}`;
  return new Promise((resolve) => {
    if (!write({ ...cmd, id }, proc)) return resolve({ type: "response", success: false, error: "catatui is not running." });
    pending.set(id, resolve);
  });
}
const command = (c, cmd) => commandTo(c?.child, cmd);

// ---- IPC from the renderer ----

ipcMain.handle("rpc-command", async (e, cmd) => {
  const c = ctxOf(e);
  // The thinking level: keep it in state.json, so each catatui start gets it (restoreMode).
  if (cmd?.type === "set_thinking_level" || cmd?.type === "cycle_thinking_level") {
    const r = await command(c, cmd);
    const level = cmd.type === "set_thinking_level" ? cmd.level : r.data?.level;
    if (r.success && level) saveState({ agentMode: { ...(readState().agentMode ?? {}), thinking: level } });
    return r;
  }
  // A new chat or an old chat starts a new list of changed files.
  if (cmd?.type === "new_session" || cmd?.type === "switch_session") c?.changed.clear();
  return command(c, cmd);
});
// The answer to a dialog (extension_ui_request). It has no response.
ipcMain.on("ui-response", (e, response) => write({ type: "extension_ui_response", ...response }, ctxOf(e)?.child));

// The sign-in state and the project, for the first screen.
ipcMain.handle("info", (e) => {
  const c = ctxOf(e);
  const project = c?.project ?? "";
  // A session to open after the start (a window opened for an old chat). Only once.
  const openSession = c?.openSession;
  if (c) c.openSession = undefined;
  const cred = store.readCredential();
  // resumeProject: the app last worked in this project (not in a chat). The chat start screen offers it.
  const st = readState();
  // lastProject: the Project button opens it with one click from a chat.
  const lastProject = st.lastProject && isFolder(st.lastProject) && st.lastProject !== project ? st.lastProject : undefined;
  const resumeProject = st.lastKind === "project" ? lastProject : undefined;
  return {
    project, chat: isChat(project), kind: kindOf(project), resumeProject, lastProject, openSession, signedIn: !!cred, user: cred?.user, expiryDays: store.expiryDays(cred),
    demo: DEMO, profile: DEMO ? profileData.PROFILE : undefined,
  };
});

// Start catatui, or start it again so that pi reads a new sign-in. Resolves when catatui answers.
ipcMain.handle("start", async (e) => {
  const c = ctxOf(e);
  if (!c?.project) return { type: "response", success: false, error: "Open a project folder first." };
  c.modeRestored = false;
  await activate(c);
  await restoreMode(c);
  warmOther(c);
  return command(c, { type: "get_state" });
});

// catatui keeps the mode (ask, plan, auto, yolo) and ta for one session only. The app starts catatui again for each
// chat and project, so it keeps the last mode and ta in state.json and sets them again after each start.
// Before the restore, catatui sends its start state (ask). The app does not save that.
function rememberMode(c, rec) {
  if (!c.modeRestored || rec.type !== "extension_ui_request" || rec.method !== "setStatus" || rec.statusKey !== "catatui") return;
  try {
    const { mode, ta } = JSON.parse(rec.statusText);
    saveState({ agentMode: { ...(readState().agentMode ?? {}), mode, ta: !!ta } });
  } catch { /* Not JSON: ignore it. */ }
}
async function restoreMode(c) {
  const saved = readState().agentMode;
  // A parked process can have an old mode, so set the mode and ta each time.
  if (saved) {
    await command(c, { type: "prompt", message: `/mode ${["ask", "plan", "auto", "yolo"].includes(saved.mode) ? saved.mode : "ask"}` });
    await command(c, { type: "prompt", message: `/mode ta ${saved.ta ? "on" : "off"}` });
    if (saved.thinking) await command(c, { type: "set_thinking_level", level: saved.thinking });
  }
  c.modeRestored = true;
}

// MSU SSO (CatChat App Connect), the same flow as the CLI. The renderer shows the URL in case no browser opens.
ipcMain.handle("sign-in-sso", async (e) => {
  const c = ctxOf(e);
  const win = c?.win;
  signIn?.abort();
  signIn = new AbortController();
  try {
    const cred = await auth.ssoLogin({
      onAuth: ({ url }) => { shell.openExternal(url); toRenderer(c, "sign-in-url", url); },
      onProgress: (m) => toRenderer(c, "sign-in-progress", m),
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

// Sign out: stop all catatui processes and close the other windows.
ipcMain.handle("sign-out", async (e) => {
  const c = ctxOf(e);
  await stopChild();
  store.clearSignIn();
  for (const o of windows.values()) if (o !== c) o.win.close();
});

ipcMain.on("open-external", (_e, url) => { if (/^(https?|mailto):/.test(url)) shell.openExternal(url); });

// ---- GitHub sign-in (github.ts): a token for git push, pull, and clone. The renderer never gets the token. ----
const gitHubState = () => { const s = github.readGitHub(); return s ? { login: s.login, expiryDays: github.gitHubExpiryDays(s) } : null; };
ipcMain.handle("github-state", () => gitHubState());
ipcMain.on("github-token-page", () => shell.openExternal(github.TOKEN_URL));
ipcMain.handle("github-sign-in", async (_e, token) => {
  const r = await github.signInGitHub(String(token ?? ""));
  return "error" in r ? { error: r.error } : gitHubState();
});
ipcMain.handle("github-sign-out", () => { github.clearGitHub(); return null; });
// Open a changed file in its normal app (for example Excel for .xlsx). Only files in the project.
ipcMain.on("open-path", (e, path) => {
  const project = ctxOf(e)?.project;
  if (!project) return;
  const full = resolve(project, path);
  const rel = relative(project, full);
  if (project && !rel.startsWith("..") && !isAbsolute(rel)) shell.openPath(full);
});

// ---- projects and sessions ----

// Recent projects: the folders of the catatui sessions, newest first. A folder that does not exist now is not shown.
ipcMain.handle("list-projects", () => listProjects());
async function listProjects() {
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
  return [...byCwd.values()].filter((p) => isFolder(p.path)).sort((a, b) => b.modified - a.modified);
}

// All catatui chats (sessions), in all project folders, newest first. Each has its folder.
ipcMain.handle("list-sessions", async (e) => {
  const project = ctxOf(e)?.project;
  const { SessionManager } = await pi();
  const home = homedir();
  return (await SessionManager.listAll())
    .filter((s) => s.messageCount > 0 && s.cwd && (DEMO || !isDemoArea(s.cwd)))
    .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
    .slice(0, 100)
    .map((s) => ({
      path: s.path, name: s.name, first: s.firstMessage, modified: new Date(s.modified).getTime(), count: s.messageCount,
      cwd: s.cwd, folder: s.cwd === home ? "~" : s.cwd.startsWith(`${home}/`) ? `~${s.cwd.slice(home.length)}` : s.cwd,
      here: s.cwd === project, exists: isFolder(s.cwd), chat: isChat(s.cwd), kind: kindOf(s.cwd),
      title: readTitles()[s.path], projectName: basename(s.cwd),
      _s: s,
    }))
    .map((x, i, all) => {
      if (i === all.length - 1) queueTitles(all.slice(0, 30).filter((y) => !y.title).map((y) => y._s));
      const { _s, ...rest } = x;
      return rest;
    });
});

// ---- suggestions in the message box ----
// While the student types, a fast model completes the message (suggest.ts). The renderer shows the rest in gray,
// and Tab accepts it. The "suggest" setting can turn it off.
const suggestAbort = new Map();
ipcMain.handle("suggest", async (e, text, context) => {
  const id = e.sender.id;
  suggestAbort.get(id)?.abort();
  const ac = new AbortController();
  suggestAbort.set(id, ac);
  const key = store.readCredential()?.access;
  if (!key || typeof text !== "string" || !suggestion.suggestOn()) return "";
  return suggestion.fetchSuggestion(text, typeof context === "string" ? context : undefined, key, ac.signal);
});

// ---- settings (catatui.json, settings.ts) ----
// The terminal program and the app use the same file. A running catatui process reads it each time.
ipcMain.handle("get-settings", () => ({
  suggest: suggestion.suggestOn(),
  idleCompaction: idleCompact.idleSettings(settings.readSettings().idleCompaction),
}));
ipcMain.handle("set-setting", (_e, key, value) => {
  if (key === "suggest" && typeof value === "boolean") settings.writeSetting("suggest", value);
  else if (key === "idleCompaction" && value && typeof value === "object") {
    // idleSettings drops bad values, so the file gets only good values.
    settings.writeSetting("idleCompaction", idleCompact.idleSettings(value));
  } else return false;
  return true;
});

// ---- conversations (the sessions of a project) ----

// A session file of this window's folder, or undefined. Rename and delete work only on these.
async function sessionOf(c, path) {
  if (!c?.project || typeof path !== "string") return undefined;
  const { SessionManager } = await pi();
  return (await SessionManager.list(c.project)).find((x) => x.path === path);
}

// ---- remove sensitive information from a conversation ----
// redact.js changes the session file. Then catatui loads the session again (switch_session), so the model does not see the old text.
// The text already went to CatChat when the student sent it. This does not remove it there.

// target: { ts } (a message), { toolCallId } (a tool call and its result), or { text } (each copy of the text).
ipcMain.handle("redact-session", async (e, target) => {
  const c = ctxOf(e);
  const st = await command(c, { type: "get_state" });
  const file = st.data?.sessionFile;
  if (!file || !existsSync(file)) return { ok: false, error: "This conversation is not saved yet." };
  if (st.data?.isStreaming) return { ok: false, error: "Wait until the agent is done." };
  const what = target?.text ? `"${target.text.length > 40 ? `${target.text.slice(0, 40)}...` : target.text}"` : "this message";
  if (target?.text !== undefined && target.text.length < 3) return { ok: false, error: "Select at least 3 characters." };
  // For tests: CATATUI_DESKTOP_YES=<button index> answers the question.
  const r = process.env.CATATUI_DESKTOP_YES ? { response: Number(process.env.CATATUI_DESKTOP_YES) } : await dialog.showMessageBox(c.win, {
    type: "warning",
    message: `Remove ${what} from this conversation?`,
    detail: `catai replaces ${target?.text ? "each copy of the text" : "the message"} with "${REMOVED}" on this computer, and the agent does not see it again. ` +
      "CatChat got the text when you sent it. This does not remove it from CatChat.",
    buttons: ["Remove", "Cancel"], defaultId: 1, cancelId: 1,
  });
  if (r.response !== 0) return { ok: false, cancelled: true };
  const { text, count } = redactSession(readFileSync(file, "utf8"), target);
  if (!count) return { ok: false, error: "catai did not find the text in this conversation." };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  // The title came from the old text. Make a new one.
  if (readTitles()[file]) { delete titles[file]; try { writeFileSync(titlesPath(), JSON.stringify(titles, null, 1)); } catch { /* No file. */ } }
  await command(c, { type: "switch_session", sessionPath: file });
  toAll("titles-updated");
  return { ok: true, count };
});

// The right-click menu of the chat when text is selected: Copy, and Remove from this conversation.
ipcMain.handle("chat-menu", (e, text) => new Promise((done) => {
  const c = ctxOf(e);
  let picked;
  Menu.buildFromTemplate([
    { label: "Copy", click: () => clipboard.writeText(text) },
    { type: "separator" },
    { label: "Remove from This Conversation...", click: () => { picked = "remove"; } },
  ]).popup({ window: c?.win, callback: () => done(picked) });
}));

// Rename: the app title (titles.json), which the menus show.
ipcMain.handle("rename-session", async (e, path, title) => {
  const clean = String(title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean || !(await sessionOf(ctxOf(e), path))) return { ok: false };
  saveTitle(path, clean);
  toAll("titles-updated");
  return { ok: true };
});

// Delete: a question first. "Move to Trash" (the student can get it back) or "Delete Permanently" (for a
// conversation with sensitive information). Any session from the list, but not one that is open in another window.
ipcMain.handle("delete-session", async (e, path) => {
  const c = ctxOf(e);
  const { SessionManager } = await pi();
  const s = (await SessionManager.listAll()).find((x) => x.path === path);
  if (!s) return { ok: false };
  for (const o of windows.values()) {
    if (o === c || !o.child) continue;
    if ((await command(o, { type: "get_state" })).data?.sessionFile === path) {
      focusWindow(o);
      return { ok: false, error: "This conversation is open in another window. Close it there first." };
    }
  }
  const r = process.env.CATATUI_DESKTOP_YES ? { response: Number(process.env.CATATUI_DESKTOP_YES) } : await dialog.showMessageBox(c.win, {
    type: "warning",
    message: `Delete the conversation "${readTitles()[path] ?? (s.name || s.firstMessage || "").slice(0, 60)}"?`,
    detail: "Move to Trash: you can get it back from the trash. Delete Permanently: the conversation is gone from this computer. " +
      "Project files do not change. CatChat got the messages when you sent them. This does not remove them from CatChat.",
    buttons: ["Move to Trash", "Delete Permanently", "Cancel"], defaultId: 2, cancelId: 2,
  });
  if (r.response === 2) return { ok: false };
  try {
    if (r.response === 1) rmSync(path, { force: true }); else await shell.trashItem(path);
  } catch (err) { return { ok: false, error: err.message }; }
  if (readTitles()[path]) { delete titles[path]; try { writeFileSync(titlesPath(), JSON.stringify(titles, null, 1)); } catch { /* No file. */ } }
  toAll("titles-updated");
  return { ok: true, permanent: r.response === 1 };
});

// ---- chat titles ----

// A short title for each chat, made by the default model (Qwen) from the start of the chat.
// The titles are in titles.json in the app data folder: { "<session file>": "<title>" }.
const titlesPath = () => join(app.getPath("userData"), "titles.json");
let titles;
function readTitles() {
  if (!titles) { try { titles = JSON.parse(readFileSync(titlesPath(), "utf8")); } catch { titles = {}; } }
  return titles;
}
function saveTitle(session, title) {
  readTitles()[session] = title;
  try { writeFileSync(titlesPath(), JSON.stringify(titles, null, 1)); } catch { /* The app works without the file. */ }
}

// The chat text for the title. File lines ("[file] path" and the request after them) become "File: name".
function chatText(s) {
  return (s.allMessagesText || s.firstMessage || "")
    .replace(/\[file\] (\S[^\n]*)\n?I added (this file|these files)[^\n]*/g, (_m, p) => `File: ${basename(p)}`)
    .slice(0, 2000);
}

// Qwen thinks before it answers, so it needs some room (max_tokens). A title takes about 1 second.
async function makeTitle(text) {
  const key = store.readCredential()?.access;
  if (!key || !text.trim()) return undefined;
  const res = await fetch(`${CATCHAT_API}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DEFAULT_MODEL, max_tokens: 800, temperature: 0.2,
      messages: [
        { role: "system", content: "Write a short title (3 to 6 words) for the conversation that the user gives. Reply with the title only, no quotes. Think very briefly." },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return undefined;
  const title = (await res.json())?.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, "").trim().replace(/^["'*#\s]+|["'*.\s]+$/g, "");
  return title && title.length <= 80 ? title : undefined;
}

// Make the missing titles in the background, a few at a time, then tell the renderer.
const titleQueue = new Map();
let titleRunning = 0;
function queueTitles(sessions) {
  for (const s of sessions) if (!readTitles()[s.path] && !titleQueue.has(s.path)) titleQueue.set(s.path, s);
  pumpTitles();
}
function pumpTitles() {
  while (titleRunning < 3 && titleQueue.size) {
    const [path, s] = titleQueue.entries().next().value;
    titleQueue.delete(path);
    titleRunning++;
    makeTitle(chatText(s))
      .then((t) => { if (t) { saveTitle(path, t); toAll("titles-updated"); } })
      .catch(() => {})
      .finally(() => { titleRunning--; pumpTitles(); });
  }
}

// After the agent is done, make a title for the open chat if it has none.
async function titleForOpenChat(c) {
  const st = await command(c, { type: "get_state" });
  const file = st.data?.sessionFile;
  if (!file || readTitles()[file] || !c.project) return;
  const { SessionManager } = await pi();
  const s = (await SessionManager.list(c.project)).find((x) => x.path === file);
  if (s) queueTitles([s]);
}

// ---- folders, for the "new project" folder picker ----

// Places on the left of the folder picker.
function places() {
  const home = homedir();
  const list = [
    { name: "catai projects", path: join(home, "Documents", "catai") },
    { name: "Documents", path: join(home, "Documents") },
    { name: "Desktop", path: join(home, "Desktop") },
    { name: "Downloads", path: join(home, "Downloads") },
    { name: "Home", path: home },
  ];
  return list.filter((p) => isFolder(p.path) || p.name === "catai projects");
}

// The folders in a folder (no hidden folders, no chat folders). The picker starts in Documents/catai.
ipcMain.handle("list-folders", (_e, path) => {
  const dir = path && isFolder(path) ? path : join(homedir(), "Documents", "catai");
  mkdirSync(dir, { recursive: true });
  let folders = [];
  try {
    folders = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !(dir === join(homedir(), "Documents", "catai") && ["Chats", "Advising", "Classes"].includes(e.name)))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  } catch { /* The folder cannot be read. */ }
  const parent = dirname(dir);
  return { path: dir, parent: parent !== dir ? parent : undefined, folders, places: places(), sep: process.platform === "win32" ? "\\" : "/" };
});

// A new folder in the picker. Letters, digits, spaces, dots, - and _ only.
ipcMain.handle("make-folder", (_e, parent, name) => {
  const clean = String(name ?? "").replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+/, "").trim();
  if (!clean) return { error: "Type a name for the folder." };
  const path = join(parent, clean);
  if (existsSync(path)) return { error: `A folder named ${clean} is there already.` };
  try { mkdirSync(path, { recursive: true }); } catch (e) { return { error: `catai could not make the folder: ${e.message}` }; }
  return { path };
});

// Advising: the advising folder. The renderer then calls "start", and "new_session" for a new advising session.
ipcMain.handle("advising", (e) => {
  if (!DEMO) return { ok: false, error: "Advising is only in the demo (catai --demo-mode)." };
  mkdirSync(ADVISING_ROOT, { recursive: true });
  return moveTo(ctxOf(e), ADVISING_ROOT);
});

// Classes: the overview folder, or the folder of one class (only the mock classes in classes.ts).
ipcMain.handle("classes", (e, code) => {
  if (!DEMO) return { ok: false, error: "Classes is only in the demo (catai --demo-mode)." };
  const c = code ? classesData.CLASSES.find((x) => x.code === code) : undefined;
  if (code && !c) return { ok: false, error: `There is no class ${code}.` };
  const folder = c ? join(CLASSES_ROOT, c.code) : CLASSES_ROOT;
  mkdirSync(folder, { recursive: true });
  return moveTo(ctxOf(e), folder);
});

// The data for the Classes panels: the classes, the upcoming work, the term dates, and the linked project.
ipcMain.handle("class-info", (e) => {
  const folder = ctxOf(e)?.project;
  const code = folder && isClasses(folder) && folder !== CLASSES_ROOT ? basename(folder) : undefined;
  const link = code ? classesData.classLink(folder) : undefined;
  return { term: classesData.TERM, classes: classesData.summaries(), upcoming: classesData.upcoming(14), code, link: link && isFolder(link) ? link : undefined };
});

// Link a project folder to the open class (project.json in the class folder). No path: remove the link.
ipcMain.handle("link-class-project", (e, path) => {
  const folder = ctxOf(e)?.project;
  if (!folder || !isClasses(folder) || folder === CLASSES_ROOT) return { ok: false };
  const file = join(folder, "project.json");
  if (!path) { try { writeFileSync(file, "{}"); } catch { /* No link. */ } return { ok: true }; }
  if (!isFolder(path)) return { ok: false, error: `The folder ${path} does not exist.` };
  writeFileSync(file, JSON.stringify({ path }, null, 1));
  return { ok: true };
});

// A new chat: a new chat folder. The renderer then calls "start".
ipcMain.handle("new-chat", async (e) => moveTo(ctxOf(e), await newChatFolder()));

ipcMain.handle("pick-folder", async (e) => {
  const r = await dialog.showOpenDialog(ctxOf(e)?.win, { title: "Open a project folder", properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? undefined : r.filePaths[0];
});

// Change the project of a window. The renderer then calls "start", which starts catatui in the new folder.
// sessionPath: an old chat to open there.
ipcMain.handle("open-project", async (e, path, sessionPath) => {
  if (!isFolder(path)) return { ok: false, error: `The folder ${path} does not exist.` };
  return moveTo(ctxOf(e), path, sessionPath);
});

// Move a window to a folder. If another window has the folder, bring that window to the front (and open the
// session there). The renderer gets { moved: true } and does nothing.
function moveTo(c, path, sessionPath) {
  const other = windowFor(path);
  if (other && other !== c) {
    focusWindow(other);
    if (sessionPath) toRenderer(other, "open-session", sessionPath);
    return { ok: false, moved: true };
  }
  if (!c) return { ok: false, error: "No window." };
  c.project = path;
  saveState(isChat(path) ? { lastKind: kindOf(path) } : { lastProject: path, lastKind: "project" });
  c.win.setTitle(titleFor(path));
  buildMenu();
  saveWindows();
  return { ok: true, path };
}

function focusWindow(c) {
  if (c.win.isMinimized()) c.win.restore();
  c.win.show();
  c.win.focus();
}

// Open a folder in a new window (or bring its window to the front). No folder: a new chat.
// sessionPath: an old chat to open in the window.
ipcMain.handle("open-in-window", async (_e, path, sessionPath) => {
  if (path && !isFolder(path)) return { ok: false, error: `The folder ${path} does not exist.` };
  const other = path && windowFor(path);
  if (other) {
    focusWindow(other);
    if (sessionPath) toRenderer(other, "open-session", sessionPath);
    return { ok: true };
  }
  createWindow(path || (await newChatFolder()), { openSession: sessionPath, cascade: true });
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

// The windows at start. A folder on the command line opens as a project, in one window.
// Without one, the windows from the last run open again (each folder must still exist). Else a new chat.
async function startWindows() {
  const arg = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith("-") && a !== ".");
  if (arg && isFolder(arg)) return [{ project: resolve(arg), bounds: SNAPSHOT ? undefined : fitBounds(readState().window) }];
  if (!SNAPSHOT) {
    const seen = new Set();
    const saved = (readState().windows ?? []).filter((w) => w?.project && isFolder(w.project) && (DEMO || !isDemoArea(w.project)) && !seen.has(w.project) && seen.add(w.project));
    if (saved.length) return saved.map((w) => ({ project: w.project, bounds: fitBounds(w) }));
  }
  return [{ project: await newChatFolder(), bounds: SNAPSHOT ? undefined : fitBounds(readState().window) }];
}

// ---- application menu ----
// Most items send an action to the renderer ("menu" event), which does the same thing as the button.
// The renderer sends its state ("menu-state"): the permissions, the options, busy, and chat or project.
// The menu shows the state of the focused window. It is built again when another window gets the focus.
ipcMain.on("menu-state", (e, st) => {
  const c = ctxOf(e);
  if (!c || JSON.stringify(st) === JSON.stringify(c.menuState)) return;
  c.menuState = st;
  if (c === focusedCtx()) buildMenu();
});
const act = (action) => () => toRenderer(focusedCtx(), "menu", action);
const SITE = "https://catatui.cs.montana.edu";

// The About window. The standard macOS About panel shows the Electron icon in development, so the app
// shows its own window with the bobcat icon.
function showAbout() {
  let cli = "";
  try { cli = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")).version; } catch { /* Not in a package. */ }
  dialog.showMessageBox(focusedCtx()?.win, {
    title: "About catai",
    message: "catai",
    detail: `Version ${app.getVersion()}${cli ? ` (catatui ${cli})` : ""}\nMontana State University\n${SITE}`,
    icon: nativeImage.createFromPath(ICON),
    buttons: ["OK", "Website"],
    defaultId: 0,
  }).then((r) => { if (r.response === 1) shell.openExternal(SITE); });
}

async function buildMenu() {
  const mac = process.platform === "darwin";
  const c = focusedCtx();
  const st = c?.menuState ?? { mode: "ask", busy: false, chat: true };
  const project = c?.project;
  const recent = (await listProjects().catch(() => [])).slice(0, 10);
  const inProject = project && !isChat(project);
  const option = (key, label) => ({ label, type: "checkbox", checked: !!st[key], click: (item) => act(`option:${key}:${item.checked ? "on" : "off"}`)() });
  const perm = (m, label) => ({ label, type: "radio", checked: st.mode === m, click: act(`mode:${m}`) });
  const template = [
    ...(mac ? [{
      label: "catai",
      submenu: [
        { label: "About catai", click: showAbout },
        { type: "separator" },
        { label: "Settings...", accelerator: "Cmd+,", click: act("settings") },
        { type: "separator" },
        { label: "Sign Out", click: act("sign-out") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: "Hide catai" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit", label: "Quit catai" },
      ],
    }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Chat", accelerator: "CmdOrCtrl+N", enabled: !st.busy, click: act("new-chat") },
        { label: "New Project...", accelerator: "CmdOrCtrl+Shift+N", enabled: !st.busy, click: act("new-project") },
        { label: "New Window", accelerator: "CmdOrCtrl+Alt+N", click: async () => createWindow(await newChatFolder(), { cascade: true }) },
        { label: "New Conversation", accelerator: mac ? "Cmd+Ctrl+N" : "Ctrl+Alt+Shift+N", enabled: !st.busy && !!inProject, click: act("new-chat-here") },
        ...(DEMO ? [
          { label: "Advising", accelerator: "CmdOrCtrl+Shift+A", enabled: !st.busy, click: act("advising") },
          { label: "Classes", accelerator: "CmdOrCtrl+Shift+C", enabled: !st.busy, click: act("classes") },
        ] : []),
        { type: "separator" },
        { label: "Open Project...", accelerator: "CmdOrCtrl+O", enabled: !st.busy, click: act("all-projects") },
        { label: "Show All History...", accelerator: "CmdOrCtrl+Y", enabled: !st.busy, click: act("history") },
        {
          label: "Open Recent Project",
          enabled: !st.busy && recent.length > 0,
          submenu: recent.length ? recent.map((p) => ({ label: p.name, sublabel: p.display, click: act(`open:${p.path}`) })) : [{ label: "None", enabled: false }],
        },
        { type: "separator" },
        { label: mac ? "Show Project in Finder" : "Show Project in Explorer", enabled: !!inProject, click: () => shell.openPath(project) },
        { label: "Close Project", accelerator: "CmdOrCtrl+Shift+W", enabled: !st.busy && !!inProject, click: act("close-project") },
        { type: "separator" },
        // On macOS, Settings is in the catai menu.
        ...(mac ? [] : [{ label: "Settings...", accelerator: "Ctrl+,", click: act("settings") }, { type: "separator" }]),
        mac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Show Files", type: "checkbox", checked: st.tree !== false, accelerator: "CmdOrCtrl+B", enabled: !!inProject, click: act("toggle-tree") },
        { label: "Web Preview", accelerator: "CmdOrCtrl+Shift+P", enabled: !!st.webApp, click: act("preview") },
        { type: "separator" },
        { label: "Next Area", accelerator: "F6", click: act("next-area") },
        { label: "Previous Area", accelerator: "Shift+F6", click: act("prev-area") },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Agent",
      submenu: [
        { label: "Stop", accelerator: "CmdOrCtrl+.", enabled: !!st.busy, click: act("stop") },
        { label: "Undo Last Request", accelerator: "CmdOrCtrl+Alt+Z", enabled: !st.busy && !!st.canUndo, click: act("undo") },
        { type: "separator" },
        { label: "Permissions", enabled: false },
        perm("ask", "Ask"), perm("plan", "Plan"), perm("auto", "Auto"), perm("yolo", "Yolo"),
        { type: "separator" },
        { label: "Options", enabled: false },
        option("ta", "Teaching Assistant"), option("sandbox", "Sandbox"), option("ste", "Simple English"),
        { type: "separator" },
        {
          label: "Thinking",
          enabled: (st.thinkingLevels ?? []).length > 1,
          submenu: (st.thinkingLevels ?? []).length > 1
            ? st.thinkingLevels.map((l) => ({ label: l, type: "radio", checked: st.thinking === l, click: act(`thinking:${l}`) }))
            : [{ label: "This model does not think", enabled: false }],
        },
        { label: "Next Thinking Level", accelerator: "CmdOrCtrl+Shift+T", enabled: (st.thinkingLevels ?? []).length > 1, click: act("next-thinking") },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "What catai Can Do", click: act("help") },
        { label: "catai Website", click: () => shell.openExternal(SITE) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The window place and size from the last run, if it still fits on a screen. The screens can change between
// runs (a laptop without its second screen). If the title bar is not on a screen now, the window opens centered on
// the main screen. If the window is larger than its screen now, it gets smaller.
function fitBounds(b) {
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return undefined;
  const area = screen.getAllDisplays().map((d) => d.workArea).find((a) =>
    // The top 40 pixels of the window (the title bar) must be on this screen, at least 120 pixels wide.
    Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x) >= 120 && b.y >= a.y && b.y + 40 <= a.y + a.height);
  if (!area) return undefined;
  const width = Math.min(b.width, area.width);
  const height = Math.min(b.height, area.height);
  return {
    x: Math.max(area.x, Math.min(b.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(b.y, area.y + area.height - height)),
    width, height, maximized: !!b.maximized,
  };
}

// Save the open windows (folder, place, size) when a window moves, changes size, or changes its folder, and at quit.
// When the last window closes, the list keeps it, so the next start opens it again.
let quitting = false;
let windowsTimer;
function saveWindows(now = false) {
  if (SNAPSHOT || quitting) return;
  clearTimeout(windowsTimer);
  const save = () => {
    const list = [...windows.values()].filter((c) => c.project && !c.win.isDestroyed())
      .map((c) => ({ project: c.project, ...c.win.getNormalBounds(), maximized: c.win.isMaximized() }));
    if (list.length) saveState({ windows: list, window: list[0] });
  };
  if (now) save(); else windowsTimer = setTimeout(save, 500);
}
app.on("before-quit", () => { saveWindows(true); quitting = true; });

// A new window for a folder. cascade: put it a little below and right of the focused window.
function createWindow(project, { bounds, openSession, cascade } = {}) {
  const from = cascade ? focusedCtx()?.win : undefined;
  if (from && !bounds) {
    const b = from.getNormalBounds();
    bounds = fitBounds({ x: b.x + 28, y: b.y + 28, width: b.width, height: b.height });
  }
  const win = new BrowserWindow({
    show: !SNAPSHOT,
    width: bounds?.width ?? 1000,
    height: bounds?.height ?? 760,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 520,
    minHeight: 400,
    title: titleFor(project),
    backgroundColor: "#101317",
    icon: ICON,
    // webviewTag: the web preview in the side panel. "will-attach-webview" below makes each webview safe.
    webPreferences: { preload: join(HERE, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true },
  });
  const c = { win, project, child: undefined, changed: new Map(), modeRestored: false, menuState: undefined, openSession };
  const id = win.webContents.id;
  windows.set(id, c);
  if (project && !isChat(project)) saveState({ lastProject: project, lastKind: "project" });
  if (bounds?.maximized) win.maximize();
  win.on("move", () => saveWindows());
  win.on("resize", () => saveWindows());
  win.on("focus", () => buildMenu());
  // The window title is "catai - <folder>" (titleFor), not the page title.
  win.on("page-title-updated", (e) => e.preventDefault());
  win.on("closed", () => {
    // The window's catatui process stays parked (a fast start if the folder opens again).
    const wasLast = windows.size === 1;
    windows.delete(id);
    if (!wasLast) saveWindows(true);
    buildMenu();
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
  saveWindows();
  return c;
}

// For tests: CATATUI_DESKTOP_SNAPSHOT=out.png runs with a hidden window, sends CATATUI_DESKTOP_PROMPT,
// saves a screenshot when the agent is done or a dialog opens (or after 90 seconds), then quits.
const SNAPSHOT = process.env.CATATUI_DESKTOP_SNAPSHOT;

// The app icon (build/icon.png, the bobcat on MSU blue). Packaging (milestone 6) makes .icns and .ico from it.
// In development, Electron shows its own icon unless the app sets this one.
const ICON = join(HERE, "build", "icon.png");
app.setName("catai");

// HTML widgets (show_widget type "html"): the model's page is served at catai-widget://frame/<id>, with a strict
// Content-Security-Policy: inline scripts and styles only, no network. The renderer shows it in a sandboxed iframe
// (allow-scripts only), so it cannot reach the app. The page sends its answer with catai.submit(data) (postMessage).
protocol.registerSchemesAsPrivileged([{ scheme: "catai-widget", privileges: { standard: true, secure: true } }]);
const widgetPages = new Map();
const WIDGET_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";
const WIDGET_BRIDGE = `<script>window.catai = { submit: (data) => parent.postMessage({ cataiWidget: true, data }, "*") };
addEventListener("load", () => {
  // The height of the content (the lowest element), not of the frame. A page with height: 100% would grow without end.
  const send = () => { let h = 0; for (const e of document.body.querySelectorAll("*")) h = Math.max(h, e.getBoundingClientRect().bottom); parent.postMessage({ cataiWidget: true, height: Math.ceil(h + 12) }, "*"); };
  send(); setTimeout(send, 300); new MutationObserver(send).observe(document.body, { subtree: true, childList: true, attributes: true });
});</script>`;
ipcMain.handle("widget-frame", (_e, html) => {
  const id = randomUUID();
  widgetPages.set(id, String(html ?? ""));
  if (widgetPages.size > 200) widgetPages.delete(widgetPages.keys().next().value);
  return `catai-widget://frame/${id}`;
});
// For tests: keep the app data (state.json) in a different folder, so tests do not change the real app data.
if (process.env.CATATUI_DESKTOP_USER_DATA) app.setPath("userData", process.env.CATATUI_DESKTOP_USER_DATA);

// The web preview (<webview> in the side panel): no preload, no Node, sandboxed, and only http, https, and file
// pages. Links to other sites and links that open a new window go to the normal browser.
app.on("web-contents-created", (_e, contents) => {
  // Errors and crashes go to stdout, so a blank window has a cause in the log.
  contents.on("render-process-gone", (_ev, d) => console.error(`catai: ${contents.getType()} renderer gone: ${d.reason} (exit ${d.exitCode}) ${contents.getURL()}`));
  contents.on("console-message", (ev) => { if (ev.level === "error") console.error(`catai: ${contents.getType()} console: ${ev.message} (${ev.sourceId}:${ev.lineNumber})`); });
  contents.on("will-attach-webview", (ev, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    if (!/^(https?|file):/i.test(params.src ?? "")) ev.preventDefault();
  });
  if (contents.getType() === "webview") {
    // The preview shows only this project. A link to another site opens in the normal browser.
    contents.on("will-navigate", (ev, url) => {
      if (/^https?:/i.test(url) && !isLocalUrl(url)) { ev.preventDefault(); shell.openExternal(url); }
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
  }
});

app.whenReady().then(async () => {
  protocol.handle("catai-widget", (req) => {
    const id = new URL(req.url).pathname.replace(/^\//, "");
    const html = widgetPages.get(id);
    if (html === undefined) return new Response("Not found", { status: 404 });
    const page = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${WIDGET_BRIDGE}`) : `${WIDGET_BRIDGE}${html}`;
    return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": WIDGET_CSP } });
  });
  if (process.platform === "darwin") app.dock?.setIcon(ICON);
  const first = (await startWindows()).map((w) => createWindow(w.project, { bounds: w.bounds }))[0];
  buildMenu();
  if (SNAPSHOT) snapshot(first.win);
});

async function snapshot(win) {
  snapshotWin = win;
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
  // CATATUI_DESKTOP_MENU="Agent>Plan ;; File>New Project..." clicks application menu items. It also prints
  // the labels and the states of the Agent menu, so a test can read them.
  for (const path of (process.env.CATATUI_DESKTOP_MENU ?? "").split(";;").map((x) => x.trim()).filter(Boolean)) {
    let items = Menu.getApplicationMenu()?.items ?? [];
    let item;
    for (const label of path.split(">")) {
      item = items.find((i) => i.label === label);
      items = item?.submenu?.items ?? [];
    }
    if (item) item.click(); else console.log(`menu item not found: ${path}`);
    await new Promise((r) => setTimeout(r, Number(process.env.CATATUI_DESKTOP_AFTER ?? 1500)));
  }
  if (process.env.CATATUI_DESKTOP_MENU) {
    const agent = Menu.getApplicationMenu()?.items.find((i) => i.label === "Agent");
    console.log(`menu Agent: ${agent?.submenu.items.filter((i) => i.type !== "separator").map((i) => `${i.label}${i.checked ? "*" : ""}${i.enabled ? "" : "(off)"}`).join(", ")}`);
  }
  // CATATUI_DESKTOP_JS runs JavaScript in the page first (for example to type in a field).
  if (process.env.CATATUI_DESKTOP_JS) await win.webContents.executeJavaScript(process.env.CATATUI_DESKTOP_JS);
  // CATATUI_DESKTOP_FRAME_JS runs JavaScript in the first widget frame (catai-widget://).
  if (process.env.CATATUI_DESKTOP_FRAME_JS) {
    const f = win.webContents.mainFrame.framesInSubtree.find((x) => x.url.startsWith("catai-widget:"));
    if (f) await f.executeJavaScript(process.env.CATATUI_DESKTOP_FRAME_JS);
    await new Promise((r) => setTimeout(r, Number(process.env.CATATUI_DESKTOP_AFTER ?? 1000)));
  }
  // CATATUI_DESKTOP_CLICK="a ;; b" clicks each element in turn before the screenshot (for example the model chip).
  for (const sel of (process.env.CATATUI_DESKTOP_CLICK ?? "").split(";;").map((x) => x.trim()).filter(Boolean)) {
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sel)})?.click()`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  await new Promise((r) => setTimeout(r, 1000));
  // The open windows, for tests: the title and the folder of each.
  console.log(`windows: ${[...windows.values()].map((c) => `${c.win.getTitle()} [${basename(c.project)}] child=${!!c.child}`).join(" | ")}`);
  writeFileSync(SNAPSHOT, (await win.webContents.capturePage()).toPNG());
  app.quit();
}

app.on("window-all-closed", () => {
  signIn?.abort();
  for (const e of pool.values()) e.proc.stdin.end();
  app.quit();
});

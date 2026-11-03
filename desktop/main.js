// catatui desktop: Electron main process.
// - Starts catatui in pi RPC mode as a child process, with Electron's own Node (ELECTRON_RUN_AS_NODE).
// - Does the CatChat sign-in itself, because RPC mode has no /login. It uses the same code as the CLI
//   (src/catatui/auth.ts and store.ts), loaded with jiti.
// The renderer talks to this file through preload.cjs. See ../src/md/features/desktop.md.

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

ipcMain.handle("rpc-command", (_e, cmd) => command(cmd));
// The answer to a dialog (extension_ui_request). It has no response.
ipcMain.on("ui-response", (_e, response) => write({ type: "extension_ui_response", ...response }));

// The sign-in state and the project, for the first screen.
ipcMain.handle("info", () => {
  const cred = store.readCredential();
  return { project, signedIn: !!cred, user: cred?.user, expiryDays: store.expiryDays(cred) };
});

// Start catatui, or start it again so that pi reads a new sign-in. Resolves when catatui answers.
ipcMain.handle("start", async () => {
  await stopChild();
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

// ---- window ----

async function pickProject() {
  const arg = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith("-") && a !== ".");
  if (arg && existsSync(arg)) return arg;
  // There is no window yet, so the folder dialog can open behind the terminal. Bring the app to the front first.
  app.focus({ steal: true });
  const r = await dialog.showOpenDialog({ title: "Open a project folder", properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? undefined : r.filePaths[0];
}

// For tests: CATATUI_DESKTOP_SNAPSHOT=out.png runs with a hidden window, sends CATATUI_DESKTOP_PROMPT,
// saves a screenshot when the agent is done or a dialog opens (or after 90 seconds), then quits.
const SNAPSHOT = process.env.CATATUI_DESKTOP_SNAPSHOT;

app.whenReady().then(async () => {
  const cwd = await pickProject();
  if (!cwd) return app.quit();
  project = cwd;

  win = new BrowserWindow({
    show: !SNAPSHOT,
    width: 1000,
    height: 760,
    minWidth: 520,
    minHeight: 400,
    title: "catatui",
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

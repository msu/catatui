#!/usr/bin/env node
// Run pi with the MSU extension and theme.
// catatui keeps its own config in ~/.catatui, so it does not mix with a plain pi install.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { printVersion, update } from "./update.js";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const args = process.argv.slice(2);

// pi prints its own version for --version. Print the catatui version and the pi version, and check for a newer catatui.
if (args.includes("--version") || args.includes("-v")) {
  const { version } = JSON.parse(readFileSync(root("package.json"), "utf8"));
  const { VERSION } = await import("@earendil-works/pi-coding-agent");
  await printVersion(version, VERSION);
  process.exit(0);
}

// "pi update" updates pi itself, which does not work for catatui. Use the catatui update for both words.
if (args.includes("--update") || args[0] === "update") process.exit(update());

process.env.CATATUI = "1";
process.env.PI_CODING_AGENT_DIR ??= join(homedir(), ".catatui");
// pi shows "Update Available ... Run pi update" for new pi versions. Students cannot update pi, because
// catatui sets the pi version. catatui --version checks for catatui updates instead.
process.env.PI_SKIP_VERSION_CHECK ??= "1";

const extra = ["-e", root("src/catatui/index.ts"), "--theme", root("themes"), "--skill", root("skills")];
// pi picks msu-light on a light terminal and msu on a dark terminal.
if (!args.includes("--use-theme")) extra.push("--use-theme", "msu-light/msu");

// Import after the env is set, because pi reads PI_CODING_AGENT_DIR when it loads.
const { main, InteractiveMode, VERSION } = await import("@earendil-works/pi-coding-agent");

// Change pi defaults in settings.json. pi has no options for these. pi reads the file in main(), after this.
// - Hide the thinking blocks. Ctrl+T shows them. pi writes this key only when the student presses Ctrl+T,
//   so if the key is there, keep the student's choice.
// - Do not show the pi changelog after a catatui update changes the pi version. It is about pi, not catatui.
//   If the key is not there, this is a new install. pi does not show the changelog then, so do not add the key.
const settingsFile = join(process.env.PI_CODING_AGENT_DIR, "settings.json");
try {
  const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
  const changed = { ...settings };
  if (!("hideThinkingBlock" in changed)) changed.hideThinkingBlock = true;
  if ("lastChangelogVersion" in changed) changed.lastChangelogVersion = VERSION;
  if (JSON.stringify(changed) !== JSON.stringify(settings)) {
    mkdirSync(dirname(settingsFile), { recursive: true });
    writeFileSync(settingsFile, JSON.stringify(changed, null, 2));
  }
} catch {
  // A bad settings.json. pi shows its own error for it, so do nothing here.
}

// Before the first sign-in, pi shows "No models available. Use /login ..." with links to pi docs.
// Hide this warning and start "/login catchat" at once. pi has no option or public API for this.
// If a pi update renames showWarning or handleLoginCommand, the student sees pi's warning or
// presses Enter to run "/login catchat" (the extension types it). Nothing else breaks.
const showWarning = InteractiveMode?.prototype?.showWarning;
if (typeof showWarning === "function") {
  InteractiveMode.prototype.showWarning = function (message) {
    if (typeof message !== "string" || !message.startsWith("No models available.")) return showWarning.call(this, message);
    if (typeof this.handleLoginCommand !== "function") return showWarning.call(this, message);
    // Wait until pi completes its startup, then open the sign-in dialog.
    setTimeout(() => this.handleLoginCommand("catchat").catch(() => {}), 0);
  };
}

// If the student presses Escape in the sign-in dialog, pi shows "Failed to login to MSU CatChat: This operation was aborted".
// The student closed the dialog on purpose, so hide this error.
const showError = InteractiveMode?.prototype?.showError;
if (typeof showError === "function") {
  InteractiveMode.prototype.showError = function (message) {
    if (typeof message === "string" && message.startsWith("Failed to login to MSU CatChat") && message.endsWith("This operation was aborted")) return;
    return showError.call(this, message);
  };
}
await main([...extra, ...args]);

// "catatui --version" and "catatui --update".
// The installer (install.sh, install.ps1) sets CATATUI_APP in the catatui command. Without it, npm or npx installed catatui.

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const REPO = "https://raw.githubusercontent.com/msu/catatui/fall-2026";
const SITE = "https://catatui.cs.montana.edu";
const INSTALL_SH = `curl -fsSL ${SITE}/install.sh | sh`;
const INSTALL_PS1 = `irm ${SITE}/install.ps1 | iex`;
const INSTALL_NPM = "npm install -g github:msu/catatui#fall-2026";

// The version in package.json on GitHub. The check compares only this number, so increase it for each release.
async function latestVersion() {
  const res = await fetch(`${REPO}/package.json`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return (await res.json()).version;
}

// 1 if a is newer, -1 if b is newer, 0 if the same.
function compare(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  return 0;
}

export async function printVersion(version, piVersion) {
  console.log(`catatui ${version} (pi ${piVersion})`);
  try {
    const latest = await latestVersion();
    if (compare(latest, version) > 0) console.log(`catatui ${latest} is available. To update, run: catatui --update`);
    else console.log("This is the newest version.");
  } catch (err) {
    console.log(`Cannot check for updates: ${err.message}. Check your network connection.`);
  }
}

// Ask a yes or no question in the terminal. The default is no.
async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export async function update() {
  if (!process.env.CATATUI_APP) {
    console.log(`npm or npx installed catatui. To update, run: ${INSTALL_NPM}`);
    // With no terminal (a script or a pipe), only show the command.
    if (!process.stdin.isTTY || !(await confirm("Run it now?"))) return 0;
    // shell: on Windows, npm is npm.cmd.
    return spawnSync(INSTALL_NPM, { stdio: "inherit", shell: true }).status ?? 1;
  }
  // On Windows, the installer cannot replace node.exe while this node.exe runs. The student must run it.
  if (process.platform === "win32") {
    console.log(`To update, close catatui, then run this in PowerShell:\n  ${INSTALL_PS1}`);
    return 0;
  }
  return spawnSync("sh", ["-c", INSTALL_SH], { stdio: "inherit" }).status ?? 1;
}

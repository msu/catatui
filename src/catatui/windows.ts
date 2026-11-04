// Windows: the model uses PowerShell, not bash. pi's bash tool needs Git Bash, and many students do not have Git
// for Windows. PowerShell is part of Windows. pi has a "powershell" tool for this (pi docs/windows.md).
// The purpose-built tools (run, the file tools, the git tools) work with no shell, so the model needs the shell less.
// CATATUI_SHELL=bash keeps bash (for a student who has Git Bash and wants it).
// See src/md/features/windows.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WINDOWS_PROMPT = `# Windows

The computer runs Windows. The shell tool is powershell (Windows PowerShell 5.1 or PowerShell 7). There is no bash.
- Use the run tool to run programs (python, node, npm, java). Use move, copy, delete, and mkdir for files. Use the git_ tools for git.
- Use powershell only when no other tool does the job. Write PowerShell, not bash: no &&, no export, no $(...) for subshells.
  Use ; between commands, $env:NAME for environment variables, and Get-ChildItem, Get-Content, Select-String.
- Paths use \\ or /. The python command can be "py" or "python".`;

export const usePowerShell = () => process.platform === "win32" && process.env.CATATUI_SHELL !== "bash";

export function registerWindows(pi: ExtensionAPI) {
  if (!usePowerShell()) return;
  pi.on("session_start", async () => {
    const active = pi.getActiveTools().filter((t) => t !== "bash");
    pi.setActiveTools([...new Set([...active, "powershell"])]);
  });
  pi.on("before_agent_start", async (event) => {
    event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, windows: WINDOWS_PROMPT };
  });
}

#!/usr/bin/env node
// Run pi with the MSU extension and theme.
// catatui keeps its own config in ~/.catatui, so it does not mix with a plain pi install.

import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const args = process.argv.slice(2);

process.env.CATATUI = "1";
process.env.PI_CODING_AGENT_DIR ??= join(homedir(), ".catatui");

const extra = ["-e", root("extensions/msu/index.ts"), "--theme", root("themes")];
if (!args.includes("--use-theme")) extra.push("--use-theme", "msu");

// Import after the env is set, because pi reads PI_CODING_AGENT_DIR when it loads.
const { main } = await import("@earendil-works/pi-coding-agent");
await main([...extra, ...args]);

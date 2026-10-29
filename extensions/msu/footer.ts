// One-line footer with short labels:
//   cwd: ~/project (main)  model: gpt-oss:120b  think: medium  ctx: 1.2% of 115k  mode: ask
// "ctx" is the part of the model's context window that the conversation uses.
// Texts from ctx.ui.setStatus() (for example "mode: ask" from permissions.ts) go at the end.
// If the line is too long, the start of the cwd path is cut, so the other fields stay visible.
// If less than MIN_CWD columns are left for the cwd, the cwd gets its own line.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

const SEP = "  ";
const MIN_CWD = 20;
const tokens = (n: number) => (n < 1000 ? `${n}` : `${Math.round(n / 1000)}k`);

export function setFooter(pi: ExtensionAPI, ctx: ExtensionContext) {
  ctx.ui.setFooter((tui, theme, footerData) => {
    const unsub = footerData.onBranchChange(() => tui.requestRender());
    const label = (name: string, value: string) => `${theme.fg("dim", `${name}:`)} ${theme.fg("muted", value)}`;
    return {
      dispose: unsub,
      invalidate() {},
      render(width: number): string[] {
        const usage = ctx.getContextUsage();
        const ctxText = usage
          ? `${usage.percent === null ? "?" : usage.percent.toFixed(1)}% of ${tokens(usage.contextWindow)}`
          : "?";
        const rest = [
          label("model", ctx.model?.id ?? "none"),
          ...(ctx.model?.reasoning ? [label("think", pi.getThinkingLevel())] : []),
          label("ctx", ctxText),
          ...footerData.getExtensionStatuses().values(),
        ].join(SEP);

        const home = homedir();
        const branch = footerData.getGitBranch();
        let cwd = ctx.cwd.startsWith(home) ? `~${ctx.cwd.slice(home.length)}` : ctx.cwd;
        if (branch) cwd += ` (${branch})`;
        const oneLine = width - visibleWidth(rest) - SEP.length - "cwd: ".length >= MIN_CWD;
        const room = (oneLine ? width - visibleWidth(rest) - SEP.length : width) - "cwd: ".length;
        if (cwd.length > room) cwd = `...${cwd.slice(cwd.length - room + 3)}`;
        if (oneLine) return [truncateToWidth(`${label("cwd", cwd)}${SEP}${rest}`, width)];
        return [truncateToWidth(label("cwd", cwd), width), truncateToWidth(rest, width)];
      },
    };
  });
}

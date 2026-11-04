// Compact the context while the student is away, so the next prompt does not wait for a compaction.
// See src/md/features/idle-compact.md.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const IDLE_DEFAULTS = { enabled: true, minutes: 10, percent: 50 };
// The status while the compaction runs. The desktop app reads this key: a new prompt stops the compaction first.
export const IDLE_STATUS = "idle-compact";

export type IdleSettings = typeof IDLE_DEFAULTS;

// "idleCompaction" in settings.json: false, or { enabled, minutes, percent }. A bad value uses the default.
export function idleSettings(raw: unknown): IdleSettings {
  if (raw === false) return { ...IDLE_DEFAULTS, enabled: false };
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number, max: number) => (typeof v === "number" && v > 0 && v <= max ? v : d);
  return {
    enabled: s.enabled !== false,
    minutes: num(s.minutes, IDLE_DEFAULTS.minutes, 24 * 60),
    percent: num(s.percent, IDLE_DEFAULTS.percent, 100),
  };
}

// Errors that are not failures: the student stopped it, or there is nothing to compact.
const QUIET = /cancelled|aborted|Already compacted|Nothing to compact/i;

export function registerIdleCompact(pi: ExtensionAPI) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  function compactIfFull(ctx: ExtensionContext, s: IdleSettings) {
    timer = undefined;
    if (!ctx.isIdle()) return;
    const usage = ctx.getContextUsage();
    if (usage?.percent == null || usage.percent < s.percent) return;
    const before = Math.round(usage.percent);
    ctx.ui.setStatus(IDLE_STATUS, "Compacting while idle...");
    ctx.compact({
      onComplete: (result) => {
        ctx.ui.setStatus(IDLE_STATUS, undefined);
        const after = result.estimatedTokensAfter && usage.contextWindow
          ? ` to ${Math.round((result.estimatedTokensAfter / usage.contextWindow) * 100)}%`
          : "";
        ctx.ui.notify(`Compacted while idle: the context went from ${before}%${after}.`, "info");
      },
      onError: (error) => {
        ctx.ui.setStatus(IDLE_STATUS, undefined);
        if (!QUIET.test(error.message)) ctx.ui.notify(`Idle compaction failed: ${error.message}`, "error");
      },
    });
  }

  // agent_settled: pi does not continue on its own. Start the timer from there.
  pi.on("agent_settled", async (_event, ctx) => {
    stop();
    const s = idleSettings((pi.getSettings() as Record<string, unknown> | undefined)?.idleCompaction);
    if (!s.enabled) return;
    timer = setTimeout(() => compactIfFull(ctx, s), s.minutes * 60_000);
    // The timer does not keep catatui running (for example in print mode).
    timer.unref?.();
  });
  pi.on("input", async () => {
    stop();
    return { action: "continue" };
  });
  pi.on("agent_start", async () => stop());
  // After a session change, the old ctx is stale.
  pi.on("session_shutdown", async () => stop());
}

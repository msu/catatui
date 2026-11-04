// Compaction while idle: the timer, the context limit, and the setting.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { IDLE_DEFAULTS, IDLE_STATUS, idleSettings, registerIdleCompact } from "../src/catatui/idle-compact.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";

test("idleSettings: defaults, false, and bad values", () => {
  assert.deepEqual(idleSettings(undefined), IDLE_DEFAULTS);
  assert.equal(idleSettings(false).enabled, false);
  assert.equal(idleSettings({ enabled: false }).enabled, false);
  assert.deepEqual(idleSettings({ minutes: 3, percent: 70 }), { enabled: true, minutes: 3, percent: 70 });
  assert.deepEqual(idleSettings({ minutes: -1, percent: 500 }), IDLE_DEFAULTS);
  assert.deepEqual(idleSettings("yes"), IDLE_DEFAULTS);
});

function setup(settings: unknown, percent: number | null, opts: { idle?: boolean; error?: string } = {}) {
  const { pi, fire } = fakePi();
  pi.getSettings = () => (settings === undefined ? {} : { idleCompaction: settings });
  registerIdleCompact(pi);
  const f = fakeCtx("/p");
  const calls: number[] = [];
  const ctx: any = {
    ...f.ctx,
    isIdle: () => opts.idle ?? true,
    getContextUsage: () => ({ tokens: percent == null ? null : percent * 1000, contextWindow: 100_000, percent }),
    compact: (o: any) => {
      calls.push(1);
      assert.equal(f.status[IDLE_STATUS], "Compacting while idle...");
      if (opts.error) o.onError(new Error(opts.error));
      else o.onComplete({ summary: "s", firstKeptEntryId: "x", tokensBefore: 60_000, estimatedTokensAfter: 20_000 });
    },
  };
  return { fire, ctx, calls, notices: f.notices, status: f.status };
}

const MIN = 60_000;

test("compacts after 10 minutes idle above 50%, and says so", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup(undefined, 60);
  await s.fire("agent_settled", {}, s.ctx);
  t.mock.timers.tick(10 * MIN - 1);
  assert.equal(s.calls.length, 0);
  t.mock.timers.tick(1);
  assert.equal(s.calls.length, 1);
  assert.equal(s.status[IDLE_STATUS], undefined);
  assert.match(s.notices[0].text, /Compacted while idle: the context went from 60% to 20%/);
});

test("does not compact below the limit, with unknown usage, or when not idle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const s of [setup(undefined, 40), setup(undefined, null), setup(undefined, 90, { idle: false })]) {
    await s.fire("agent_settled", {}, s.ctx);
    t.mock.timers.tick(10 * MIN);
    assert.equal(s.calls.length, 0);
  }
});

test("a new prompt, a new run, or a session change stops the timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const event of ["input", "agent_start", "session_shutdown"]) {
    const s = setup(undefined, 90);
    await s.fire("agent_settled", {}, s.ctx);
    t.mock.timers.tick(5 * MIN);
    await s.fire(event, {}, s.ctx);
    t.mock.timers.tick(10 * MIN);
    assert.equal(s.calls.length, 0, event);
  }
});

test("the setting: off, and other minutes and percent", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const off = setup(false, 90);
  await off.fire("agent_settled", {}, off.ctx);
  t.mock.timers.tick(60 * MIN);
  assert.equal(off.calls.length, 0);
  const custom = setup({ minutes: 2, percent: 30 }, 35);
  await custom.fire("agent_settled", {}, custom.ctx);
  t.mock.timers.tick(2 * MIN);
  assert.equal(custom.calls.length, 1);
});

test("a stopped compaction shows no error; a failure does", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stopped = setup(undefined, 90, { error: "Compaction cancelled" });
  await stopped.fire("agent_settled", {}, stopped.ctx);
  t.mock.timers.tick(10 * MIN);
  assert.equal(stopped.notices.length, 0);
  assert.equal(stopped.status[IDLE_STATUS], undefined);
  const failed = setup(undefined, 90, { error: "network down" });
  await failed.fire("agent_settled", {}, failed.ctx);
  t.mock.timers.tick(10 * MIN);
  assert.deepEqual(failed.notices[0], { text: "Idle compaction failed: network down", level: "error" });
});

// A small stand-in for the pi ExtensionAPI and ExtensionContext, so tests can call the register functions
// and fire events with no model and no network. Methods that a test does not need do nothing.

type Handler = (event: any, ctx: any) => any;

export function fakePi(flags: Record<string, unknown> = {}) {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const api: any = {
    on: (name: string, h: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), h]),
    registerCommand: (name: string, def: any) => commands.set(name, def),
    registerTool: (def: any) => tools.set(def.name, def),
    getFlag: (name: string) => flags[name],
  };
  const pi = new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => undefined) });
  // Fire an event. Like pi, the first handler that returns a result stops the others.
  const fire = async (name: string, event: any, ctx: any) => {
    for (const h of handlers.get(name) ?? []) {
      const r = await h(event, ctx);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  return { pi, fire, handlers, commands, tools };
}

// answers: the replies of ctx.ui.select, in order. asked: the questions and their options.
export function fakeCtx(cwd: string, opts: { hasUI?: boolean; mode?: string; answers?: (string | undefined)[] } = {}) {
  const answers = [...(opts.answers ?? [])];
  const asked: { title: string; options: string[] }[] = [];
  const notices: { text: string; level: string }[] = [];
  const status: Record<string, string | undefined> = {};
  const ctx = {
    cwd,
    hasUI: opts.hasUI ?? true,
    mode: opts.mode ?? "tui",
    isIdle: () => true,
    ui: {
      theme: { fg: (_c: string, t: string) => t, bold: (t: string) => t },
      select: async (title: string, options: string[]) => { asked.push({ title, options }); return answers.shift(); },
      input: async () => answers.shift(),
      notify: (text: string, level: string) => notices.push({ text, level }),
      setStatus: (key: string, text: string | undefined) => { status[key] = text; },
    },
  };
  return { ctx, asked, notices, status };
}

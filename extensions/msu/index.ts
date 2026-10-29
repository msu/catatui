// MSU CatChat extension for pi: CatChat provider with /login, MSU header, /catchat command.

import type { Api, Model } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, getAgentDir, getPackageDir, resolveCliModel, VERSION } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { login, refreshToken } from "./auth.ts";
import { bannerComponent } from "./banner.ts";
import { CATCHAT_API, DEFAULT_MODEL, PREFERRED_MODELS, PROVIDER_ID } from "./config.ts";
import { fetchModels } from "./models.ts";
import { setFooter } from "./footer.ts";
import { registerHttpTool } from "./http.ts";
import { registerPermissions } from "./permissions.ts";

// The catatui command sets this. As a plain pi package, the extension does not change the theme or model.
const WRAPPED = process.env.CATATUI === "1";
const PKG_VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

// After /login, pi selects a model only if its provider has an entry in pi's internal defaultModelPerProvider.
// Without an entry, pi shows "no default model is configured". pi has no public API for this, so add the entry here.
// If a pi update moves the table, the import fails or the check below fails. Then the student uses /model.
async function registerLoginDefault() {
  try {
    const url = pathToFileURL(join(getPackageDir(), "dist/core/model-resolver.js")).href;
    const mod = (await import(url)) as { defaultModelPerProvider?: Record<string, string>; resolveCliModel?: unknown };
    if (mod.resolveCliModel !== resolveCliModel || !mod.defaultModelPerProvider) return;
    mod.defaultModelPerProvider[PROVIDER_ID] = DEFAULT_MODEL;
  } catch {
    // pi changed. Do nothing.
  }
}

export default async function (pi: ExtensionAPI) {
  await registerLoginDefault();
  // In the catatui command, ask before file changes and commands. As a plain pi package, do not change pi's behavior.
  registerHttpTool(pi);
  if (WRAPPED) registerPermissions(pi);

  pi.registerProvider(PROVIDER_ID, {
    name: "MSU CatChat",
    baseUrl: `${CATCHAT_API}/v1`,
    api: "openai-completions",
    oauth: {
      name: "MSU CatChat",
      login,
      refreshToken,
      getApiKey: (cred) => cred.access,
    },
    async refreshModels({ credential, stored, allowNetwork, signal, publish }) {
      const cached = (stored?.models ?? []) as Model<Api>[];
      if (!allowNetwork || credential?.type !== "oauth") return cached;
      const models = await fetchModels(credential.access, signal);
      const full = models.map((m) => ({ ...m, api: "openai-completions", provider: PROVIDER_ID, baseUrl: `${CATCHAT_API}/v1` }));
      await publish({ persist: { models: full as Model<Api>[], checkedAt: Math.floor(Date.now() / 1000) } });
      return models;
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setHeader((tui, theme) => bannerComponent(tui, theme, `${PKG_VERSION} (pi ${VERSION})`));
    if (!WRAPPED) return;
    ctx.ui.setTitle("CataTUI");
    setFooter(pi, ctx);
    await pickDefaultModel(pi, ctx);
  });

  pi.registerCommand("catchat", {
    description: "Show CatChat sign-in status and reload the model list. \"/catchat reset\" signs you out.",
    handler: async (args, ctx) => {
      if (args.trim() === "reset") return reset(ctx);
      const status = ctx.modelRegistry.getProviderAuthStatus(PROVIDER_ID);
      const result = await ctx.modelRegistry.refresh({ providers: [PROVIDER_ID], force: true });
      const err = result.errors.get(PROVIDER_ID);
      const models = ctx.modelRegistry.getAll().filter((m) => m.provider === PROVIDER_ID);
      ctx.ui.notify(
        [
          `CatChat: ${CATCHAT_API}`,
          `Sign-in: ${JSON.stringify(status)}`,
          `Models (${models.length}): ${models.map((m) => m.id).join(", ") || "none"}`,
          err ? `Error: ${err.message}` : "",
          models.length ? "" : "Run /login catchat to sign in.",
        ].filter(Boolean).join("\n"),
        err ? "error" : "info",
      );
    },
  });
}

// Remove the CatChat key, the cached model list, and a saved CatChat default model, then exit.
// pi keeps these in memory, so a restart is necessary.
function reset(ctx: ExtensionContext) {
  const dir = getAgentDir();
  editJson(join(dir, "auth.json"), (d) => delete d[PROVIDER_ID]);
  editJson(join(dir, "models-store.json"), (d) => delete d[PROVIDER_ID]);
  editJson(join(dir, "settings.json"), (d) => {
    if (d.defaultProvider !== PROVIDER_ID) return;
    delete d.defaultProvider;
    delete d.defaultModel;
  });
  ctx.ui.notify("CatChat sign-in removed. Start catatui again to sign in.", "info");
  ctx.shutdown();
}

function editJson(path: string, edit: (data: Record<string, unknown>) => void) {
  if (!existsSync(path)) return;
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  edit(data);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function savedDefaultProvider(): string | undefined {
  const path = join(getAgentDir(), "settings.json");
  if (!existsSync(path)) return undefined;
  return (JSON.parse(readFileSync(path, "utf8")) as { defaultProvider?: string }).defaultProvider;
}

// In the catatui command, start on a CatChat model. If there is none, put the sign-in command in the editor.
// "/login catchat" skips pi's login menus, where extension providers are always listed last.
// If the student saved a CatChat model with /model, keep it. Otherwise use PREFERRED_MODELS.
async function pickDefaultModel(pi: ExtensionAPI, ctx: ExtensionContext) {
  if (savedDefaultProvider() === PROVIDER_ID) return;
  const models = ctx.modelRegistry.getAll().filter((m) => m.provider === PROVIDER_ID);
  if (models.length === 0) {
    ctx.ui.notify("To sign in to CatChat, press Enter.", "info");
    ctx.ui.setEditorText(`/login ${PROVIDER_ID}`);
    return;
  }
  const pick = PREFERRED_MODELS.map((re) => models.find((m) => re.test(m.id))).find(Boolean) ?? models[0];
  await pi.setModel(pick);
}

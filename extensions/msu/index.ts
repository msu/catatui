// MSU CatChat extension for pi: CatChat provider with /login, MSU header, /catchat command.

import type { Api, Model } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, VERSION } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { login, refreshToken } from "./auth.ts";
import { bannerComponent } from "./banner.ts";
import { CATCHAT_API, PREFERRED_MODELS, PROVIDER_ID } from "./config.ts";
import { fetchModels } from "./models.ts";

// The catatui command sets this. As a plain pi package, the extension does not change the theme or model.
const WRAPPED = process.env.CATATUI === "1";
const PKG_VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

export default function (pi: ExtensionAPI) {
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
    ctx.ui.setTitle("CatChat");
    await pickDefaultModel(pi, ctx);
  });

  pi.registerCommand("catchat", {
    description: "Show CatChat sign-in status and reload the CatChat model list",
    handler: async (_args, ctx) => {
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

// In the catatui command, start on a CatChat model. Tell the student to sign in if there is none.
async function pickDefaultModel(pi: ExtensionAPI, ctx: ExtensionContext) {
  if (ctx.model?.provider === PROVIDER_ID) return;
  const models = ctx.modelRegistry.getAll().filter((m) => m.provider === PROVIDER_ID);
  if (models.length === 0) {
    ctx.ui.notify("You are not signed in to CatChat. Type /login, then select MSU CatChat.", "warning");
    return;
  }
  const pick = PREFERRED_MODELS.map((re) => models.find((m) => re.test(m.id))).find(Boolean) ?? models[0];
  await pi.setModel(pick);
}

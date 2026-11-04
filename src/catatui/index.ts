// MSU CatChat extension for pi: CatChat provider with /login, MSU header, /catchat command.

import type { Api, Model } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, getPackageDir, resolveCliModel, VERSION } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { login, refreshToken } from "./auth.ts";
import { bannerComponent } from "./banner.ts";
import { registerContext } from "./context.ts";
import { registerDocumentTools } from "./documents.ts";
import { registerExcelTools } from "./excel.ts";
import { registerHelp } from "./help.ts";
import { registerMsu } from "./msu.ts";
import { registerNewProject } from "./project.ts";
import { registerWidget } from "./widget.ts";
import { registerPreview } from "./preview.ts";
import { registerAdvising } from "./advising.ts";
import { registerClasses } from "./classes.ts";
import { CATCHAT_API, DEFAULT_MODEL, PREFERRED_MODELS, PROVIDER_ID } from "./config.ts";
import { fetchModels } from "./models.ts";
import { setFooter } from "./footer.ts";
import { clearSignIn, expiryDays, readCredential, savedDefaultProvider } from "./store.ts";
import { registerHttpTool } from "./http.ts";
import { registerPermissions } from "./permissions.ts";
import { registerSandbox } from "./sandbox.ts";
import { registerSte } from "./ste.ts";
import { registerUndo } from "./undo.ts";
import { registerWebTools } from "./web.ts";

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
  // In the catatui command, keep the agent in the project folder and ask before file changes and commands.
  // As a plain pi package, do not change pi's behavior.
  // The sandbox comes first, so a blocked call does not ask the student. Undo comes last, so it sees only allowed calls.
  registerHttpTool(pi);
  registerExcelTools(pi);
  registerDocumentTools(pi);
  registerWebTools(pi);
  if (WRAPPED) {
    registerSandbox(pi);
    registerPermissions(pi);
    registerSte(pi);
  }
  registerUndo(pi);
  registerContext(pi);
  registerHelp(pi);
  registerMsu(pi);
  registerNewProject(pi);
  registerWidget(pi);
  registerPreview(pi);
  // The desktop app starts catatui with this in the advising folder.
  if (process.env.CATATUI_ADVISING === "1") registerAdvising(pi);
  // Classes (the overview) and a class chat. The desktop app sets these in the classes folders.
  if (process.env.CATATUI_CLASSES === "1") registerClasses(pi);
  if (process.env.CATATUI_CLASS) registerClasses(pi, process.env.CATATUI_CLASS);

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
    // RPC mode (the desktop app): pi does not load the CatChat models at start. Load them and pick a model.
    // The desktop app shows its own sign-in, so do not type "/login catchat" here.
    if (WRAPPED && ctx.mode === "rpc") {
      if (!readCredential()) return;
      await ctx.modelRegistry.refresh({ providers: [PROVIDER_ID], force: true });
      if (ctx.model?.provider !== PROVIDER_ID) await pickModel(pi, ctx);
      return;
    }
    if (ctx.mode !== "tui") return;
    ctx.ui.setHeader((tui, theme) => bannerComponent(tui, theme, `${PKG_VERSION} (pi ${VERSION})`));
    if (!WRAPPED) return;
    ctx.ui.setTitle("catatui");
    setFooter(pi, ctx);
    await pickDefaultModel(pi, ctx);
    warnExpiry(ctx);
  });

  // After the sign-in, pi selects a CatChat model. Remove the "/login catchat" text that pickDefaultModel typed.
  pi.on("model_select", async (event, ctx) => {
    if (!WRAPPED || !ctx.hasUI || event.model.provider !== PROVIDER_ID) return;
    if (ctx.ui.getEditorText().trim() === `/login ${PROVIDER_ID}`) ctx.ui.setEditorText("");
  });

  // Before the sign-in, pi answers a prompt with "No API key found ..." and links to pi docs.
  // Show the next step in its place, and type "/login catchat" so Enter opens the sign-in.
  pi.on("input", async (event, ctx) => {
    if (!WRAPPED || !ctx.hasUI || event.source !== "interactive") return { action: "continue" };
    if (ctx.model && ctx.modelRegistry.hasConfiguredAuth(ctx.model)) return { action: "continue" };
    ctx.ui.notify(ctx.ui.theme.fg("warning", "Sign in to CatChat first. To open the sign-in, press Enter."), "info");
    ctx.ui.setEditorText(`/login ${PROVIDER_ID}`);
    return { action: "handled" };
  });

  pi.registerCommand("catchat", {
    description: "Show CatChat sign-in status. \"/catchat login\" gets a new key. \"/catchat logout\" signs you out.",
    getArgumentCompletions: (prefix) =>
      ["login", "logout"].filter((a) => a.startsWith(prefix)).map((a) => ({ value: a, label: a })),
    handler: async (args, ctx) => {
      const arg = args.trim();
      // "reset" is the old name of "logout". Keep it for old docs.
      if (arg === "logout" || arg === "reset") return logout(ctx);
      if (arg === "login") {
        // pi has no public API to open the sign-in, so type the command for the student.
        ctx.ui.setEditorText(`/login ${PROVIDER_ID}`);
        return ctx.ui.notify("To open the sign-in, press Enter.", "info");
      }
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
          models.length ? "" : "Run /catchat login to sign in.",
        ].filter(Boolean).join("\n"),
        err ? "error" : "info",
      );
    },
  });
}

// Remove the sign-in (store.ts), then exit. pi keeps the sign-in in memory, so a restart is necessary.
function logout(ctx: ExtensionContext) {
  clearSignIn();
  ctx.ui.notify("CatChat sign-in removed. Start catatui again to sign in.", "info");
  ctx.shutdown();
}

function warnExpiry(ctx: ExtensionContext) {
  const days = expiryDays();
  if (days === undefined) return;
  const text = days <= 0
    ? "Your CatChat key expired. Run /catchat login to get a new key."
    : `Your CatChat key expires in ${days} day${days === 1 ? "" : "s"}. Run /catchat login to get a new key.`;
  ctx.ui.notify(ctx.ui.theme.fg("warning", text), "info");
}

// In the catatui command, start on a CatChat model. If there is none, put the sign-in command in the editor.
// "/login catchat" skips pi's login menus, where extension providers are always listed last.
// If the student saved a CatChat model with /model, keep it. Otherwise use PREFERRED_MODELS.
async function pickDefaultModel(pi: ExtensionAPI, ctx: ExtensionContext) {
  if (savedDefaultProvider() === PROVIDER_ID) return;
  const models = ctx.modelRegistry.getAll().filter((m) => m.provider === PROVIDER_ID);
  if (models.length === 0) {
    // bin/catatui.js opens the sign-in at start. If the student closes it, Enter opens it again.
    // An "info" notice is gray. The warning color makes it easy to see, with no "Warning:" prefix.
    ctx.ui.notify(ctx.ui.theme.fg("warning", "Sign in to CatChat to start. To open the sign-in again, press Enter."), "info");
    ctx.ui.setEditorText(`/login ${PROVIDER_ID}`);
    return;
  }
  await pickModel(pi, ctx);
}

// Select the first CatChat model in PREFERRED_MODELS, or the first CatChat model.
async function pickModel(pi: ExtensionAPI, ctx: ExtensionContext) {
  const models = ctx.modelRegistry.getAll().filter((m) => m.provider === PROVIDER_ID);
  const pick = PREFERRED_MODELS.map((re) => models.find((m) => re.test(m.id))).find(Boolean) ?? models[0];
  if (pick) await pi.setModel(pick);
}

// Suggestions in the terminal message box: the rest of the message in gray after the cursor. Tab accepts it,
// Escape hides it. The request and the setting are in suggest.ts. See src/md/features/suggest.md.
//
// pi lets one custom editor be active. This editor extends pi's CustomEditor, so the app keys (Escape to stop,
// Ctrl+D, model keys) and the file and /command autocomplete work as before.

import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type EditorTheme, matchesKey, renderFakeCursor, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readCredential } from "./store.ts";
import { fetchSuggestion, SUGGEST_DELAY_MS, suggestOn, wantsSuggestion } from "./suggest.ts";
import { writeSetting } from "./settings.ts";

// The fake cursor at the end of the text: Editor.render draws it as a highlighted space.
const END_CURSOR = renderFakeCursor(" ");
const LABEL = "  tab";

export class SuggestEditor extends CustomEditor {
  hint = "";
  private seen = "";
  private timer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private dim: (s: string) => string;
  private context: () => string | undefined;
  private suggest: typeof fetchSuggestion;

  // suggest: the request. A test can give a fake one.
  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager,
    dim: (s: string) => string, context: () => string | undefined, suggest: typeof fetchSuggestion = fetchSuggestion) {
    super(tui, theme, keybindings);
    this.dim = dim;
    this.context = context;
    this.suggest = suggest;
  }

  // Only when the cursor is at the end of the text.
  private atEnd() {
    const lines = this.getLines();
    const c = this.getCursor();
    return c.line === lines.length - 1 && c.col === lines[lines.length - 1].length;
  }

  private schedule(text: string) {
    if (this.timer) clearTimeout(this.timer);
    this.abort?.abort();
    this.timer = undefined;
    if (!wantsSuggestion(text) || !this.atEnd() || !suggestOn()) return;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      const key = readCredential()?.access;
      if (!key) return;
      const ac = (this.abort = new AbortController());
      const hint = (await this.suggest(text, this.context(), key, ac.signal)).replace(/[\x00-\x1f\x7f]/g, "");
      if (ac.signal.aborted || !hint || this.getText() !== text || !this.atEnd()) return;
      this.hint = hint;
      this.tui.requestRender();
    }, SUGGEST_DELAY_MS);
    this.timer.unref?.();
  }

  handleInput(data: string): void {
    if (this.hint && !this.isShowingAutocomplete()) {
      if (matchesKey(data, "tab")) {
        const hint = this.hint;
        this.hint = "";
        this.insertTextAtCursor(hint);
        return;
      }
      if (matchesKey(data, "escape")) {
        this.hint = "";
        this.tui.requestRender();
        return;
      }
    }
    super.handleInput(data);
  }

  // render runs after each change. A new text removes the old suggestion and starts the timer again.
  render(width: number): string[] {
    const text = this.getText();
    if (text !== this.seen) {
      this.seen = text;
      this.hint = "";
      this.schedule(text);
    }
    const lines = super.render(width);
    if (!this.hint || !this.atEnd() || this.isShowingAutocomplete()) return lines;
    // The cursor line: the text, the cursor, then only spaces (the padding). Put the suggestion in the spaces,
    // but not in the right padding. The suggestion shows on one line only; a long one is cut.
    const i = lines.findIndex((l) => l.includes(END_CURSOR));
    if (i < 0) return lines;
    const at = lines[i].lastIndexOf(END_CURSOR) + END_CURSOR.length;
    const tail = lines[i].slice(at);
    if (/[^ ]/.test(tail)) return lines;
    const room = tail.length - this.getPaddingX();
    if (room < 2) return lines;
    const shown = truncateToWidth(this.hint, room, "") + (visibleWidth(this.hint) + LABEL.length <= room ? LABEL : "");
    lines[i] = lines[i].slice(0, at) + this.dim(shown) + " ".repeat(tail.length - visibleWidth(shown));
    return lines;
  }
}

// The text of the last answer, for the request (the student often answers it).
function answerText(message: unknown): string | undefined {
  const m = message as { role?: string; content?: unknown };
  if (m?.role !== "assistant" || !Array.isArray(m.content)) return undefined;
  const text = m.content.filter((p: any) => p?.type === "text").map((p: any) => p.text).join("\n").trim();
  return text || undefined;
}

export function registerSuggest(pi: ExtensionAPI) {
  let lastAnswer: string | undefined;
  pi.on("message_end", async (event) => {
    lastAnswer = answerText(event.message) ?? lastAnswer;
  });
  // Only the terminal. The desktop app has its own message box (desktop/main.js uses suggest.ts).
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const dim = (s: string) => ctx.ui.theme.fg("dim", s);
    ctx.ui.setEditorComponent((tui, theme, keybindings) => new SuggestEditor(tui, theme, keybindings, dim, () => lastAnswer));
  });

  pi.registerCommand("suggest", {
    description: "Turn the suggestions in the message box on or off (Tab accepts a suggestion)",
    getArgumentCompletions: (prefix: string) => ["on", "off"].filter((w) => w.startsWith(prefix.trim())).map((w) => ({ value: w, label: w })),
    handler: async (args, ctx) => {
      const want = args.trim();
      if (want !== "on" && want !== "off") {
        return ctx.ui.notify(`Suggestions are ${suggestOn() ? "on" : "off"}. Type /suggest on or /suggest off to change.`, "info");
      }
      writeSetting("suggest", want === "on");
      ctx.ui.notify(`Suggestions are ${want}.`, "info");
    },
  });
}

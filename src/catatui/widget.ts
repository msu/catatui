// "show_widget" tool: the model shows a small interactive widget inline in the chat (desktop app), and gets the answer.
// - Built-in types: choice, multi, text, slider, form, quiz (interactive), chart and table (display only).
//   The app draws them with its own components, so the model writes no HTML or JavaScript.
// - "html": the model writes a small page. The app shows it in a sandboxed frame with no network and no app access.
//   The page sends its answer with catai.submit(data).
// How it gets to the app: an interactive widget is an input dialog whose title is "[widget] <JSON>". The app draws
// it inline, and the answer (JSON) comes back as the input value. A display-only widget is a notice "[widget] <JSON>".
// In the terminal (no app), choice and text use the normal select and input dialogs. Other types need the app.
// See src/md/features/widgets.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const WIDGET_PREFIX = "[widget] ";
const DISPLAY_ONLY = ["chart", "table"];

const FIELD = Type.Object({
  name: Type.String({ description: "Key in the answer" }),
  label: Type.String(),
  kind: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("number"), Type.Literal("choice"), Type.Literal("date"), Type.Literal("checkbox")])),
  options: Type.Optional(Type.Array(Type.String(), { description: "For kind choice" })),
});

const QUESTION = Type.Object({
  question: Type.String(),
  options: Type.Array(Type.String()),
  answer: Type.Number({ description: "Index of the correct option (0 is the first)" }),
  explain: Type.Optional(Type.String({ description: "Shown after the student answers" })),
});

const PARAMS = Type.Object({
  type: Type.Union(
    ["choice", "multi", "text", "slider", "form", "quiz", "chart", "table", "html"].map((t) => Type.Literal(t)),
    { description: "choice: pick one. multi: pick some. text: type an answer. slider: a number. form: some fields. quiz: questions with a correct answer. chart and table: show data (no answer). html: your own small page (last choice)." },
  ),
  title: Type.String({ description: "The question or the heading" }),
  options: Type.Optional(Type.Array(Type.String(), { description: "For choice and multi" })),
  placeholder: Type.Optional(Type.String({ description: "For text" })),
  multiline: Type.Optional(Type.Boolean({ description: "For text" })),
  min: Type.Optional(Type.Number()), max: Type.Optional(Type.Number()), step: Type.Optional(Type.Number()),
  value: Type.Optional(Type.Number({ description: "For slider: the start value" })),
  unit: Type.Optional(Type.String({ description: "For slider, for example hours" })),
  fields: Type.Optional(Type.Array(FIELD, { description: "For form" })),
  questions: Type.Optional(Type.Array(QUESTION, { description: "For quiz" })),
  chart_type: Type.Optional(Type.Union([Type.Literal("bar"), Type.Literal("line"), Type.Literal("pie")])),
  labels: Type.Optional(Type.Array(Type.String(), { description: "For chart: the x labels or pie slices" })),
  series: Type.Optional(Type.Array(Type.Object({ name: Type.String(), values: Type.Array(Type.Number()) }), { description: "For chart" })),
  columns: Type.Optional(Type.Array(Type.String(), { description: "For table" })),
  rows: Type.Optional(Type.Array(Type.Array(Type.Union([Type.String(), Type.Number()])), { description: "For table" })),
  html: Type.Optional(Type.String({ description: "For html: a small page. Call catai.submit(data) to send the answer. No network access." })),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export function registerWidget(pi: ExtensionAPI) {
  pi.registerTool({
    name: "show_widget",
    label: "Widget",
    description:
      "Show a small widget inline in the chat and get the student's answer: a choice, a form, a slider, a quiz, or show a chart or a table. " +
      "Use the built-in types. Use html only when no built-in type fits. Charts and tables only show data and return at once.",
    promptSnippet: "Show an inline widget in the chat (choice, form, slider, quiz, chart, table) and get the answer",
    promptGuidelines: [
      "Use show_widget when a click is easier than typing: to let the student pick from options, fill in a few values, take a short quiz, or see data as a chart or table. Do not use it for normal answers.",
      "After a quiz, give short feedback on the answers.",
    ],
    parameters: PARAMS,
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) return text("There is no screen to show the widget. Ask the student in text.");
      const spec = JSON.stringify(params);
      if (DISPLAY_ONLY.includes(params.type)) {
        if (ctx.mode === "rpc") {
          ctx.ui.notify(`${WIDGET_PREFIX}${spec}`, "info");
          return text(`The ${params.type} is shown in the chat.`);
        }
        return text(`The terminal cannot show a ${params.type}. Show the data as a Markdown table, or use show_page.`);
      }
      if (ctx.mode !== "rpc") {
        // The terminal: only the simple types.
        if (params.type === "choice" && params.options?.length) {
          const pick = await ctx.ui.select(params.title, params.options, { signal });
          return text(pick === undefined ? "The student did not answer." : `The student picked: ${pick}`);
        }
        if (params.type === "text") {
          const t = await ctx.ui.input(params.title, params.placeholder, { signal });
          return text(t === undefined ? "The student did not answer." : `The student wrote: ${t}`);
        }
        return text(`The terminal cannot show a ${params.type} widget. Ask the student in text, or use show_page.`);
      }
      const answer = await ctx.ui.input(`${WIDGET_PREFIX}${spec}`, undefined, { signal });
      if (answer === undefined) return text("The student closed the widget without an answer.");
      return text(`The student answered: ${answer}`);
    },
  });
}

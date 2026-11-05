// "show_widget" tool: the model shows a small interactive widget inline in the chat (desktop app), and gets the answer.
// - Built-in types: choice, multi, text, slider, form, quiz (interactive), chart and table (display only).
//   The app draws them with its own components, so the model writes no HTML or JavaScript.
// - "html": the model writes a small page. The app shows it in a sandboxed frame with no network and no app access.
//   The page sends its answer with catai.submit(data).
// How it gets to the app: an interactive widget is an input dialog whose title is "[widget] <JSON>". The app draws
// it inline, and the answer (JSON) comes back as the input value. A display-only widget is a notice "[widget] <JSON>".
// In the terminal (no app), choice and text use the normal select and input dialogs. Other types need the app.
// An html widget with wait false (for example a game or an animation) does not wait for an answer. It stays in the chat.
// In the app, the system prompt tells the model that the chat can show widgets, so it does not say "the chat shows only text".
// See src/md/features/widgets.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const WIDGET_PREFIX = "[widget] ";
const DISPLAY_ONLY = ["chart", "table"];
const displayOnly = (p: { type: string; wait?: boolean }) => DISPLAY_ONLY.includes(p.type) || (p.type === "html" && p.wait === false);

// The app areas Advising and Classes have mock data. The app shows them only with --demo-mode (CATAI_DEMO=1).
const DEMO_AREAS = `- The app has areas with data that this chat does not have (mock data for a demo):
  - Advising: the student's transcript, GPA, degree requirements, next semester's classes, and "send a plan to the advisor".
  - Classes: all classes this term with grades, assignments, due dates, and term dates, and one chat for each class (syllabus, lecture notes, study help).
  - Projects: a folder of files to work on (use new_project for a new one).
  If the student asks about grades, the transcript, requirements, classes, assignments, or due dates, use open_view to offer a button to the right area. Do not say that you cannot help, and do not ask for a file.
`;

const appPrompt = () => `The student uses the catai desktop app. The chat shows Markdown and inline widgets from show_widget.
- show_widget type html shows your own page (HTML, CSS, and JavaScript) inside the chat. It can be a game, a simulation, an animation, or a visual explanation. Keyboard and mouse input work in it.
- For a page that does not send an answer (for example a game), set wait to false. Then the tool returns at once and the page stays in the chat.
- If the student asks for something interactive "here" or "in the chat", use show_widget. Use show_page only if the student wants a browser tab.
- Do not say that the chat can show only text.
${process.env.CATAI_DEMO === "1" ? DEMO_AREAS : "- For a new folder of files to work on, use new_project.\n"}- The student changes the permissions (ask, plan, auto, yolo) and the options (Teaching assistant, Sandbox, Simple English) with the model button at the bottom right of the app. Tell the student to use that button. Do not tell the student to type /mode.`;

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
    { description: "choice: pick one. multi: pick some. text: type an answer. slider: a number. form: some fields. quiz: questions with a correct answer. chart and table: show data (no answer). html: your own page, for games, simulations, and anything that the other types cannot do." },
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
  html: Type.Optional(Type.String({ description: "For html: a self-contained page (inline CSS and JavaScript, no network). Call catai.submit(data) to send an answer. Keep it at most 600 pixels high." })),
  wait: Type.Optional(Type.Boolean({ description: "For html: false if the page sends no answer (a game, an animation). Default true." })),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export function registerWidget(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    if (ctx.mode !== "rpc") return;
    event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, "catai-app": appPrompt() };
  });

  pi.registerTool({
    name: "show_widget",
    label: "Widget",
    description:
      "Show a widget inline in the chat: a choice, a form, a slider, a quiz, a chart, a table, or your own HTML page (for example a game). " +
      "Use a built-in type when one fits. Charts, tables, and html with wait false return at once. The other types wait for the student's answer.",
    promptSnippet: "Show an inline widget in the chat (choice, form, slider, quiz, chart, table, or an HTML page such as a game)",
    promptGuidelines: [
      "Use show_widget when a click is easier than typing: to let the student pick from options, fill in a few values, take a short quiz, or see data as a chart or table. Do not use it for normal answers.",
      "After a quiz, give short feedback on the answers.",
      "Make or offer a quiz only when the student asks to practice, study, or check what they know. Do not end other answers with an offer of a quiz.",
    ],
    parameters: PARAMS,
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) return text("There is no screen to show the widget. Ask the student in text.");
      const spec = JSON.stringify(params);
      if (displayOnly(params)) {
        if (ctx.mode === "rpc") {
          ctx.ui.notify(`${WIDGET_PREFIX}${spec}`, "info");
          return text(params.type === "html" ? "The page is shown in the chat. The student can use it now." : `The ${params.type} is shown in the chat.`);
        }
        if (params.type === "html") return text("The terminal cannot show a page in the chat. Use show_page to open it in the browser.");
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

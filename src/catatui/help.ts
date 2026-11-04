// "/help": what catatui can do, with example prompts. The header shows one example as a tip at each start.
// Keep this list in step with the tools and commands. See src/md/features/help.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Example prompts. Short, so one fits on the header line.
export const TIPS = [
  "Explain what this project does",
  "Find the bug in main.py and give me a hint",
  "Read syllabus.pdf and list the due dates",
  "Quiz me on recursion in the browser",
  "Make budget.xlsx with a total row",
  "Summarize report.docx in five bullets",
  "Write my notes as a Word file, notes.docx",
  "Start my web app and check that / works",
  "Write a plan to add a login page",
  "What does this error message mean?",
];

export const tip = () => TIPS[Math.floor(Math.random() * TIPS.length)];

const HELP = `catatui is a coding agent. Type what you want in plain words, then press Enter.

What it can do
  Code           read, explain, write, and fix code; run commands and tests
  Excel          read and write .xlsx files            "Make budget.xlsx with a total row"
  PDF            read PDF files                        "Read syllabus.pdf and list the due dates"
  Word           read and write .docx files            "Summarize report.docx in five bullets"
  Quizzes        a quiz, form, or chart in the chat    "Quiz me on recursion"
  Web servers    run your app and test it              "Start my web app and check that / works"
  Web pages      read docs and call APIs               "Read the docs at https://... and explain X"
  New projects   make a folder for a new task          "I want to plan my semester"

Commands
  /mode          ask, plan, or yolo mode; ta (teaching assistant), sandbox, and ste options
  /undo          put back the files the agent changed in your last request
  /model         pick a CatChat model
  /context       show how full the context window is
  /catchat       sign-in status (/catchat login, /catchat logout)
  /hotkeys       keyboard keys
  /new           start a new conversation

Keys
  Escape         stop the agent
  Ctrl+C twice   quit

Tips
  Turn on ta in /mode to get hints and explanations, not answers.
  Use git. /undo does not undo what commands did.
  More: https://catatui.cs.montana.edu`;

export function registerHelp(pi: ExtensionAPI) {
  pi.registerCommand("help", {
    description: "Show what catatui can do, with example prompts",
    handler: async (_args, ctx) => ctx.ui.notify(HELP, "info"),
  });
}

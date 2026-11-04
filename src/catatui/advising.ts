// Advising: catatui acts as an MSU academic advisor. The desktop app has one advising session, in
// Documents/catai/Advising. The app starts catatui there with CATATUI_ADVISING=1.
// The tools use MOCK data (a made-up student, made-up sections). This is a demo of the idea, not a real degree audit.
// The course names and the requirements look like MSU Computer Science, but they are not the official catalog.
// A real version would read the student's data from MSU systems (Banner, DegreeWorks) with the student's permission.
// See src/md/features/advising.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { WIDGET_PREFIX } from "./widget.ts";

type Grade = "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D+" | "D" | "F" | "IP";
type Taken = { term: string; course: string; title: string; credits: number; grade: Grade; core?: string };

const STUDENT = {
  name: "Alex Rivera (mock student)",
  id: "-12345678",
  major: "Computer Science, BS",
  catalog: "2024-2025",
  advisor: "Dr. Sam Lee (mock)",
  current_term: "Fall 2026",
  next_term: "Spring 2027",
  registration_opens: "November 10, 2026 (mock date)",
};

const TRANSCRIPT: Taken[] = [
  { term: "Fall 2024", course: "CSCI 127", title: "Joy and Beauty of Data", credits: 4, grade: "A" },
  { term: "Fall 2024", course: "M 171", title: "Calculus I", credits: 4, grade: "B+" },
  { term: "Fall 2024", course: "WRIT 101", title: "College Writing I", credits: 3, grade: "A-", core: "W" },
  { term: "Fall 2024", course: "COMX 111", title: "Introduction to Public Communication", credits: 3, grade: "B", core: "US" },
  { term: "Spring 2025", course: "CSCI 132", title: "Basic Data Structures and Algorithms", credits: 4, grade: "A-" },
  { term: "Spring 2025", course: "M 172", title: "Calculus II", credits: 4, grade: "C+" },
  { term: "Spring 2025", course: "CSCI 112", title: "Programming with C", credits: 3, grade: "B+" },
  { term: "Spring 2025", course: "PSYX 100", title: "Introduction to Psychology", credits: 3, grade: "A", core: "IS" },
  { term: "Fall 2025", course: "CSCI 232", title: "Data Structures and Algorithms", credits: 4, grade: "B" },
  { term: "Fall 2025", course: "CSCI 246", title: "Discrete Structures", credits: 3, grade: "B+" },
  { term: "Fall 2025", course: "PHSX 220", title: "Physics I", credits: 4, grade: "C" },
  { term: "Fall 2025", course: "ARTZ 105", title: "Visual Language: Drawing", credits: 3, grade: "A", core: "IA" },
  { term: "Spring 2026", course: "CSCI 215", title: "Social and Ethical Issues in Computer Science", credits: 3, grade: "A", core: "CS" },
  { term: "Spring 2026", course: "CSCI 366", title: "Computer Systems", credits: 4, grade: "B-" },
  { term: "Spring 2026", course: "M 221", title: "Introduction to Linear Algebra", credits: 3, grade: "D" },
  { term: "Spring 2026", course: "STAT 332", title: "Statistics for Scientists and Engineers", credits: 3, grade: "B" },
  { term: "Fall 2026", course: "CSCI 305", title: "Concepts of Programming Languages", credits: 3, grade: "IP" },
  { term: "Fall 2026", course: "CSCI 338", title: "Computer Science Theory", credits: 3, grade: "IP" },
  { term: "Fall 2026", course: "M 221", title: "Introduction to Linear Algebra (repeat)", credits: 3, grade: "IP" },
  { term: "Fall 2026", course: "PHSX 222", title: "Physics II", credits: 4, grade: "IP" },
];

const POINTS: Record<string, number> = { A: 4, "A-": 3.67, "B+": 3.33, B: 3, "B-": 2.67, "C+": 2.33, C: 2, "C-": 1.67, "D+": 1.33, D: 1, F: 0 };
// Major and math courses need C- or better.
const PASS = (g: Grade) => g !== "IP" && POINTS[g] >= POINTS["C-"];

// The mock degree requirements. "any" is a list of choices; "credits" is how many credits from the choices.
type Req = { group: string; name: string; any: string[]; credits?: number };
const REQUIREMENTS: Req[] = [
  ...["CSCI 127", "CSCI 132", "CSCI 112", "CSCI 215", "CSCI 232", "CSCI 246", "CSCI 305", "CSCI 338", "CSCI 366", "CSCI 460", "CSCI 468", "CSCI 482R", "CSCI 483R"]
    .map((c) => ({ group: "Computer Science core", name: c, any: [c] })),
  { group: "Computer Science electives", name: "12 credits of CSCI 4xx electives", any: ["CSCI 440", "CSCI 446", "CSCI 447", "CSCI 451", "CSCI 466", "CSCI 476"], credits: 12 },
  ...["M 171", "M 172", "M 221", "STAT 332"].map((c) => ({ group: "Mathematics", name: c, any: [c] })),
  { group: "Science", name: "Physics sequence", any: ["PHSX 220", "PHSX 222"], credits: 8 },
  ...[["W", "College Writing"], ["US", "University Seminar or Public Communication"], ["IA", "Inquiry Arts"], ["IH", "Inquiry Humanities"],
    ["IS", "Inquiry Social Sciences"], ["D", "Diversity"], ["CS", "Contemporary Issues in Science"], ["R", "Research and Creative Experience"]]
    .map(([code, name]) => ({ group: "Core 2.0", name: `${name} (${code})`, any: [`core:${code}`] })),
];
const TOTAL_CREDITS = 120;
const UPPER_DIVISION_CREDITS = 42;

type Section = { course: string; title: string; credits: number; days: string; time: string; seats: number; prereq: string[]; core?: string };
const SPRING_2027: Section[] = [
  { course: "CSCI 460", title: "Operating Systems", credits: 3, days: "MWF", time: "10:00-10:50", seats: 18, prereq: ["CSCI 366"] },
  { course: "CSCI 468", title: "Compilers", credits: 3, days: "TR", time: "12:15-13:30", seats: 22, prereq: ["CSCI 305", "CSCI 338"] },
  { course: "CSCI 440", title: "Database Systems", credits: 3, days: "TR", time: "09:25-10:40", seats: 6, prereq: ["CSCI 232"] },
  { course: "CSCI 446", title: "Artificial Intelligence", credits: 3, days: "MWF", time: "13:10-14:00", seats: 30, prereq: ["CSCI 232", "STAT 332"] },
  { course: "CSCI 476", title: "Computer Security", credits: 3, days: "TR", time: "15:05-16:20", seats: 0, prereq: ["CSCI 366"] },
  { course: "CSCI 482R", title: "Senior Capstone I", credits: 3, days: "MW", time: "14:10-15:25", seats: 25, prereq: ["CSCI 305", "CSCI 338", "CSCI 366"] },
  { course: "M 221", title: "Introduction to Linear Algebra", credits: 3, days: "MWF", time: "08:00-08:50", seats: 40, prereq: ["M 172"] },
  { course: "HSTA 101", title: "American History I", credits: 3, days: "TR", time: "10:50-12:05", seats: 55, prereq: [], core: "IH, D" },
  { course: "NASX 105", title: "Introduction to Native American Studies", credits: 3, days: "MWF", time: "11:00-11:50", seats: 12, prereq: [], core: "IS, D" },
  { course: "PHL 101", title: "Introduction to Philosophy", credits: 3, days: "TR", time: "13:40-14:55", seats: 35, prereq: [], core: "IH" },
];

// Course titles for the plan card: next term's classes, the transcript, and the other requirement courses.
const TITLES: Record<string, string> = {
  "CSCI 483R": "Senior Capstone II", "CSCI 447": "Machine Learning", "CSCI 451": "Computer Graphics", "CSCI 466": "Networks",
  ...Object.fromEntries(TRANSCRIPT.map((t) => [t.course, t.title.replace(/ \(repeat\)$/, "")])),
  ...Object.fromEntries(SPRING_2027.map((s) => [s.course, s.title])),
};

const passed = (course: string) => TRANSCRIPT.some((t) => t.course === course && PASS(t.grade));
const inProgress = (course: string) => TRANSCRIPT.some((t) => t.course === course && t.grade === "IP");

function gpa() {
  // A repeated course: only the last grade counts (mock rule).
  const last = new Map<string, Taken>();
  for (const t of TRANSCRIPT) if (t.grade !== "IP") last.set(t.course, t);
  let pts = 0;
  let cr = 0;
  for (const t of last.values()) { pts += POINTS[t.grade] * t.credits; cr += t.credits; }
  return { gpa: Math.round((pts / cr) * 100) / 100, graded_credits: cr };
}

function earnedCredits() {
  const done = new Map<string, Taken>();
  for (const t of TRANSCRIPT) if (t.grade !== "IP" && t.grade !== "F") done.set(t.course, t);
  const all = [...done.values()];
  const upper = all.filter((t) => Number(t.course.match(/\d+/)?.[0] ?? 0) >= 300);
  return { earned: all.reduce((a, t) => a + t.credits, 0), upper_division: upper.reduce((a, t) => a + t.credits, 0) };
}

function requirementStatus() {
  return REQUIREMENTS.map((r) => {
    if (r.any[0].startsWith("core:")) {
      const code = r.any[0].slice(5);
      const t = TRANSCRIPT.find((x) => x.core === code && x.grade !== "IP" && x.grade !== "F");
      return { ...r, status: t ? "complete" : "needed", by: t?.course };
    }
    if (r.credits) {
      const done = r.any.filter(passed);
      const ip = r.any.filter(inProgress);
      const cr = (list: string[]) => list.reduce((a, c) => a + (TRANSCRIPT.find((t) => t.course === c)?.credits ?? 0), 0);
      const have = cr(done);
      return { ...r, status: have >= r.credits ? "complete" : have + cr(ip) >= r.credits ? "in progress" : "needed", by: [...done, ...ip].join(", ") || undefined, credits_done: have };
    }
    const c = r.any[0];
    const below = TRANSCRIPT.find((t) => t.course === c && t.grade !== "IP" && !PASS(t.grade));
    const status = passed(c) ? "complete" : inProgress(c) ? "in progress" : "needed";
    return { ...r, status, note: below && status !== "complete" ? `Earlier grade ${below.grade} is below C-.${status === "in progress" ? " The repeat is in progress now. Do not plan it again." : ""}` : undefined };
  });
}

const MOCK_NOTE = "MOCK DATA for a demo. It is not the student's real record and not the official MSU catalog.";
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: `${MOCK_NOTE}\n${JSON.stringify(data, null, 1)}` }], details: {} });

const ADVISOR_PROMPT = `# Academic advising

You are an academic advisor at Montana State University. You help this student plan their degree.
- Use advising_transcript, advising_requirements, and advising_classes to get the facts. Do not guess grades, requirements, or class times.
- The data is mock data for a demo. Say this once, at the start of the conversation.
- Check prerequisites before you suggest a class. Major and math courses need a grade of C- or better.
- Make a plan that the student can do: about 15 credits each semester, with the prerequisites in the right order.
- Show plans and schedules as Markdown tables, or with show_widget (type table).
- Be warm and direct. Ask about the student's goals (internships, graduate school, interests) when it helps the plan.
- For official decisions (substitutions, petitions, graduation checks, overrides), send the student to their advisor, ${STUDENT.advisor}.
- When the student agrees on a plan, offer to send it to the advisor with advising_submit_plan. The student must approve it first.`;

export function registerAdvising(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, "academic-advising": ADVISOR_PROMPT };
  });

  // Send a plan to the advisor (MOCK). The student always approves first, also in yolo mode.
  // The mock saves the plan as Markdown in the advising folder, in "Submitted plans", and gives a confirmation number.
  pi.registerTool({
    name: "advising_submit_plan",
    label: "Submit plan",
    description:
      "Send a semester plan to the student's advisor for review (mock). The student must approve it. " +
      "Use it only after the student agrees on the plan.",
    promptSnippet: "Send an agreed semester plan to the student's advisor for review",
    parameters: Type.Object({
      terms: Type.Array(Type.Object({
        term: Type.String({ description: "For example Spring 2027" }),
        courses: Type.Array(Type.String({ description: "Course number, for example CSCI 460" })),
      }), { description: "The plan, one entry for each term" }),
      message: Type.Optional(Type.String({ description: "A short note to the advisor, in the student's words" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const credits = (c: string) => SPRING_2027.find((s) => s.course === c)?.credits ?? 3;
      // Problems that the advisor will see: a class that is full, a missing prerequisite, a class already done.
      const warnings: string[] = [];
      for (const t of params.terms) for (const c of t.courses) {
        const s = SPRING_2027.find((x) => x.course === c);
        if (passed(c)) warnings.push(`${c} is already complete.`);
        else if (inProgress(c)) warnings.push(`${c} is in progress now.`);
        if (s && t.term === STUDENT.next_term && s.seats === 0) warnings.push(`${c} is full in ${t.term}.`);
        for (const p of s?.prereq ?? []) if (!passed(p) && !inProgress(p)) warnings.push(`${c} needs ${p}.`);
      }
      // The plan card (desktop app): the same data that the advisor gets.
      const plan = {
        type: "plan", title: `Send this plan to ${STUDENT.advisor}?`, advisor: STUDENT.advisor, student: STUDENT.name,
        terms: params.terms.map((t) => ({
          term: t.term,
          credits: t.courses.reduce((a, c) => a + credits(c), 0),
          courses: t.courses.map((c) => ({ course: c, title: TITLES[c] ?? "", credits: credits(c) })),
        })),
        message: params.message, warnings,
      };
      let send: boolean;
      if (ctx.mode === "rpc") {
        // The app shows the plan card in the chat and answers {"send": true} or {"send": false}.
        const answer = await ctx.ui.input(`${WIDGET_PREFIX}${JSON.stringify(plan)}`, undefined, { signal });
        try { send = JSON.parse(answer ?? "{}").send === true; } catch { send = false; }
      } else {
        const lines = plan.terms.map((t) => `${t.term}: ${t.courses.map((c) => c.course).join(", ")} (${t.credits} credits)`);
        const summary = [...lines, params.message ? `Note: ${params.message}` : "", ...warnings.map((w) => `Warning: ${w}`)].filter(Boolean).join("\n");
        send = ctx.hasUI && (await ctx.ui.select(`Send this plan to ${STUDENT.advisor}?\n\n${summary}`, ["Send the plan", "No"])) === "Send the plan";
      }
      if (!send) {
        return { content: [{ type: "text", text: `The student did not send the plan. Ask what they want to change.\n${JSON.stringify({ submitted: false, plan })}` }], details: {} };
      }
      const number = `PLAN-${Date.now().toString(36).toUpperCase()}`;
      const when = new Date();
      const dir = join(ctx.cwd, "Submitted plans");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${when.toISOString().slice(0, 10)} ${number}.md`);
      writeFileSync(file, `# Plan ${number}\n\nStudent: ${STUDENT.name}\nTo: ${STUDENT.advisor}\nSent: ${when.toLocaleString()}\n\n` +
        `${plan.terms.map((t) => `## ${t.term} (${t.credits} credits)\n\n${t.courses.map((c) => `- ${c.course} ${c.title}`).join("\n")}`).join("\n\n")}\n` +
        `${params.message ? `\n## Note\n\n${params.message}\n` : ""}${warnings.length ? `\n## Warnings\n\n${warnings.map((w) => `- ${w}`).join("\n")}\n` : ""}`);
      return json({
        submitted: true, confirmation: number, to: STUDENT.advisor, saved_copy: file,
        reply_expected: "within 2 business days (mock)", warnings,
        next_step: `Registration opens ${STUDENT.registration_opens}. The advisor must release the registration hold after the review (mock).`,
        plan,
      });
    },
  });

  pi.registerTool({
    name: "advising_transcript",
    label: "Transcript",
    description: "Get the student's transcript: the student information, all courses by term with grades, the GPA, and the credits.",
    promptSnippet: "Get the student's transcript (courses, grades, GPA, credits)",
    parameters: Type.Object({}),
    async execute() {
      return json({ student: STUDENT, ...gpa(), ...earnedCredits(), courses: TRANSCRIPT });
    },
  });

  pi.registerTool({
    name: "advising_requirements",
    label: "Degree requirements",
    description:
      "Get the requirements of the student's major (Computer Science, BS) and the status of each: complete, in progress, or needed. " +
      "Also the total and upper-division credit requirements.",
    promptSnippet: "Get the student's degree requirements and the status of each",
    parameters: Type.Object({}),
    async execute() {
      return json({
        major: STUDENT.major, catalog: STUDENT.catalog, grade_rule: "Major and math courses need C- or better.",
        total_credits_required: TOTAL_CREDITS, upper_division_credits_required: UPPER_DIVISION_CREDITS, ...earnedCredits(),
        requirements: requirementStatus().map(({ any, ...r }) => ({ ...r, options: any.length > 1 ? any : undefined })),
      });
    },
  });

  pi.registerTool({
    name: "advising_classes",
    label: "Upcoming classes",
    description:
      "Get the classes offered next term (Spring 2027): times, seats, prerequisites, and whether the student meets each prerequisite. " +
      "Filter by subject (for example CSCI) or by words in the course or title.",
    promptSnippet: "Get next term's classes with times, seats, and the student's prerequisite status",
    parameters: Type.Object({
      subject: Type.Optional(Type.String({ description: "For example CSCI or M" })),
      search: Type.Optional(Type.String({ description: "Words in the course number or title, for example security" })),
    }),
    async execute(_id, params) {
      const words = (params.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const list = SPRING_2027
        .filter((s) => !params.subject || s.course.split(" ")[0].toLowerCase() === params.subject.toLowerCase())
        .filter((s) => words.every((w) => `${s.course} ${s.title}`.toLowerCase().includes(w)))
        .map((s) => ({
          ...s,
          full: s.seats === 0,
          already_done: passed(s.course),
          prereq_status: s.prereq.map((p) => ({ course: p, status: passed(p) ? "done" : inProgress(p) ? "in progress now" : "missing" })),
        }));
      return json({ term: STUDENT.next_term, registration_opens: STUDENT.registration_opens, classes: list });
    },
  });
}

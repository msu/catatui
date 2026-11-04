// Classes: the student's classes this term. MOCK data for a demo, the same mock student as advising.ts.
// The desktop app has two kinds of sessions:
// - "Classes" (one session, Documents/catai/Classes): all classes, upcoming due dates, term dates, grades.
//   The app starts catatui there with CATATUI_CLASSES=1.
// - A class chat (one session per class, Documents/catai/Classes/<code>, for example "CSCI 305").
//   The app starts catatui there with CATATUI_CLASS=<code>. A class chat can link to a project: the link is
//   project.json in the class folder ({ "path": "..." }).
// A real version would read the data from the learning system (for example Brightspace D2L), with the student's permission.
// See src/md/features/classes.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";

type Assignment = { name: string; category: string; due: string; points: number; score?: number; status: "graded" | "submitted" | "open" | "late" };
type Week = { week: number; dates: string; topic: string; reading?: string; exam?: string };
type Material = { week: number; title: string; notes: string };
type Class = {
  code: string; title: string; credits: number; instructor: string; meets: string; room: string;
  description: string; weights: Record<string, number>; policies: string[];
  assignments: Assignment[]; schedule: Week[]; materials: Material[];
};

export const TERM = {
  name: "Fall 2026",
  today: "2026-11-03",
  dates: [
    { date: "2026-09-02", what: "Last day to add a class or drop with a refund (mock)" },
    { date: "2026-11-06", what: "Last day to withdraw from a class with a W grade (mock)" },
    { date: "2026-11-11", what: "Veterans Day, no classes (mock)" },
    { date: "2026-11-25", what: "Thanksgiving break starts, no classes Nov 25-27 (mock)" },
    { date: "2026-12-11", what: "Last day of classes (mock)" },
    { date: "2026-12-14", what: "Final exams, Dec 14-18 (mock)" },
  ],
};

export const CLASSES: Class[] = [
  {
    code: "CSCI 305", title: "Concepts of Programming Languages", credits: 3, instructor: "Dr. Morgan Hale (mock)",
    meets: "MWF 10:00-10:50", room: "Barnard Hall 108",
    description: "Syntax and semantics, types, scope, functional and logic programming, and how interpreters work.",
    weights: { Homework: 40, Quizzes: 10, Midterm: 20, Final: 30 },
    policies: ["Late homework loses 10% each day, for at most 3 days.", "Homework is individual work. You can discuss ideas, but write your own code.", "AI tools: you can use them to learn concepts. Do not submit AI-written solutions."],
    assignments: [
      { name: "HW1: Grammars and parse trees", category: "Homework", due: "2026-09-11", points: 100, score: 92, status: "graded" },
      { name: "HW2: Scope and binding", category: "Homework", due: "2026-09-25", points: 100, score: 85, status: "graded" },
      { name: "HW3: Racket basics", category: "Homework", due: "2026-10-09", points: 100, score: 78, status: "graded" },
      { name: "Midterm", category: "Midterm", due: "2026-10-16", points: 100, score: 81, status: "graded" },
      { name: "HW4: Higher-order functions", category: "Homework", due: "2026-10-30", points: 100, status: "submitted" },
      { name: "Quiz 5: Closures", category: "Quizzes", due: "2026-11-04", points: 10, status: "open" },
      { name: "HW5: A small interpreter", category: "Homework", due: "2026-11-13", points: 100, status: "open" },
      { name: "HW6: Prolog", category: "Homework", due: "2026-12-04", points: 100, status: "open" },
      { name: "Final exam", category: "Final", due: "2026-12-15", points: 150, status: "open" },
    ],
    schedule: [
      { week: 10, dates: "Oct 26-30", topic: "Higher-order functions and closures", reading: "Chapter 7" },
      { week: 11, dates: "Nov 2-6", topic: "Interpreters: environments and evaluation", reading: "Chapter 8.1-8.3" },
      { week: 12, dates: "Nov 9-13", topic: "Interpreters: functions and recursion", reading: "Chapter 8.4-8.6" },
      { week: 13, dates: "Nov 16-20", topic: "Logic programming with Prolog", reading: "Chapter 11" },
      { week: 14, dates: "Nov 23-24", topic: "Prolog: unification and backtracking", reading: "Chapter 11" },
      { week: 15, dates: "Nov 30-Dec 4", topic: "Type systems and type inference", reading: "Chapter 6" },
      { week: 16, dates: "Dec 7-11", topic: "Review", exam: "Final exam: Tue Dec 15, 8:00-9:50" },
    ],
    materials: [
      { week: 10, title: "Closures", notes: "A closure is a function together with the environment where it was made. When a function refers to a variable that is not its parameter (a free variable), the closure keeps that variable alive. Example in Racket: (define (make-adder n) (lambda (x) (+ x n))). (make-adder 5) returns a function that adds 5, because the lambda keeps n = 5. Closures make callbacks, iterators, and partial application possible." },
      { week: 11, title: "Environments and evaluation", notes: "An interpreter evaluates an expression in an environment: a map from names to values. eval takes (expression, environment) and returns a value. A number evaluates to itself. A name is looked up in the environment. (let ([x e1]) e2) evaluates e1, then evaluates e2 in a new environment that extends the old one with x. A new environment for each let gives lexical scope." },
      { week: 12, title: "Functions in the interpreter", notes: "A lambda evaluates to a closure: (params, body, environment where the lambda was made). To apply a closure, evaluate the arguments, make a new environment that extends the closure's environment with params bound to the arguments, and evaluate the body there. If you extend the caller's environment instead, you get dynamic scope." },
    ],
  },
  {
    code: "CSCI 338", title: "Computer Science Theory", credits: 3, instructor: "Dr. Priya Raman (mock)",
    meets: "TR 13:40-14:55", room: "Roberts Hall 101",
    description: "Finite automata, regular languages, context-free grammars, Turing machines, decidability, and complexity.",
    weights: { "Problem sets": 35, Midterms: 35, Final: 30 },
    policies: ["Problem sets are due at the start of class. No late work, but the lowest problem set score is dropped.", "You can work in groups of two. Each student writes their own answers."],
    assignments: [
      { name: "PS1: DFAs and NFAs", category: "Problem sets", due: "2026-09-15", points: 50, score: 46, status: "graded" },
      { name: "PS2: Regular expressions", category: "Problem sets", due: "2026-09-29", points: 50, score: 41, status: "graded" },
      { name: "Midterm 1", category: "Midterms", due: "2026-10-06", points: 100, score: 74, status: "graded" },
      { name: "PS3: Pumping lemma", category: "Problem sets", due: "2026-10-20", points: 50, score: 35, status: "graded" },
      { name: "PS4: Context-free grammars", category: "Problem sets", due: "2026-11-05", points: 50, status: "open" },
      { name: "Midterm 2", category: "Midterms", due: "2026-11-17", points: 100, status: "open" },
      { name: "PS5: Turing machines", category: "Problem sets", due: "2026-12-03", points: 50, status: "open" },
      { name: "Final exam", category: "Final", due: "2026-12-16", points: 150, status: "open" },
    ],
    schedule: [
      { week: 10, dates: "Oct 27-29", topic: "Context-free grammars", reading: "Sipser 2.1" },
      { week: 11, dates: "Nov 3-5", topic: "Pushdown automata", reading: "Sipser 2.2" },
      { week: 12, dates: "Nov 10-12", topic: "Non-context-free languages", reading: "Sipser 2.3" },
      { week: 13, dates: "Nov 17-19", topic: "Turing machines", reading: "Sipser 3.1", exam: "Midterm 2: Tue Nov 17 (in class)" },
      { week: 14, dates: "Nov 24", topic: "Variants of Turing machines", reading: "Sipser 3.2" },
      { week: 15, dates: "Dec 1-3", topic: "Decidability", reading: "Sipser 4.1" },
      { week: 16, dates: "Dec 8-10", topic: "The halting problem and review", reading: "Sipser 4.2", exam: "Final exam: Wed Dec 16, 10:00-11:50" },
    ],
    materials: [
      { week: 10, title: "Context-free grammars", notes: "A context-free grammar has variables, terminals, rules (variable -> string of variables and terminals), and a start variable. A derivation replaces one variable at a time. Example: S -> 0S1 | e makes { 0^n 1^n }. A grammar is ambiguous if a string has two different leftmost derivations." },
      { week: 11, title: "Pushdown automata", notes: "A pushdown automaton (PDA) is an NFA with a stack. Each step reads an input symbol (or nothing), pops a stack symbol (or nothing), and pushes a string. A PDA for { 0^n 1^n }: push each 0, pop one 0 for each 1, accept when the stack is empty at the end. PDAs recognize exactly the context-free languages." },
    ],
  },
  {
    code: "M 221", title: "Introduction to Linear Algebra", credits: 3, instructor: "Dr. Leah Ortiz (mock)",
    meets: "MWF 08:00-08:50", room: "Wilson Hall 1-144",
    description: "Systems of linear equations, matrices, determinants, vector spaces, eigenvalues, and applications.",
    weights: { "Online homework": 20, Quizzes: 15, Exams: 40, Final: 25 },
    policies: ["Online homework closes at 23:59 on the due date. Extensions only for documented reasons.", "Weekly quizzes on Fridays. The two lowest quiz scores are dropped.", "This is a repeat of the class. The new grade replaces the old grade in the GPA (mock rule)."],
    assignments: [
      { name: "Exam 1", category: "Exams", due: "2026-09-25", points: 100, score: 79, status: "graded" },
      { name: "Exam 2", category: "Exams", due: "2026-10-23", points: 100, score: 84, status: "graded" },
      { name: "WebWork 9: Subspaces", category: "Online homework", due: "2026-10-28", points: 20, score: 20, status: "graded" },
      { name: "WebWork 10: Basis and dimension", category: "Online homework", due: "2026-11-04", points: 20, status: "open" },
      { name: "Quiz 9", category: "Quizzes", due: "2026-11-06", points: 10, status: "open" },
      { name: "WebWork 11: Eigenvalues", category: "Online homework", due: "2026-11-11", points: 20, status: "open" },
      { name: "Exam 3", category: "Exams", due: "2026-11-20", points: 100, status: "open" },
      { name: "Final exam", category: "Final", due: "2026-12-14", points: 150, status: "open" },
    ],
    schedule: [
      { week: 10, dates: "Oct 26-30", topic: "Subspaces, null space, column space", reading: "Lay 4.1-4.2" },
      { week: 11, dates: "Nov 2-6", topic: "Basis and dimension", reading: "Lay 4.3-4.5" },
      { week: 12, dates: "Nov 9-13", topic: "Eigenvalues and eigenvectors", reading: "Lay 5.1-5.2" },
      { week: 13, dates: "Nov 16-20", topic: "Diagonalization", reading: "Lay 5.3", exam: "Exam 3: Fri Nov 20" },
      { week: 15, dates: "Nov 30-Dec 4", topic: "Orthogonality and least squares", reading: "Lay 6.1-6.5" },
      { week: 16, dates: "Dec 7-11", topic: "Review", exam: "Final exam: Mon Dec 14, 8:00-9:50" },
    ],
    materials: [
      { week: 11, title: "Basis and dimension", notes: "A basis of a subspace H is a set of vectors in H that is linearly independent and spans H. Every basis of H has the same number of vectors: the dimension of H. To find a basis of Col A, row reduce A and take the pivot columns of the original A. The dimension of Nul A is the number of free variables. Rank theorem: rank A + dim Nul A = number of columns." },
      { week: 12, title: "Eigenvalues", notes: "A nonzero vector x is an eigenvector of A if Ax = lambda x for a scalar lambda (the eigenvalue). To find the eigenvalues, solve det(A - lambda I) = 0. For each eigenvalue, the eigenvectors are the nonzero vectors in Nul(A - lambda I)." },
    ],
  },
  {
    code: "PHSX 222", title: "Physics II: Electricity and Magnetism", credits: 4, instructor: "Dr. Chen Wu (mock)",
    meets: "MWF 11:00-11:50, lab R 14:10-16:00", room: "Barnard Hall 103",
    description: "Electric fields, potential, circuits, magnetic fields, induction, and an introduction to waves.",
    weights: { Homework: 15, Labs: 20, Exams: 40, Final: 25 },
    policies: ["Lab reports are due one week after the lab.", "Missing more than two labs is a failing grade in the class."],
    assignments: [
      { name: "Lab 6: RC circuits", category: "Labs", due: "2026-10-29", points: 20, score: 17, status: "graded" },
      { name: "Exam 2", category: "Exams", due: "2026-10-28", points: 100, score: 68, status: "graded" },
      { name: "Homework 9: Magnetic fields", category: "Homework", due: "2026-11-02", points: 30, status: "late" },
      { name: "Lab 7: Magnetic force", category: "Labs", due: "2026-11-05", points: 20, status: "open" },
      { name: "Homework 10: Ampere's law", category: "Homework", due: "2026-11-09", points: 30, status: "open" },
      { name: "Exam 3", category: "Exams", due: "2026-11-23", points: 100, status: "open" },
      { name: "Final exam", category: "Final", due: "2026-12-17", points: 150, status: "open" },
    ],
    schedule: [
      { week: 10, dates: "Oct 26-30", topic: "RC circuits", reading: "Chapter 26" },
      { week: 11, dates: "Nov 2-6", topic: "Magnetic fields and forces", reading: "Chapter 27" },
      { week: 12, dates: "Nov 9-13", topic: "Sources of magnetic fields, Ampere's law", reading: "Chapter 28" },
      { week: 13, dates: "Nov 16-20", topic: "Faraday's law and induction", reading: "Chapter 29" },
      { week: 14, dates: "Nov 23", topic: "Review", exam: "Exam 3: Mon Nov 23" },
      { week: 15, dates: "Nov 30-Dec 4", topic: "Inductance and AC circuits", reading: "Chapters 30-31" },
      { week: 16, dates: "Dec 7-11", topic: "Electromagnetic waves and review", reading: "Chapter 32", exam: "Final exam: Thu Dec 17, 13:00-14:50" },
    ],
    materials: [
      { week: 11, title: "Magnetic force", notes: "A charge q moving with velocity v in a magnetic field B feels the force F = q v x B. The force is perpendicular to both v and B, so it changes the direction of motion but not the speed. A charge in a uniform field moves in a circle of radius r = m v / (|q| B). A current-carrying wire feels F = I L x B." },
    ],
  },
];

const LETTERS: [number, string][] = [[93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"], [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [60, "D"], [0, "F"]];
const letter = (pct: number) => LETTERS.find(([min]) => pct >= min)?.[1] ?? "F";

// The grade so far: each category's average of the graded work, weighted by the categories that have grades.
export function grade(c: Class) {
  const cats = Object.entries(c.weights).map(([name, weight]) => {
    const graded = c.assignments.filter((a) => a.category === name && a.score !== undefined);
    const earned = graded.reduce((s, a) => s + (a.score ?? 0), 0);
    const possible = graded.reduce((s, a) => s + a.points, 0);
    return { category: name, weight, earned, possible, percent: possible ? Math.round((earned / possible) * 1000) / 10 : undefined };
  });
  const used = cats.filter((x) => x.percent !== undefined);
  const w = used.reduce((s, x) => s + x.weight, 0);
  const pct = w ? Math.round((used.reduce((s, x) => s + (x.percent ?? 0) * x.weight, 0) / w) * 10) / 10 : undefined;
  return { percent: pct, letter: pct === undefined ? undefined : letter(pct), categories: cats, note: "Only the graded work counts so far." };
}

const daysFrom = (date: string) => Math.round((Date.parse(date) - Date.parse(TERM.today)) / 86_400_000);

// The next work that is not done, for each class (for the app panels and the overview tool).
export function summaries() {
  return CLASSES.map((c) => {
    const next = c.assignments.filter((a) => (a.status === "open" || a.status === "late") && daysFrom(a.due) >= -7).sort((a, b) => a.due.localeCompare(b.due))[0];
    const g = grade(c);
    return { code: c.code, title: c.title, instructor: c.instructor, meets: c.meets, room: c.room, grade: g.percent, letter: g.letter, next: next && { name: next.name, due: next.due, status: next.status, in_days: daysFrom(next.due) } };
  });
}

// Work due in the next `days` days (and late work), in all classes, soonest first.
export function upcoming(days = 14) {
  const list = [];
  for (const c of CLASSES) for (const a of c.assignments) {
    const d = daysFrom(a.due);
    if ((a.status === "open" && d >= 0 && d <= days) || a.status === "late") list.push({ course: c.code, name: a.name, due: a.due, in_days: d, status: a.status, points: a.points });
  }
  const dates = TERM.dates.filter((x) => daysFrom(x.date) >= 0 && daysFrom(x.date) <= Math.max(days, 45)).map((x) => ({ ...x, in_days: daysFrom(x.date) }));
  return { today: TERM.today, work: list.sort((a, b) => a.due.localeCompare(b.due)), term_dates: dates };
}

const MOCK_NOTE = "MOCK DATA for a demo. It is not the student's real class data.";
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: `${MOCK_NOTE}\n${JSON.stringify(data, null, 1)}` }], details: {} });
const find = (code?: string) => CLASSES.find((c) => c.code.replace(/\s+/g, "").toLowerCase() === String(code ?? "").replace(/\s+/g, "").toLowerCase());

const OVERVIEW_PROMPT = `# Classes

You help the student manage their classes this term (${TERM.name}). Today is ${TERM.today} (mock date).
- Use classes_overview and classes_deadlines for the big picture, and the class_ tools for one class. Do not guess dates or grades.
- The data is mock data for a demo. Say this once, at the start of the conversation.
- Help the student plan the week: what is due first, what is late, and how much time each task needs.
- Point out important term dates, for example the last day to withdraw.
- Show lists of dates as Markdown tables, or with show_widget (type table).`;

const classPrompt = (c: Class, link?: string) => `# Class: ${c.code} ${c.title}

You are a study helper for ${c.code} (${c.title}), taught by ${c.instructor}. Today is ${TERM.today} (mock date).
- Use the class_ tools (the course is ${c.code}) to get assignments, grades, the syllabus, and the course materials. Do not guess.
- The data is mock data for a demo. Say this once, at the start of the conversation.
- Follow the class policies, also on AI use: ${c.policies.join(" ")}
- Help the student learn. Explain concepts from the course materials, give hints, and check their understanding.
  Do not write graded work (homework, labs, problem sets) for the student.
${link ? `- The student linked a project folder to this class: ${link}. The files are there. To work on them, the student opens the project in catai.` : "- The student can link a project folder to this class in the left panel."}`;

// The project linked to a class folder (project.json), or undefined.
export function classLink(folder: string): string | undefined {
  try { return JSON.parse(readFileSync(join(folder, "project.json"), "utf8")).path; } catch { return undefined; }
}

export function registerClasses(pi: ExtensionAPI, course?: string) {
  const own = find(course);
  pi.on("before_agent_start", async (event, ctx) => {
    const section = own ? classPrompt(own, classLink(ctx.cwd)) : OVERVIEW_PROMPT;
    event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, "classes": section };
  });
  // In a class chat, the course is the class. In the overview, the model must name it.
  const COURSE = Type.Optional(Type.String({ description: own ? `Default: ${own.code}` : "For example CSCI 305" }));
  const pick = (code?: string) => find(code) ?? own;
  const unknown = (code?: string) => ({ content: [{ type: "text" as const, text: `Unknown course "${code ?? ""}". The classes are: ${CLASSES.map((c) => c.code).join(", ")}.` }], details: {} });

  if (!own) {
    pi.registerTool({
      name: "classes_overview",
      label: "My classes",
      description: "Get all of the student's classes this term: times, instructor, the grade so far, and the next work due.",
      promptSnippet: "Get all classes this term with grades so far and the next work due",
      parameters: Type.Object({}),
      async execute() { return json({ term: TERM.name, today: TERM.today, classes: summaries() }); },
    });
    pi.registerTool({
      name: "classes_deadlines",
      label: "Deadlines",
      description: "Get the work due in all classes in the next days (and late work), and the important term dates (withdraw deadline, breaks, finals).",
      promptSnippet: "Get upcoming due dates in all classes and the important term dates",
      parameters: Type.Object({ days: Type.Optional(Type.Number({ description: "How many days ahead. Default: 14" })) }),
      async execute(_id, params) { return json(upcoming(params.days ?? 14)); },
    });
  }

  pi.registerTool({
    name: "class_assignments",
    label: "Assignments",
    description: "Get the assignments of a class: the due date, the points, the status (graded, submitted, open, late), and the score.",
    promptSnippet: "Get a class's assignments, due dates, status, and scores",
    parameters: Type.Object({ course: COURSE }),
    async execute(_id, params) {
      const c = pick(params.course);
      if (!c) return unknown(params.course);
      return json({ course: c.code, today: TERM.today, assignments: c.assignments.map((a) => ({ ...a, in_days: daysFrom(a.due) })) });
    },
  });
  pi.registerTool({
    name: "class_grades",
    label: "Grades",
    description: "Get the grade so far in a class: each category with its weight and percent, and the total percent and letter.",
    promptSnippet: "Get a class's grade so far by category",
    parameters: Type.Object({ course: COURSE }),
    async execute(_id, params) {
      const c = pick(params.course);
      if (!c) return unknown(params.course);
      return json({ course: c.code, ...grade(c), scale: Object.fromEntries(LETTERS.map(([m, l]) => [l, `${m}%+`])) });
    },
  });
  pi.registerTool({
    name: "class_syllabus",
    label: "Syllabus",
    description: "Get a class's syllabus: the description, the instructor, the meeting times, the grade weights, the policies, and the week-by-week schedule with readings and exams.",
    promptSnippet: "Get a class's syllabus, policies, and weekly schedule",
    parameters: Type.Object({ course: COURSE }),
    async execute(_id, params) {
      const c = pick(params.course);
      if (!c) return unknown(params.course);
      const { assignments: _a, materials: _m, ...rest } = c;
      return json(rest);
    },
  });
  pi.registerTool({
    name: "class_materials",
    label: "Course materials",
    description: "Get the lecture notes of a class, for one week or for words in the notes. Use them to explain concepts.",
    promptSnippet: "Get a class's lecture notes by week or topic",
    parameters: Type.Object({
      course: COURSE,
      week: Type.Optional(Type.Number()),
      search: Type.Optional(Type.String({ description: "Words in the title or the notes" })),
    }),
    async execute(_id, params) {
      const c = pick(params.course);
      if (!c) return unknown(params.course);
      const words = (params.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const list = c.materials
        .filter((m) => params.week === undefined || m.week === params.week)
        .filter((m) => words.every((w) => `${m.title} ${m.notes}`.toLowerCase().includes(w)));
      return json({ course: c.code, materials: list, all_titles: c.materials.map((m) => `Week ${m.week}: ${m.title}`) });
    },
  });
}
